"""Blizzard's public CDN (TACT) for the hotfix watcher (#62): the live build, hero XML by range.

Listing a build's files needs its MNDX root, which CascLib reads (tools/hotfix/casccdn, list mode
only). Fetching is done here: CascLib pulls whole 256 MB archives for one file (13 GB in the
spike), while the archive .index files give each file's byte range. Every file is checked
against its content hash (MD5 = CKey), so what we compare is the build's real content.
"""

from __future__ import annotations

import hashlib
import re
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path

import httpx


@dataclass(frozen=True)
class BuildInfo:
    version: str
    build_config: str
    cdn_config: str


@dataclass(frozen=True)
class ListRow:
    name: str
    ckey: str
    ekey: str


def parse_versions(text: str, region: str) -> BuildInfo:
    """Ribbit `hero/versions` (pipe-separated, typed header) → the region's live build."""
    lines = [ln for ln in text.splitlines() if ln and not ln.startswith("##")]
    cols = [c.split("!")[0] for c in lines[0].split("|")]
    for ln in lines[1:]:
        row = dict(zip(cols, ln.split("|"), strict=False))
        if row.get("Region") == region:
            return BuildInfo(row["VersionsName"], row["BuildConfig"], row["CDNConfig"])
    raise ValueError(f"no {region} row in versions")


def parse_archives(cdn_config: str) -> list[str]:
    for ln in cdn_config.splitlines():
        if ln.startswith("archives ="):
            return ln.split("=", 1)[1].split()
    raise ValueError("no archives in CDN config")


# hero catalogs, one level deep (sound and voice data sit a level below): heroesdata\...\heroes\
# <hero>data\*.xml, heromods\<hero>.stormmod\...\gamedata\*.xml (garrosh.xml, behaviordata.xml)
_HERO_XML = re.compile(
    r"^mods\\(?:heroesdata\.stormmod\\base\.stormdata\\gamedata\\heroes\\\w+"
    r"|heromods\\\w+\.stormmod\\base\.stormdata\\gamedata)\\\w+\.xml$",
    re.I,
)


def is_hero_xml(name: str) -> bool:
    return bool(_HERO_XML.match(name))


def parse_listing(text: str) -> dict[str, ListRow]:
    """casccdn list output (name, ckey, ekey, size per line) → hero XML rows by lowercase name."""
    rows = {}
    for ln in text.splitlines():
        parts = ln.split("\t")
        if len(parts) == 4 and is_hero_xml(parts[0]):
            rows[parts[0].lower()] = ListRow(parts[0], parts[1], parts[2])
    return rows


def changed_hero_xml(
    old: dict[str, ListRow], new: dict[str, ListRow]
) -> list[tuple[ListRow, ListRow]]:
    """Hero XML both builds have, content hash changed; a new hero has nothing to compare."""
    return [(old[k], new[k]) for k in sorted(new) if k in old and old[k].ckey != new[k].ckey]


def parse_index(data: bytes, wanted: set[str]) -> dict[str, tuple[int, int]]:
    """An archive .index → {ekey: (offset, size)} for the wanted keys."""
    found = {}
    for b in range(0, len(data) - 4096 + 1, 4096):
        for e in range(b, b + 4096 - 23, 24):
            k = data[e : e + 16].hex()
            if k in wanted:
                size, off = struct.unpack(">II", data[e + 16 : e + 24])
                found[k] = (off, size)
    return found


def blte(buf: bytes) -> bytes:
    if buf[:4] != b"BLTE":
        raise ValueError("not a BLTE stream")
    hsize = struct.unpack(">I", buf[4:8])[0]
    if hsize == 0:
        sizes, pos = [len(buf) - 8], 8
    else:
        n = int.from_bytes(buf[9:12], "big")
        sizes = [struct.unpack(">I", buf[12 + 24 * i : 16 + 24 * i])[0] for i in range(n)]
        pos = hsize
    out = bytearray()
    for cs in sizes:
        chunk = buf[pos : pos + cs]
        pos += cs
        mode = chunk[:1]
        if mode == b"N":
            out += chunk[1:]
        elif mode == b"Z":
            out += zlib.decompress(chunk[1:])
        elif mode == b"F":
            out += blte(chunk[1:])
        else:
            raise ValueError(f"BLTE mode {mode!r} not supported (encrypted?)")
    return bytes(out)


def _hp(h: str) -> str:
    return f"{h[:2]}/{h[2:4]}/{h}"


async def _get(http: httpx.AsyncClient, url: str, rng: tuple[int, int] | None = None) -> bytes:
    headers = {"Range": f"bytes={rng[0]}-{rng[0] + rng[1] - 1}"} if rng else {}
    r = await http.get(url, headers=headers)
    r.raise_for_status()
    return r.content


async def fetch_files(
    http: httpx.AsyncClient,
    cdn: str,
    archives: list[str],
    rows: list[ListRow],
    cache_dir: Path,
) -> dict[str, str]:
    """{ckey: text} for rows (two builds share file names), each by byte range from its archive
    (or loose), hash-checked."""
    wanted = {r.ekey for r in rows}
    where: dict[str, tuple[str, int, int]] = {}
    cache_dir.mkdir(parents=True, exist_ok=True)
    for a in archives:
        if wanted <= where.keys():
            break
        p = cache_dir / f"{a}.index"
        if not p.exists():
            p.write_bytes(await _get(http, f"{cdn}/data/{_hp(a)}.index"))
        for k, (off, size) in parse_index(p.read_bytes(), wanted - where.keys()).items():
            where[k] = (a, off, size)
    out = {}
    for r in rows:
        if r.ekey in where:
            a, off, size = where[r.ekey]
            raw = await _get(http, f"{cdn}/data/{_hp(a)}", (off, size))
        else:
            raw = await _get(http, f"{cdn}/data/{_hp(r.ekey)}")
        data = blte(raw)
        if hashlib.md5(data).hexdigest() != r.ckey:
            raise ValueError(f"content hash mismatch for {r.name}")
        out[r.ckey] = data.decode("utf-8")
    return out
