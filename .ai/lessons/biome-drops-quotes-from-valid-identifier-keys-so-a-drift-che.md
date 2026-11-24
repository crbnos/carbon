---
paths: []
triggers: []
promoted: null
---
# Biome drops quotes from valid identifier keys, so a drift check that greps for `"key":` misses them

**Context:** `scripts/check-workflow-catalog.ts` verifies the committed generated
catalogue matches what the generator would produce, partly by grepping the label
file for its keys.

**Problem:** The generator emits `"notify":` but Biome formats the committed file
to `notify:`. A regex anchored on `^ {2}"([^"]+)":` therefore skipped exactly the
keys that happen to be valid JS identifiers — the check passed while genuinely
missing entries.

**Rule:** A check that reads a **formatted** generated file must tolerate the
formatter's output, not the generator's. Make the quotes optional
(`^ {2}"?([^":\s]+)"?:`), or compare parsed data rather than text.

**Applies to:** `scripts/check-workflow-catalog.ts` and any future drift check
that greps a Biome-formatted generated file.
