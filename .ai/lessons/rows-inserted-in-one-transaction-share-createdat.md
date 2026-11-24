---
paths: []
triggers: []
promoted: null
---
# Rows inserted in one transaction share `createdAt`

**Context:** The inspection plan editor listed features `ORDER BY "createdAt"`. The save
RPC (`save_inspection_document_atomic`) creates every new feature in one transaction.

**Problem:** `NOW()` is fixed for the whole transaction, so those features tie, and Postgres
returns ties in heap order. An `UPDATE` writes a new tuple at the end of the heap, so the
feature someone just edited dropped to the bottom after a reload. Its neighbour then sat in
its place, and the edit read as "not saved" although the database had it.

**Rule:** An `ORDER BY` on a timestamp that a batch insert sets needs a deterministic
tiebreak (a label, a sort order, then the id). Never rely on insertion order surviving.

**Applies to:** any list ordered by `createdAt` whose rows are written together — RPCs,
Kysely transactions, `insertInto(...).values([...])`, seeds.
