"""The hotfix watcher (#62): a new live build → its changed hero numbers in data/hotfixes.json."""

from __future__ import annotations

import gzip
import hashlib
import json
import shutil
import struct
import zlib
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
import respx

from collector.cdn import BuildInfo
from collector.hotfix_watch import HotfixSettings, casccdn_lister, watch_once

FIX = Path(__file__).parent / "fixtures" / "hotfix"
CDN = "http://cdn.test/tpr/Hero-Live-a"
RIBBIT = "http://ribbit.test/hero/versions"
CHEN = r"mods\heroesdata.stormmod\base.stormdata\gamedata\heroes\chendata\chendata.xml"
NOW = datetime(2026, 7, 24, 17, 21, 4, tzinfo=UTC)
ARCHIVE = "ab" + "0" * 30


def _versions(version: str, build_config: str) -> str:
    return (
        "Region!STRING:0|BuildConfig!HEX:16|CDNConfig!HEX:16|KeyRing!HEX:16|BuildId!DEC:4"
        "|VersionsName!String:0|ProductConfig!HEX:16\n## seqn = 1\n"
        f"us|{build_config}|cc{'0' * 30}||1|{version}|00\n"
    )


def _blte(body: bytes) -> bytes:
    e = b"Z" + zlib.compress(body)
    header = b"\x0f" + (1).to_bytes(3, "big") + struct.pack(">II", len(e), len(body)) + b"\0" * 16
    return b"BLTE" + struct.pack(">I", 8 + len(header)) + header + e


@pytest.fixture
def settings(tmp_path: Path) -> HotfixSettings:
    data = tmp_path / "data"
    (data / "talents").mkdir(parents=True)
    heroes = {"heroes": [{"slug": "chen", "name": "Chen"}]}
    (data / "heroes_ko.json").write_text(json.dumps(heroes), "utf-8")
    talents = {
        "talents": {
            "ChenMasteryKegSmashATouchOfHoney": {"ko": "꿀 바르기", "en": "A Touch of Honey"},
            "ChenAccumulatingFlame": {"ko": "커져가는 불길", "en": "Accumulating Flame"},
        }
    }
    (data / "talents" / "chen.json").write_text(json.dumps(talents), "utf-8")
    return HotfixSettings(
        data_dir=data, work_dir=tmp_path / "work", cdn_base=CDN, ribbit_url=RIBBIT
    )


class CDNFake:
    """A CDN holding the Chen XML of 97605 and 97650, both in one archive."""

    def __init__(self) -> None:
        self.blobs = {}
        for b in ("97605", "97650"):
            body = gzip.decompress((FIX / f"{b}_chendata.xml.gz").read_bytes())
            self.blobs[b] = (hashlib.md5(body).hexdigest(), "e" * 31 + b[-1], _blte(body))
        entries, off, self.offsets = b"", 0, {}
        for _ck, ek, packed in self.blobs.values():
            entries += bytes.fromhex(ek) + struct.pack(">II", len(packed), off)
            self.offsets[ek] = off
            off += len(packed)
        self.archive = b"".join(p for _, _, p in self.blobs.values())
        self.index = entries.ljust(4096, b"\0") + b"\0" * 28

    def mount(self) -> None:
        respx.get(f"{CDN}/config/cc/00/cc{'0' * 30}").mock(
            return_value=httpx.Response(200, text=f"archives = {ARCHIVE}\n")
        )
        respx.get(f"{CDN}/data/ab/00/{ARCHIVE}.index").mock(
            return_value=httpx.Response(200, content=self.index)
        )

        def ranged(request: httpx.Request) -> httpx.Response:
            lo, hi = map(int, request.headers["Range"].removeprefix("bytes=").split("-"))
            return httpx.Response(206, content=self.archive[lo : hi + 1])

        respx.get(f"{CDN}/data/ab/00/{ARCHIVE}").mock(side_effect=ranged)

    def listing(self, build: str) -> str:
        ck, ek, packed = self.blobs[build]
        return f"{CHEN}\t{ck}\t{ek}\t{len(packed)}\nmods\\x\\rewarddata.xml\tc\te\t1\n"


@respx.mock
async def test_first_run_seeds_then_a_new_build_is_recorded(settings: HotfixSettings) -> None:
    cdn = CDNFake()
    cdn.mount()
    listed: list[str] = []

    async def lister(b: BuildInfo) -> str:
        listed.append(b.version)
        return cdn.listing(b.version.rsplit(".", 1)[1])

    ribbit = respx.get(RIBBIT)
    ribbit.mock(return_value=httpx.Response(200, text=_versions("2.55.17.97605", "b1" * 16)))
    async with httpx.AsyncClient() as http:
        assert (await watch_once(settings, http, lister, now=NOW)).outcome == "seeded"
        # the same build again: nothing listed, nothing fetched
        assert (await watch_once(settings, http, lister, now=NOW)).outcome == "unchanged"
        assert listed == ["2.55.17.97605"]
        assert not (settings.data_dir / "hotfixes.json").exists()

        ribbit.mock(return_value=httpx.Response(200, text=_versions("2.55.17.97650", "b2" * 16)))
        got = await watch_once(settings, http, lister, now=NOW)
    assert got.outcome == "recorded"
    assert got.heroes == ["Chen"]
    rec = json.loads((settings.data_dir / "hotfixes.json").read_text("utf-8"))["builds"][0]
    assert rec["build"] == "2.55.17.97650"
    assert rec["previous"] == "2.55.17.97605"
    assert rec["first_seen"] == "2026-07-24T17:21:04Z"
    assert rec["heroes"]["Chen"][0]["changes"] == [{"old": "-0.3", "new": "-0.2"}]


@respx.mock
async def test_a_build_without_changed_hero_files_is_recorded_empty(
    settings: HotfixSettings,
) -> None:
    cdn = CDNFake()
    cdn.mount()

    async def lister(b: BuildInfo) -> str:
        return cdn.listing("97605")  # same content hashes in both builds

    ribbit = respx.get(RIBBIT)
    ribbit.mock(return_value=httpx.Response(200, text=_versions("2.55.17.97771", "b1" * 16)))
    async with httpx.AsyncClient() as http:
        await watch_once(settings, http, lister, now=NOW)
        ribbit.mock(return_value=httpx.Response(200, text=_versions("2.55.17.98025", "b2" * 16)))
        got = await watch_once(settings, http, lister, now=NOW)
    assert (got.outcome, got.heroes) == ("recorded", [])
    rec = json.loads((settings.data_dir / "hotfixes.json").read_text("utf-8"))["builds"][0]
    assert (rec["build"], rec["heroes"]) == ("2.55.17.98025", {})


@respx.mock
async def test_a_lost_listing_of_the_previous_build_reseeds_instead_of_guessing(
    settings: HotfixSettings,
) -> None:
    cdn = CDNFake()
    cdn.mount()

    async def lister(b: BuildInfo) -> str:
        return cdn.listing(b.version.rsplit(".", 1)[1])

    ribbit = respx.get(RIBBIT)
    ribbit.mock(return_value=httpx.Response(200, text=_versions("2.55.17.97605", "b1" * 16)))
    async with httpx.AsyncClient() as http:
        await watch_once(settings, http, lister, now=NOW)
        shutil.rmtree(settings.work_dir / "listings")
        ribbit.mock(return_value=httpx.Response(200, text=_versions("2.55.17.97650", "b2" * 16)))
        assert (await watch_once(settings, http, lister, now=NOW)).outcome == "seeded"
    assert not (settings.data_dir / "hotfixes.json").exists()


async def test_the_casccdn_lister_returns_its_listing_and_leaves_no_cache(tmp_path: Path) -> None:
    fake = tmp_path / "casccdn"
    fake.write_text(
        '#!/bin/sh\nmkdir -p "$1" && touch "$1/encoding"\nprintf "%s\\t%s\\n" "a.xml" "$2"\n'
    )
    fake.chmod(0o755)
    s = HotfixSettings(work_dir=tmp_path / "work", casccdn=fake)
    out = await casccdn_lister(s)(BuildInfo("2.57.0.98304", "bc" * 16, "cc" * 16))
    assert out == f"a.xml\t{'bc' * 16}\n"
    assert not (tmp_path / "work" / "casc").exists()  # ~150 MB a build: deleted


async def test_a_failing_casccdn_is_an_error_not_an_empty_listing(tmp_path: Path) -> None:
    fake = tmp_path / "casccdn"
    fake.write_text("#!/bin/sh\necho 'open failed err=2' >&2\nexit 1\n")
    fake.chmod(0o755)
    s = HotfixSettings(work_dir=tmp_path / "work", casccdn=fake)
    with pytest.raises(RuntimeError, match="open failed"):
        await casccdn_lister(s)(BuildInfo("v", "b", "c"))
