#!/usr/bin/env bash
# Apply Carbon's OCCT source patches in-place. Idempotent-ish; fails loud.
set -euo pipefail
SRC="${1:?usage: apply.sh <occt-src-dir>}"
f="$SRC/src/FoundationClasses/TKernel/NCollection/NCollection_BaseAllocator.cxx"
grep -q 'static thread_local occ::handle<NCollection_BaseAllocator>\* THE_SINGLETON_ALLOC' "$f" && { echo "already patched"; exit 0; }
perl -0pi -e 's/static (occ::handle<NCollection_BaseAllocator>\* THE_SINGLETON_ALLOC)/static thread_local $1/' "$f"
grep -q 'static thread_local occ::handle<NCollection_BaseAllocator>\* THE_SINGLETON_ALLOC' "$f" || { echo "PATCH FAILED"; exit 1; }
echo "patched CommonBaseAllocator -> thread_local"
