#!/usr/bin/env bash
# Apply Carbon's OCCT source patches in-place. Idempotent; fails loud.
set -euo pipefail
SRC="${1:?usage: apply.sh <occt-src-dir>}"
f="$SRC/src/FoundationClasses/TKernel/NCollection/NCollection_BaseAllocator.cxx"

# CommonBaseAllocator(): make the singleton PER-THREAD to kill the refcount
# cache-line hotspot (see 0001-...patch), AND hold it BY VALUE so its Handle
# destructor runs at thread exit — a thread_local RAW pointer `new`'d per thread
# would leak one Handle + allocator for every worker thread that ever touches
# OCCT. Handle refcounting keeps the allocator alive across any cross-thread
# handoff (containers hold their own ref), so freeing this thread's ref is safe.
if grep -q 'static thread_local occ::handle<NCollection_BaseAllocator> THE_SINGLETON_ALLOC(new NCollection_BaseAllocator);' "$f"; then
    echo "already patched"
    exit 0
fi

# Declaration: `static [thread_local] occ::handle<...>* X = new occ::handle<...>(new NCollection_BaseAllocator);`
#           -> `static thread_local occ::handle<...> X(new NCollection_BaseAllocator);`
perl -0pi -e 's/static(?:\s+thread_local)?\s+occ::handle<NCollection_BaseAllocator>\*\s+THE_SINGLETON_ALLOC\s*=\s*new\s+occ::handle<NCollection_BaseAllocator>\(new NCollection_BaseAllocator\);/static thread_local occ::handle<NCollection_BaseAllocator> THE_SINGLETON_ALLOC(new NCollection_BaseAllocator);/s' "$f"
# Return: deref the pointer no longer applies now that it's by value.
perl -0pi -e 's/return \*THE_SINGLETON_ALLOC;/return THE_SINGLETON_ALLOC;/' "$f"

grep -q 'static thread_local occ::handle<NCollection_BaseAllocator> THE_SINGLETON_ALLOC(new NCollection_BaseAllocator);' "$f" || { echo "PATCH FAILED (declaration)"; exit 1; }
grep -q 'return THE_SINGLETON_ALLOC;' "$f" || { echo "PATCH FAILED (return)"; exit 1; }
echo "patched CommonBaseAllocator -> thread_local (by value, freed at thread exit)"
