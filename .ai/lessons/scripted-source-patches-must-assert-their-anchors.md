---
paths: []
triggers: []
promoted: null
---
# Scripted source patches must assert their anchors

**Context:** Applying code changes to large files via scripted string replacement (python/sed) instead of hand editing.

**Problem:** A `.replace()` whose anchor doesn't match (e.g. after Biome reformatted the code) is a silent no-op: the script reports success, the file is unchanged, and the missing code later presents as an inexplicable runtime bug. One silent miss cost hours of "stale module" mis-debugging — the client genuinely lacked a branch the server had.

**Rule:** Every scripted patch must assert the anchor's occurrence count before replacing (`assert s.count(old) == 1`) and fail loudly on a miss. Never chain a patch script with `&&` after an unasserted step.

**Applies to:** Any agent or script editing source by string replacement, repo-wide.
