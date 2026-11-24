# Workflows lessons

The workflow engine, matcher, catalog, actions and runs.

## A change trigger's `before` and `after` share a record id, so an id-keyed cache collapses them

```scope
id: a-change-trigger-s-before-and-after-share-a-record-id-so-an
paths: ["packages/jobs/src/workflows/engine/loader.ts","packages/ee/src/workflows/runtime/**"]
triggers: ["triggerOutputs","EntityCache","RuntimeValue"]
```

**Rule:** Never put a historical snapshot into a cache keyed by identity alone.
The rest is in `.claude/rules/workflow-engine.md`.

**Applies to:** `packages/jobs/src/workflows/engine/loader.ts`,
`packages/ee/src/workflows/runtime/`, and any future cache of "the record as it is"
that also has to represent "the record as it was".

## A `default:` arm silently defeats discriminated-union exhaustiveness

```scope
id: a-default-arm-silently-defeats-discriminated-union-exhaustiv
paths: ["packages/ee/src/workflows/definition/nodes.ts"]
triggers: ["WorkflowNodeType","z.discriminatedUnion"]
```

**Context:** Several functions switching on the same discriminated union
(`WorkflowNode["type"]` across handles, refs, outputs, type checks, config checks).

**Problem:** Five switches each had a `default:` or simply returned `undefined`
for unhandled members, so adding a seventh node type produced **zero** compile
errors — verified with `tsc --noEmit`. The new node type got default handles and
no validation at all, and would activate.

**Rule:** For behaviour that must exist for every member of a union, prefer one
record keyed by a mapped type (`{ [K in Kind]: ... }`) over N switches: a missing
key is a `TS2741` error. Where a switch is genuinely right, omit `default:` and end
with a `never` assertion. A `Record<Union, T>` gives the same guarantee — that is
what caught the missing `OPERATOR_LABELS` entries when `Operator` was extended.

**Applies to:** `packages/ee/src/workflows/definition/nodes.ts`, and any
`switch (x.type)` over a zod discriminated union.

## A generated catalog must key entity refs off the schema, not off a hand-written hint

```scope
id: a-generated-catalog-must-key-entity-refs-off-the-schema-not
paths: ["packages/ee/src/workflows/catalog/**","packages/database/src/audit.config.ts"]
triggers: ["buildCatalog","fkDisplayRegistry","snapshotFields"]
```

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

**Applies to:** `packages/ee/src/workflows/catalog/build.ts`, and any hand-curated
overlay on generated schema data (`packages/database/src/audit.config.ts`'s
`snapshotFields` / `fkDisplayRegistry`).

## A read-time format-migration seam must run before the current-schema parse

```scope
id: a-read-time-format-migration-seam-must-run-before-the-curren
paths: ["packages/ee/src/workflows/definition/normalize.ts","packages/documents/src/template/**"]
triggers: ["formatVersion","migrateDefinition","FORMAT_VERSION"]
```

**Context:** Versioned JSON documents stored in a JSONB column with a
`formatVersion` sibling column, upgraded on read so stored rows never need a
backfill (`packages/documents/src/template/`, `packages/ee/src/workflows/`).

**Problem:** The workflow definition reader originally parsed the row against the *current*
zod schema and only then called `migrateDefinition`. A document old enough to need
migrating cannot satisfy the current schema by definition, so it failed the parse
and never reached the migration — the seam was dead on arrival. Worse, the parse
failure fell back to an empty canvas, so opening the version in the builder showed
nothing and the next save silently destroyed the stored nodes.

**Rule:** Run the migration on the **raw** JSON, before the current-schema parse.
Default a missing `formatVersion` to `1`, never to `CURRENT_*_FORMAT_VERSION` —
"current" skips the very migration a legacy row needs. Treat a `formatVersion`
greater than current as an explicit failure, and return a discriminated
`{ok: false, failure, message}` rather than an empty document, so a caller can
refuse to save over a row it could not read.

**Applies to:** any read-time `migrate*(payload, _from)` seam —
`packages/ee/src/workflows/definition/normalize.ts`,
`packages/documents/src/template/defaults.ts`.

## Never hand-measure React Flow handle positions; and never `stopPropagation` inside a node

```scope
id: never-hand-measure-react-flow-handle-positions-and-never-sto
paths: ["apps/erp/app/modules/workflows/ui/Builder/**"]
triggers: ["@xyflow/react","useUpdateNodeInternals"]
```

**Context:** `apps/erp/app/modules/workflows/ui/Builder/NodeCard.tsx` needed one
source handle per condition path, and needed nodes draggable from their body.

**Problem:** Two separate self-inflicted bugs. (1) Handle rows were measured with
`getBoundingClientRect()` and the offset written to `style.top`. `getBoundingClientRect()`
returns **zoom-scaled** pixels but `style.top` is applied *inside* the zoom transform,
so every handle sat at the wrong height at any zoom except 1.0 — and the effect
depended on the freshly-built `ports` array, so it re-ran and re-set state every
render. (2) The body used `onPointerDown={e => e.stopPropagation()}` on interactive
targets to stop React Flow dragging. React's `stopPropagation` also stops the native
event reaching `document`, and Radix `DismissableLayer` dismisses on a document-level
`pointerdown` — so every dropdown inside a node became impossible to close.

**Rule:** React Flow measures handle bounds from the DOM itself (zoom-aware) — put
the `<Handle>` inside a `position: relative` row and let its default
`.react-flow__handle-right` CSS anchor it; call `useUpdateNodeInternals(nodeId)`
when the handle set or node size changes, and never compute `top`/`right` yourself.
To exempt something from dragging, toggle React Flow's own `nodrag` class (a
capture-phase `pointerdown` listener runs before its bubble-phase drag listener) —
never `stopPropagation`, which silently breaks every portalled overlay's dismissal.

**Applies to:** `apps/erp/app/modules/workflows/ui/Builder/**`, and any `@xyflow/react`
canvas hosting Radix popovers/selects.

## The `user` table has no `companyId`, so the usual tenancy check cannot be applied to it

```scope
id: the-user-table-has-no-companyid-so-the-usual-tenancy-check-c
paths: ["packages/jobs/src/workflows/actions/update.ts"]
triggers: ["userToCompany","existsInCompany","selectInCompany"]
```

**Rule:** Before writing a "every table has `companyId`" helper, confirm it for
the specific tables it will actually receive. The rest is in
`.claude/rules/workflow-actions.md`.

**Applies to:** `packages/jobs/src/workflows/actions/update.ts`, and any generic
company-scoping helper that takes a table name at run time.
