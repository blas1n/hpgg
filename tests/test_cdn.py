"""Blizzard CDN (TACT) pieces of the hotfix watcher (#62): pure parsing, no network."""

from __future__ import annotations

import hashlib
import struct
import zlib
from pathlib import Path

import httpx
import pytest
import respx

from collector.cdn import (
    BuildInfo,
    ListRow,
    blte,
    changed_hero_xml,
    fetch_files,
    is_hero_xml,
    parse_archives,
    parse_index,
    parse_listing,
    parse_versions,
)

# us.patch.battle.net:1119/hero/versions, 2026-09-30
_ROW = (
    "f1b2d344c9b966d07d525626ee9c1801|cc7c0a2adb36b196e6d09411ea9b66b6||98304|2.57.0.98304"
    "|a0c5874544505acfa8952db0b0a4e48f"
)
VERSIONS = (
    "Region!STRING:0|BuildConfig!HEX:16|CDNConfig!HEX:16|KeyRing!HEX:16|BuildId!DEC:4"
    "|VersionsName!String:0|ProductConfig!HEX:16\n"
    f"## seqn = 4048642\nus|{_ROW}\neu|{_ROW}\n"
)


def test_the_live_build_of_a_region() -> None:
    assert parse_versions(VERSIONS, "us") == BuildInfo(
        version="2.57.0.98304",
        build_config="f1b2d344c9b966d07d525626ee9c1801",
        cdn_config="cc7c0a2adb36b196e6d09411ea9b66b6",
    )
    with pytest.raises(ValueError, match="kr"):
        parse_versions(VERSIONS, "kr")


def test_archives_come_from_the_cdn_config() -> None:
    cfg = "# CDN Configuration\n\narchives = aa11 bb22 cc33\narchives-index-size = 1 2 3\n"
    assert parse_archives(cfg) == ["aa11", "bb22", "cc33"]


@pytest.mark.parametrize(
    ("name", "hero"),
    [
        (r"mods\heroesdata.stormmod\base.stormdata\gamedata\heroes\chendata\chendata.xml", True),
        (r"mods\heromods\chromie.stormmod\base.stormdata\gamedata\chromiedata.xml", True),
        # a hero's main file need not end in data.xml, and some mods split catalogs out
        (r"mods\heromods\garrosh.stormmod\base.stormdata\gamedata\garrosh.xml", True),
        (r"mods\heromods\murky.stormmod\base.stormdata\gamedata\behaviordata.xml", True),
        (
            r"mods\heroesdata.stormmod\base.stormdata\gamedata\heroes\zeratuldata\zeratulabil.xml",
            True,
        ),
        # sounds, strings, other catalogs: no talent numbers
        (
            r"mods\heroesdata.stormmod\base.stormdata\gamedata\heroes\tyraeldata"
            r"\tyraelsounddata\tyraelbasesounddata.xml",
            False,
        ),
        (r"mods\heroesdata.stormmod\enus.stormdata\localizeddata\gamestrings.txt", False),
        (r"mods\heroesdata.stormmod\base.stormdata\gamedata\rewarddata.xml", False),
    ],
)
def test_only_hero_data_xml_is_compared(name: str, hero: bool) -> None:
    assert is_hero_xml(name) is hero


CHEN = r"mods\heroesdata.stormmod\base.stormdata\gamedata\heroes\chendata\chendata.xml"
YREL = r"mods\heromods\yrel.stormmod\base.stormdata\gamedata\yreldata.xml"
NEW = r"mods\heromods\newhero.stormmod\base.stormdata\gamedata\newherodata.xml"
LISTING = f"{CHEN}\tc1\te1\t10\n{YREL}\tc2\te2\t20\nmods\\x\\rewarddata.xml\tc3\te3\t5\n"


def test_a_listing_keeps_hero_xml_rows_by_lowercase_name() -> None:
    rows = parse_listing(LISTING)
    assert rows == {
        CHEN.lower(): ListRow(CHEN, "c1", "e1"),
        YREL.lower(): ListRow(YREL, "c2", "e2"),
    }


def test_changed_files_are_the_hero_xml_whose_content_hash_differs_in_both_builds() -> None:
    old = parse_listing(LISTING)
    new = parse_listing(LISTING.replace("\tc2\t", "\tc9\t") + f"{NEW}\tc4\te4\t1\n")
    assert changed_hero_xml(old, new) == [(old[YREL.lower()], new[YREL.lower()])]


def _index(entries: list[tuple[str, int, int]]) -> bytes:
    # archive .index: 4096-byte blocks of ekey16 | size u32be | offset u32be, then a footer
    block = b"".join(bytes.fromhex(k) + struct.pack(">II", size, off) for k, size, off in entries)
    return block.ljust(4096, b"\0") + b"\0" * 28


def test_an_archive_index_gives_each_wanted_file_its_offset_and_size() -> None:
    a, b = "0" * 31 + "a", "0" * 31 + "b"
    got = parse_index(_index([(a, 100, 4096), (b, 7, 0)]), {a, "f" * 32})
    assert got == {a: (4096, 100)}


def _blte(chunks: list[bytes]) -> bytes:
    encoded = [b"Z" + zlib.compress(c) for c in chunks]
    table = b"".join(
        struct.pack(">II", len(e), len(c)) + b"\0" * 16
        for e, c in zip(encoded, chunks, strict=True)
    )
    header = b"\x0f" + len(chunks).to_bytes(3, "big") + table
    return b"BLTE" + struct.pack(">I", 8 + len(header)) + header + b"".join(encoded)


def test_blte_decodes_plain_and_compressed_chunks() -> None:
    assert blte(b"BLTE\0\0\0\0Nhello") == b"hello"
    assert blte(_blte([b"<Catalog>", b"</Catalog>"])) == b"<Catalog></Catalog>"
    with pytest.raises(ValueError, match="encrypted"):
        blte(b"BLTE\0\0\0\0Exx")


CDN = "http://cdn.test/tpr/Hero-Live-a"


@respx.mock
async def test_fetch_reads_each_file_by_range_and_checks_its_content_hash(tmp_path: Path) -> None:
    body = b"<Catalog><CTalent id='A'/></Catalog>"
    ckey = hashlib.md5(body).hexdigest()
    ekey = "e" * 32
    packed = _blte([body])
    archive = "ab" + "0" * 30
    respx.get(f"{CDN}/data/ab/00/{archive}.index").mock(
        return_value=httpx.Response(200, content=_index([(ekey, len(packed), 64)]))
    )
    ranged = respx.get(f"{CDN}/data/ab/00/{archive}").mock(
        return_value=httpx.Response(206, content=packed)
    )
    async with httpx.AsyncClient() as http:
        got = await fetch_files(http, CDN, [archive], [ListRow("a.xml", ckey, ekey)], tmp_path)
    assert got == {ckey: body.decode()}  # by content hash: two builds share file names
    assert ranged.calls.last.request.headers["Range"] == f"bytes=64-{64 + len(packed) - 1}"
    # the index is cached: a second run asks only for the file
    async with httpx.AsyncClient() as http:
        await fetch_files(http, CDN, [archive], [ListRow("a.xml", ckey, ekey)], tmp_path)
    assert respx.calls.call_count == 3

    async with httpx.AsyncClient() as http:
        with pytest.raises(ValueError, match="hash"):
            await fetch_files(http, CDN, [archive], [ListRow("a.xml", "0" * 32, ekey)], tmp_path)


@respx.mock
async def test_a_file_in_no_archive_is_fetched_loose(tmp_path: Path) -> None:
    body = b"<Catalog/>"
    ekey = "cd" + "1" * 30
    archive = "ab" + "0" * 30
    respx.get(f"{CDN}/data/ab/00/{archive}.index").mock(
        return_value=httpx.Response(200, content=_index([]))
    )
    respx.get(f"{CDN}/data/cd/11/{ekey}").mock(
        return_value=httpx.Response(200, content=_blte([body]))
    )
    async with httpx.AsyncClient() as http:
        got = await fetch_files(
            http, CDN, [archive], [ListRow("b.xml", hashlib.md5(body).hexdigest(), ekey)], tmp_path
        )
    assert got == {hashlib.md5(body).hexdigest(): "<Catalog/>"}
