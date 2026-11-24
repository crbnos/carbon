---
paths: ["packages/ee/src/workflows/catalog/**", "packages/database/src/audit.config.ts"]
triggers: ["buildCatalog", "fkDisplayRegistry", "snapshotFields"]
promoted: null
---
# A generated catalog must key entity refs off the schema, not off a hand-written hint

**Context:** The workflow event catalog's entity registry lets a watched column
declare `ref: "supplier"`, which becomes `entity("supplier")` in the generated
property map so a customer can dot-chain `record.supplierId.name`.

**Problem:** `ref` was needed for real — composite foreign keys like
`(supplierId, companyId)` carry no `<fk table=…>` note in
`packages/database/src/swagger-docs-schema.ts`, so `purchaseOrder.supplierId`
has no detectable target. But a hand-written hint is a hand-written lie waiting
to happen: `customer.salesContactId` was declared `ref: "user"` when its foreign
key actually targets `customerContact`. Nothing would have caught it, and every
dot-path through that property would have resolved against the wrong entity.

**Rule:** Where a generator accepts a hand-written type hint alongside a
machine-readable source, make disagreement a hard error rather than letting the
hint win silently. `buildCatalog` throws when a declared `ref` conflicts with a
foreign key present in the schema, and only uses `ref` where the schema is
genuinely silent. Audit every existing hint against the real source before
trusting a slate that came from a design document.

**Applies to:** `packages/workflows/src/catalog/build.ts`, and any hand-curated
overlay on generated schema data (`packages/database/src/audit.config.ts`'s
`snapshotFields` / `fkDisplayRegistry`).
