---
paths: []
triggers: []
promoted: null
---
# Resolve adoption assumptions before designing accounting migration machinery

**Context:** The accounting posting-corrections spec raised legacy open-balance migration concerns; the user clarified that accounting can be assumed unused.

**Problem:** Designing calculation versions, correction journals, and cutover tooling before resolving adoption added unnecessary scope to a correctness fix.

**Rule:** Use the user's explicit adoption premise to size compatibility work. For this spec, correct the monetary contract directly; do not add legacy-accounting machinery. An unused accounting module does not imply permission to delete operational records or reset a database.

**Applies to:** `.ai/specs/2026-09-07-accounting-posting-corrections.md` and its implementation; other modules require their own adoption evidence.
