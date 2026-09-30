#!/bin/bash
# Build tools/hotfix/bin/casccdn: CascLib (MIT, pinned) + a list-only wrapper (#62).
# Needs a C++ compiler, zlib and uv (cmake comes from uvx). Idempotent.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
rev=38a34665624b8775bb875274b36191b21c38d97b
src="$here/.casclib"
if [ ! -d "$src/.git" ]; then
  git clone -q https://github.com/ladislav-zezula/CascLib.git "$src"
fi
git -C "$src" fetch -q origin "$rev" 2>/dev/null || true
git -C "$src" checkout -q -f "$rev"
# macOS: LPDWORD is not DWORD* there (CascFiles.cpp, LoadBuildNumber)
sed -i.bak 's/LPDWORD PtrBuildNumber = (LPDWORD)(pvParam);/PDWORD PtrBuildNumber = (PDWORD)(pvParam);/' "$src/src/CascFiles.cpp"
uvx cmake -S "$src" -B "$src/build" -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DCASC_BUILD_STATIC_LIB=ON -DCASC_BUILD_SHARED_LIB=OFF -DCMAKE_BUILD_TYPE=Release >/dev/null
uvx cmake --build "$src/build" -j >/dev/null
mkdir -p "$here/bin"
c++ -O2 -std=c++17 -I"$src/src" "$here/casccdn.cpp" "$src/build/libcasc.a" -lz -o "$here/bin/casccdn"
echo "built $here/bin/casccdn"
