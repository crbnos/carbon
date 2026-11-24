---
paths: ["packages/ee/src/ramp/**"]
triggers: ["chunk(", "archivePurchaseOrder"]
promoted: null
---
# Unbounded mapping sets require bounded status reads

**Context:** Ramp archive-on-settlement loads every unarchived external mapping, then reads the corresponding Carbon invoice statuses through PostgREST.

**Problem:** One `.in()` request could exceed both URL limits and the API's 1,000-row response cap. A settled invoice after the cap could be omitted on every sweep, while lookup and archive errors were not fully reflected in the family result.

**Rule:** Chunk unbounded identifier sets below transport and response limits, finish all prerequisite reads before remote writes, and count every failed remote mutation in the owning family result.

**Applies to:** Ramp settlement archival and any integration that joins unbounded mappings to API-backed status reads before external side effects.
