#!/usr/bin/env bash
# Build the patched static OCCT the assembler links against — ONE TIME per
# machine (~15-30 min), installed to ~/.cache/carbon-occt/<version> by default.
# Then: OCCT_PREFIX=~/.cache/carbon-occt/8.0.0-p1 cargo build --release -p assembler
# (or export OCCT_PREFIX from your shell profile).
#
# OCCT V8_0_0_p1, static, no visualization/X11/freetype — plus Carbon's
# CommonBaseAllocator thread_local patch (../occt-patches), the lever that makes
# parallel STEP conversion scale near-linearly across cores.
#
# usage: build-occt.sh [install-prefix]
set -euo pipefail

VERSION_TAG="V8_0_0_p1"
PREFIX="${1:-$HOME/.cache/carbon-occt/8.0.0-p1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCHES="$SCRIPT_DIR/../occt-patches"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ -f "$PREFIX/lib/libTKernel.a" ]; then
  echo "already built: $PREFIX (delete it to rebuild)"
  exit 0
fi

command -v cmake >/dev/null || { echo "cmake required (brew install cmake / apt install cmake)"; exit 1; }
GEN_ARGS=()
command -v ninja >/dev/null && GEN_ARGS=(-G Ninja)

echo "==> cloning OCCT $VERSION_TAG"
git clone --depth 1 --branch "$VERSION_TAG" https://github.com/Open-Cascade-SAS/OCCT.git "$WORK/src"

echo "==> applying Carbon patches"
"$PATCHES/apply.sh" "$WORK/src"

echo "==> configuring (static, minimal)"
cmake "${GEN_ARGS[@]}" -S "$WORK/src" -B "$WORK/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DBUILD_LIBRARY_TYPE=Static \
  -DBUILD_MODULE_Draw=OFF \
  -DBUILD_MODULE_Visualization=OFF \
  -DBUILD_MODULE_ApplicationFramework=ON \
  -DBUILD_MODULE_DataExchange=ON \
  -DBUILD_MODULE_ModelingAlgorithms=ON \
  -DBUILD_MODULE_ModelingData=ON \
  -DBUILD_MODULE_FoundationClasses=ON \
  -DUSE_FREETYPE=OFF -DUSE_XLIB=OFF -DUSE_TK=OFF -DUSE_TCL=OFF \
  -DUSE_OPENGL=OFF -DUSE_GLES2=OFF -DUSE_RAPIDJSON=OFF -DUSE_TBB=OFF \
  -DUSE_FREEIMAGE=OFF -DUSE_DRACO=OFF -DUSE_VTK=OFF -DUSE_FFMPEG=OFF

echo "==> building (this is the long part)"
cmake --build "$WORK/build" --parallel
cmake --install "$WORK/build"

echo "==> done: $PREFIX"
echo "build with: OCCT_PREFIX=$PREFIX cargo build --release -p assembler"
