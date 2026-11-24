---
paths: []
triggers: []
promoted: null
---
# A pick moves a job material's storage unit to lineside, so the line no longer names its Pull From

**Context:** Strict backflush (2026-10-16) consumed what no pick covered from `jobMaterial.storageUnitId`.

**Problem:** Posting a pick calls `pointJobMaterialAtLineside`, which overwrites `jobMaterial.storageUnitId` with the lineside bin. After a partial pick, the remainder was checked against lineside (already drawn) instead of the warehouse bin the BoM named. With negative stock prevented it refused a completion the shelf could cover. With it allowed, it drove lineside negative. The TypeScript and SQL paths had the same bug, and no test picked anything.

**Rule:** Never read `jobMaterial.storageUnitId` as "the Pull From" once picking may have run. The pick line keeps the source (`pickingListLine.storageUnitId`). Use the oldest pick line into the line's current bin (`pullFromStorageUnit`, `@carbon/database/strict-backflush`). A later list is sourced from the fullest bin, so do not use the newest one. Any test of a bin rule needs a case with a partial pick.

**Applies to:** strict backflush, and any rule keyed on a job material's bin (picking, returns, lineside credit, consumption).
