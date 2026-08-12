# Workflows Phase 2: Event Catalog — implementation plan

**Spec / source:** `.ai/specs/2026-07-30-workflows-event-catalog.md`
**Branch:** `feat/automation`

## Progress
- [x] Task 1: Grow `CatalogEvent` with `permission` + `match`
- [x] Task 2: Write the hand-written entity registry (`entities.ts`)
- [x] Task 3: Write the hand-written moment declarations (`moments.ts`)
- [x] Task 4: Write the pure `buildCatalog` transform + unit tests
- [x] Task 5: Write the generator script and commit the two generated files
- [x] Task 6: `createEventCatalog()` + barrel exports
- [x] Task 7: Write `scripts/check-workflow-catalog.ts` + CI job
- [x] Task 8: `raiseMoment` in `packages/lib` + the new Inngest event
- [x] Task 9: Raise sites — production + MES
- [x] Task 10: Raise sites — sales (finalizeQuote, convertQuoteToOrder)
- [x] Task 11: Raise sites — four post routes + post-transaction job
- [x] Task 12: Lingui wiring (config include + turbo inputs + extract)
- [x] Task 13: Deploy-time drift check in `packages/checks`
- [x] Task 14: Docs — AGENTS.md, new rule file, spec changelog
- [x] Task 15: Full verification sweep

## Dependencies
Task 2, 3 need Task 1. Task 4 needs 2+3. Task 5 needs 4. Task 6 needs 5.
Task 7 needs 5+6. Task 8 needs 3. Tasks 9–11 need 8 (they are independent of
each other and of 5–7). Task 12 needs 5. Task 13 needs 6. Tasks 14–15 last.

**One deviation from the spec to flag at review:** the spec says `CatalogEvent`
gains `label`, `permission`, `match`. Labels live in a separate generated file
(`labels.generated.ts`) precisely so the runtime catalog never imports Lingui —
so `CatalogEvent` gains only `permission` and `match`, and labels are a parallel
`Record<eventId, MessageDescriptor>` the builder joins by id. A `label` field on
`CatalogEvent` would always be undefined at runtime; leaving it off is honest.

**Global rules for every task:**
- `pnpm` only, never `npm`. Never hand-edit `*.generated.ts` or
  `packages/database/src/types.ts` / `swagger-docs-schema.ts`.
- After any turbo run, check `git status` for
  `packages/database/src/types.ts`, `packages/database/src/swagger-docs-schema.ts`,
  `packages/database/supabase/functions/lib/types.ts` and revert ride-along
  churn with `git checkout -- <file>`. (These are already dirty on this branch
  from phase 1 — do not revert phase-1 changes, only NEW churn from your runs.)
- If TS2589 ("excessively deep") appears in an unrelated erp file, suppress
  with `// @ts-ignore` (NOT `@ts-expect-error`) and keep the generated types
  shallow (explicit `Record<...>` annotations, never inferred deep literals).
- Comments: one-liners only, max 2 lines, only where non-obvious.

---

## Task 1: Grow `CatalogEvent` with `permission` + `match`

**Depends on:** none
**Files:**
- Modify: `packages/workflows/src/definition/catalog.ts` — add `EventMatch` type, two optional fields on `CatalogEvent`
- Modify: `packages/workflows/src/index.ts` — export the new type

**Steps:**
1. In `packages/workflows/src/definition/catalog.ts`, above `CatalogEvent`, add:
   ```ts
   /** How the phase-3 matcher recognises this event. Only the matcher reads it. */
   export type EventMatch =
     | { table: string; operation: "INSERT" | "UPDATE" | "DELETE"; field?: string }
     | { moment: string };
   ```
2. Change `CatalogEvent` to:
   ```ts
   export interface CatalogEvent {
     id: string;
     outputs: Record<string, ValueType>;
     /** Lowercase permission module the subscribing workflow's owner must hold. */
     permission?: string;
     match?: EventMatch;
   }
   ```
   Both new fields optional so `createFixtureCatalog` and all 73 existing tests
   compile untouched. Do NOT edit the fixture data.
3. In `packages/workflows/src/index.ts`, add `EventMatch` to the type exports
   from `./definition/catalog`.

**Verify:**
```bash
pnpm --filter @carbon/workflows test
# Expected: all existing tests pass (73 it() across 3 files)
pnpm --filter @carbon/workflows exec tsgo --noEmit
# Expected: exit 0
```

**Out of scope:** `label` on `CatalogEvent` (see deviation note), `CatalogAction`, `CatalogOperation`.

---

## Task 2: Hand-written entity registry

**Depends on:** Task 1
**Files:**
- Create: `packages/workflows/src/catalog/entities.ts`
- Modify: `packages/workflows/package.json` — add `"@carbon/database": "workspace:*"` to `devDependencies` (type-only usage; NOT `dependencies`)

**Steps:**
1. Add the devDependency, then run `pnpm install` from the repo root.
2. Create `packages/workflows/src/catalog/entities.ts`. Shape:
   ```ts
   import type { ColumnOf, TableName } from "@carbon/database/audit.config";

   /** One column a customer can watch. `ref` names a registry entity the FK points at. */
   interface WatchedColumn {
     label: string;
     ref?: string;
   }

   interface EntityEntry<T extends TableName> {
     table: T;
     label: string;
     /** Lowercase permission module (existing family — never a new one). */
     permission: string;
     /** Present => triggerable (generates created/deleted/changed events). Absent => reference-only. */
     watch?: { [C in ColumnOf<T>]?: WatchedColumn };
   }

   /** Identity helper so `watch` keys are checked against the entry's own table. */
   const entity = <T extends TableName>(entry: EntityEntry<T>) => entry;

   export const WORKFLOW_ENTITY_REGISTRY = {
     purchaseOrder: entity({ table: "purchaseOrder", label: "Purchase order", permission: "purchasing", watch: { ... } }),
     ...
   } as const;

   export type RegistryEntityName = keyof typeof WORKFLOW_ENTITY_REGISTRY;
   ```
3. Fill in exactly these 10 triggerable entries (labels in parens; every `watch`
   key gets `{ label: "<human label>" }`, plus `ref` where noted):
   - `purchaseOrder` (Purchase order, `purchasing`): `status`, `supplierId` (ref `supplier`), `assignee` (ref `user`), `orderDate`, `purchaseOrderType`, `supplierReference`, `supplierLocationId`, `tags`
   - `salesOrder` (Sales order, `sales`): `status`, `customerId` (ref `customer`), `assignee` (ref `user`), `salesPersonId` (ref `user`), `orderDate`, `locationId` (ref `location`), `customerReference`, `completedDate`
   - `job` (Job, `production`): `status`, `assignee` (ref `user`), `dueDate`, `startDate`, `quantity`, `priority`, `deadlineType`, `scrapQuantity`
   - `item` (Item, `parts`): `active`, `revisionStatus`, `replenishmentSystem`, `itemTrackingType`, `defaultMethodType`, `assignee` (ref `user`), `name`, `unitOfMeasureCode`
   - `receipt` (Receipt, `inventory`): `status`, `supplierId` (ref `supplier`), `locationId` (ref `location`), `assignee` (ref `user`), `postingDate`, `invoiced`, `sourceDocument`
   - `shipment` (Shipment, `inventory`): `status`, `customerId` (ref `customer`), `locationId` (ref `location`), `assignee` (ref `user`), `postingDate`, `trackingNumber`, `shippingMethodId`
   - `quote` (Quote, `sales`): `status`, `customerId` (ref `customer`), `assignee` (ref `user`), `estimatorId` (ref `user`), `salesPersonId` (ref `user`), `expirationDate`, `dueDate`, `completedDate`
   - `supplier` (Supplier, `purchasing`): `supplierStatus`, `supplierTypeId`, `accountManagerId` (ref `user`), `assignee` (ref `user`), `name`, `currencyCode`, `taxPercent`
   - `customer` (Customer, `sales`): `customerStatusId`, `customerTypeId`, `accountManagerId` (ref `user`), `assignee` (ref `user`), `name`, `currencyCode`, `salesContactId` (NO ref — its FK is `customerContact`, not `user`; corrected during execution)
   - `nonConformance` (Issue, `quality`): `status`, `priority`, `assignee` (ref `user`), `source`, `nonConformanceTypeId`, `dueDate`, `closeDate`, `locationId` (ref `location`), `quantity`
   (77 watched columns total — all verified to exist in the swagger schema.)
4. Add the 5 reference-only entries (no `watch`):
   - `user` (User, `users`), `jobOperation` (Job operation, `production`),
     `salesInvoice` (Sales invoice, `invoicing`), `purchaseInvoice`
     (Purchase invoice, `invoicing`), `location` (Location, `resources`)
5. Do NOT add a `write` field anywhere — that is phase 5.

**Verify:**
```bash
pnpm --filter @carbon/workflows exec tsgo --noEmit
# Expected: exit 0. Sanity: temporarily rename one watch key to "statusX" —
# must FAIL naming the key — then restore.
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0 (proves the type-only @carbon/database import doesn't break erp)
```

**Out of scope:** any runtime import of `@carbon/database` (type-only!), line-level entities, `write` allowlists.

---

## Task 3: Hand-written moment declarations

**Depends on:** Task 1
**Files:**
- Create: `packages/workflows/src/catalog/moments.ts`

**Steps:**
1. Create the file with this shape (types must live here so `packages/lib` can
   import them; keep zod out — plain types only):
   ```ts
   import type { ValueType } from "../definition/types";

   const entity = (of: string): ValueType => ({ kind: "entity", of });

   interface MomentDeclaration {
     /** Mandatory human label — the generator refuses a moment without one. */
     label: string;
     permission: string;
     outputs: Record<string, ValueType>;
   }

   export const WORKFLOW_MOMENTS = {
     "production.jobReleased": {
       label: "A job is released",
       permission: "production",
       outputs: { job: entity("job"), releasedBy: entity("user") }
     },
     ...
   } as const satisfies Record<string, MomentDeclaration>;

   export type MomentKey = keyof typeof WORKFLOW_MOMENTS;

   /** Entity outputs are passed as a type + id, never a row snapshot. */
   export type MomentEntityRef = { id: string };
   export type MomentPayload<K extends MomentKey> = {
     [O in keyof (typeof WORKFLOW_MOMENTS)[K]["outputs"]]: MomentEntityRef;
   };
   ```
2. The 9 declarations (key → label → outputs; permission is the dot-prefix module
   except `invoicing.*` → `invoicing`):
   - `production.jobReleased` — "A job is released" — `job: entity("job")`, `releasedBy: entity("user")`
   - `production.jobHeld` — "A job is put on hold" — `job: entity("job")`, `heldBy: entity("user")`
   - `production.jobOperationCompleted` — "A job operation is completed" — `job: entity("job")`, `jobOperation: entity("jobOperation")`, `completedBy: entity("user")`
   - `sales.quoteSent` — "A quote is sent" — `quote: entity("quote")`, `sentBy: entity("user")`
   - `sales.quoteAccepted` — "A quote is accepted" — `quote: entity("quote")`, `salesOrder: entity("salesOrder")`
   - `inventory.receiptPosted` — "A receipt is posted" — `receipt: entity("receipt")`, `postedBy: entity("user")`
   - `inventory.shipmentPosted` — "A shipment is posted" — `shipment: entity("shipment")`, `postedBy: entity("user")`
   - `invoicing.salesInvoicePosted` — "A sales invoice is posted" — `salesInvoice: entity("salesInvoice")`, `postedBy: entity("user")`
   - `invoicing.purchaseInvoicePosted` — "A purchase invoice is posted" — `purchaseInvoice: entity("purchaseInvoice")`, `postedBy: entity("user")`

**Verify:**
```bash
pnpm --filter @carbon/workflows exec tsgo --noEmit
# Expected: exit 0. Sanity: delete one `label` line — must fail to compile — restore.
```

**Out of scope:** the 7 deferred moments (job completed, PO issued, SO confirmed, quote lost, NC opened, NC closed, inspection failed) — phase 3.

---

## Task 4: Pure `buildCatalog` transform + tests

**Depends on:** Tasks 2, 3
**Files:**
- Create: `packages/workflows/src/catalog/build.ts`
- Create: `packages/workflows/src/catalog/build.test.ts`

**Steps:**
1. `build.ts` — a pure function; the swagger schema is INJECTED so this package
   never imports `@carbon/database` as a value:
   ```ts
   import type { ValueType } from "../definition/types";
   import type { EventMatch } from "../definition/catalog";

   /** The slice of swagger-docs-schema.ts the builder reads. */
   export interface SwaggerSchema {
     definitions: Record<string, {
       required?: string[];
       properties: Record<string, {
         type?: string;
         format?: string;
         enum?: string[];
         description?: string;
         items?: { type?: string; format?: string };
       }>;
     }>;
   }

   export interface BuiltEvent {
     outputs: Record<string, ValueType>;
     permission: string;
     match: EventMatch;
   }

   export interface BuiltCatalog {
     events: Record<string, BuiltEvent>;
     /** English label text per event id — the generator wraps these in msg``. */
     labels: Record<string, string>;
     entities: Record<string, Record<string, ValueType>>;
   }

   export function buildCatalog(
     registry: typeof import("./entities").WORKFLOW_ENTITY_REGISTRY,
     moments: typeof import("./moments").WORKFLOW_MOMENTS,
     schema: SwaggerSchema
   ): BuiltCatalog
   ```
   (Use real value imports for the two hand-written inputs' types via
   `import { WORKFLOW_ENTITY_REGISTRY } from "./entities"` style typeof — either
   form is fine as long as no `@carbon/database` value import appears.)
2. Record-event generation, per triggerable entity `E` with registry key `k`:
   - `${k}.created` — outputs `{ record: entity(k) }`, match `{ table: E.table, operation: "INSERT" }`, label `A ${lower(E.label)} is created`
   - `${k}.deleted` — outputs `{ record: entity(k) }`, match `{ table: E.table, operation: "DELETE" }`, label `A ${lower(E.label)} is deleted`
   - per watched column `c`: `${k}.${c}.changed` — outputs `{ record: entity(k), before: entity(k), after: entity(k) }`, match `{ table: E.table, operation: "UPDATE", field: c }`, label `A ${lower(E.label)}'s ${watch[c].label} changes`
   where `lower()` lowercases only the first character. NO generic `.updated` event.
3. Moment events: id = key, outputs passed through unchanged, permission from the
   declaration, match `{ moment: key }`, label from the declaration. Throw an
   `Error` naming the moment if a moment output's entity name is not a registry key.
4. Entity properties, for EVERY registry entry (triggerable + reference-only),
   from `schema.definitions[table].properties`, with these rules:
   - Drop: `companyId`, `customFields`, `embedding`, `updatedAt`, `updatedBy`.
   - FK columns (description contains `<fk table='X'`): if `X`, mapped through the
     registry's entries by table name, is a registry entity → `entity(<registryKey>)`;
     else plain `string`. An explicit `watch[c].ref` also produces an entity ref —
     needed because composite FKs like `(supplierId, companyId)` carry no `<fk>`
     note — and buildCatalog THROWS if a `ref` disagrees with a present `<fk>`
     target, so a wrong `ref` can never silently mislabel a property.
   - Labels use "An" before a vowel (`An item is created`, `An issue's status changes`).
   - `format` `"date"` or `"timestamp with time zone"` → `{ kind: "primitive", of: "date" }`.
   - swagger `type` `"integer"`/`"number"` → number; `"boolean"` → boolean;
     `"array"` → `{ kind: "list", of: { kind: "primitive", of: <mapped item type> } }`;
     `"string"` and anything else (incl. `format: "jsonb"`) → string.
   - Throw an `Error` naming table+column if a registry `watch` key is missing
     from the schema definition (the script-side copy of check 3), and naming the
     table if a registry table has no `definitions` entry.
5. `build.test.ts` — plain vitest, feed a small fake `SwaggerSchema` PLUS one
   test that imports the real hand-written inputs with a fake schema. Cover at
   minimum: event counts per entity (8 watched → 10 events), no `.updated` id,
   the three match shapes, before/after outputs on `.changed`, moment
   pass-through, dropped columns absent, FK-to-registry → entity ref,
   FK-to-non-registry → string, date/array/jsonb mappings, throw on unknown
   moment-output entity, throw on watch column missing from schema.

**Verify:**
```bash
pnpm --filter @carbon/workflows test
# Expected: all pass, including new build.test.ts
```

**Out of scope:** file emission (Task 5), labels as msg (Task 5 emits those).

---

## Task 5: Generator script + the two committed files

**Depends on:** Task 4
**Files:**
- Create: `scripts/generate-workflow-catalog.ts`
- Create (generated): `packages/workflows/src/catalog/events.generated.ts`
- Create (generated): `packages/workflows/src/catalog/labels.generated.ts`
- Modify: `package.json` (root) — add script
- Modify: `packages/workflows/package.json` — add `"@lingui/core": "catalog:"` to `dependencies`
- Copy from (precedent): `scripts/generate-agent-kb.ts` (header comment style, ROOT/cwd pattern)

**Steps:**
1. Root `package.json` script:
   ```json
   "generate:workflow-catalog": "tsx scripts/generate-workflow-catalog.ts && pnpm exec biome check --write packages/workflows/src/catalog/"
   ```
2. The script imports `buildCatalog` + both hand-written inputs from
   `packages/workflows/src/catalog/`, imports the schema via
   `import schema from "../packages/database/src/swagger-docs-schema"` (relative
   path from `scripts/`; it runs under tsx from the repo root), calls
   `buildCatalog`, and writes two files, each headed by:
   ```ts
   // GENERATED FILE — do not edit. Run `pnpm run generate:workflow-catalog`.
   ```
3. `events.generated.ts` must import ONLY from `../definition/catalog` and
   `../definition/types` (types), and export with SHALLOW explicit annotations
   (TS2589 guard — never let TS infer a deep literal across 106 entries):
   ```ts
   import type { EventMatch } from "../definition/catalog";
   import type { ValueType } from "../definition/types";

   export interface GeneratedEvent {
     outputs: Record<string, ValueType>;
     permission: string;
     match: EventMatch;
   }

   export const WORKFLOW_EVENTS: Record<string, GeneratedEvent> = { ... };
   export const WORKFLOW_ENTITIES: Record<string, Record<string, ValueType>> = { ... };
   ```
   Emit keys sorted alphabetically (stable diffs).
4. `labels.generated.ts`:
   ```ts
   import type { MessageDescriptor } from "@lingui/core";
   import { msg } from "@lingui/core/macro";

   export const WORKFLOW_EVENT_LABELS: Record<string, MessageDescriptor> = {
     "customer.accountManagerId.changed": msg`A customer's account manager changes`,
     ...
   };
   ```
   One literal msg\`...\` per event id (literal template so Lingui extract sees it),
   keys sorted.
5. Run `pnpm run generate:workflow-catalog`. Run it a second time and confirm
   `git status` shows no further change (idempotent).

**Verify:**
```bash
pnpm run generate:workflow-catalog && git status --porcelain packages/workflows/src/catalog/
# Expected (2nd run): no output for the two generated files
grep -c "changed\"\|created\"\|deleted\"\|jobReleased\|jobHeld\|OperationCompleted\|quoteSent\|quoteAccepted\|Posted" packages/workflows/src/catalog/events.generated.ts
node -e "const s=require('fs').readFileSync('packages/workflows/src/catalog/events.generated.ts','utf8'); console.log('events:', (s.match(/^  \"/gm)||[]).length)"
# Expected: 106 event entries; spot-check purchaseOrder.updated is ABSENT:
grep -n "purchaseOrder.updated" packages/workflows/src/catalog/events.generated.ts
# Expected: no matches (exit 1)
grep -n "@lingui" packages/workflows/src/catalog/events.generated.ts
# Expected: no matches (exit 1)
pnpm --filter @carbon/workflows exec tsgo --noEmit
# Expected: exit 0
```

**Out of scope:** touching `scripts/generate-swagger-docs.ts` or regenerating the swagger schema.

---

## Task 6: `createEventCatalog()` + barrel

**Depends on:** Task 5
**Files:**
- Create: `packages/workflows/src/catalog/catalog.ts`
- Create: `packages/workflows/src/catalog/catalog.test.ts`
- Create: `packages/workflows/src/catalog/index.ts`
- Modify: `packages/workflows/src/index.ts` — re-export the catalog barrel

**Steps:**
1. `catalog.ts`:
   ```ts
   import type { CatalogAction, CatalogOperation, WorkflowCatalog } from "../definition/catalog";
   import { WORKFLOW_ENTITIES, WORKFLOW_EVENTS } from "./events.generated";

   /** Phase 5 plugs real action/operation catalogs into these seams. */
   export function createEventCatalog(options?: {
     getAction?: (id: string) => CatalogAction | undefined;
     getOperation?: (id: string) => CatalogOperation | undefined;
   }): WorkflowCatalog
   ```
   `getEvent(id)` returns `{ id, ...WORKFLOW_EVENTS[id] }` or undefined;
   `getEntity(name)` returns `{ name, properties: WORKFLOW_ENTITIES[name] }` or
   undefined; `getAction`/`getOperation` delegate to the options or return
   undefined. Build `Map`s once at module scope (precedent: `audit.config.ts`
   derived-index pattern).
2. `catalog/index.ts` barrel: export `createEventCatalog`, `WORKFLOW_EVENTS`,
   `WORKFLOW_ENTITIES`, `GeneratedEvent`, `WORKFLOW_ENTITY_REGISTRY`,
   `RegistryEntityName`, `WORKFLOW_MOMENTS`, `MomentKey`, `MomentPayload`,
   `MomentEntityRef`, `buildCatalog` + its types. Do NOT export
   `labels.generated` from this barrel or from `src/index.ts` — it must only be
   importable via the explicit deep path by Vite-built apps. Re-export the
   catalog barrel from `src/index.ts`.
3. `catalog.test.ts` (plain vitest — this doubles as proof the runtime catalog
   is importable without the Lingui macro plugin):
   - `createEventCatalog()` satisfies `WorkflowCatalog`; `getAction`/`getOperation`
     return undefined by default and delegate when supplied.
   - `getEvent("purchaseOrder.status.changed")` has match
     `{ table: "purchaseOrder", operation: "UPDATE", field: "status" }` and
     outputs `record`/`before`/`after` all `{ kind: "entity", of: "purchaseOrder" }`.
   - `getEvent("production.jobReleased")` has match `{ moment: "production.jobReleased" }`.
   - `getEntity("purchaseOrder").properties.supplierId` equals
     `{ kind: "entity", of: "supplier" }`; properties lack `companyId`,
     `customFields`, `updatedAt`, `updatedBy`; `orderTotal` absent.
   - `validateDefinition` (imported from `../definition/validate`) with a real
     trigger on `purchaseOrder.status.changed` and a condition referencing
     `record.supplier.name` → no issues; `record.supplier.notAColumn` →
     `UNKNOWN_VARIABLE`.
   - Trigger listing two real events with different outputs exposes only the
     intersection (reuse the pattern from `validate.test.ts`).
4. Confirm nothing under `src/definition/` imports `src/catalog/`:
   `grep -rn "catalog/" packages/workflows/src/definition/` must be empty.

**Verify:**
```bash
pnpm --filter @carbon/workflows test
# Expected: all pass — including the new catalog.test.ts importing events.generated under plain vitest
grep -rn "from \"../catalog" packages/workflows/src/definition/
# Expected: no matches
```

**Out of scope:** real `getAction`/`getOperation` implementations (phase 5).

---

## Task 7: Build checks script + CI job

**Depends on:** Tasks 5, 6
**Files:**
- Create: `scripts/check-workflow-catalog.ts`
- Modify: `package.json` (root) — add `"check:workflow-catalog": "tsx scripts/check-workflow-catalog.ts"`
- Modify: `.github/workflows/check.yml` — new `catalog` job
- Copy from (precedent): the `lingui` job in `check.yml` (install/cache preamble, lines 93–118)

**Steps:**
1. The script exits non-zero with a plain-English message on any failure. Checks:
   - **Check 1 — every moment is raised somewhere.** Recursively scan `apps/` and
     `packages/` (skip `node_modules`, `dist`, `.turbo`, `*.test.*`, and
     `packages/workflows/src/catalog/` itself) for the literal substring
     `raiseMoment("<key>"` per declared key. Fail naming any unraised moment.
     (Raise-site typos are check 2 and already a compile error — the script
     doesn't duplicate it.)
   - **Check 3 — every registry table + watched column exists.** Import the
     registry and the swagger schema; verify `definitions[table]` and every
     `watch` key. Fail naming entity + column.
   - **Check 4 — committed catalog is fresh.** Rebuild via `buildCatalog` in
     memory and deep-compare (`node:assert` `deepStrictEqual`) against the
     imported `WORKFLOW_EVENTS` / `WORKFLOW_ENTITIES`, and compare the label-id
     sets against `WORKFLOW_EVENT_LABELS`'s keys — compare DATA, not file text,
     so formatting can't flap. On mismatch: "run pnpm run generate:workflow-catalog".
     NOTE: this script MAY import `labels.generated.ts` only if tsx tolerates the
     untransformed `msg` macro — it does NOT (macro throws on plain import). So
     read `labels.generated.ts` as TEXT (`fs.readFileSync`) and extract its
     quoted keys with a regex instead of importing it.
   - **Check 5 — moment declarations well-formed.** Every moment has a non-empty
     `label`; every moment output's entity name is a registry key. (buildCatalog
     already throws for the latter — catching that throw satisfies this.)
2. `check.yml`: append a `catalog` job — copy the `lingui` job verbatim, rename
   to `catalog`/`Catalog`, and replace the last step with
   `- run: pnpm run check:workflow-catalog`.
3. Prove the checks bite, then restore:
   - Comment out one `raiseMoment(` call site (after Task 9 lands; if running
     this task before Task 9, verify check 1 fails for ALL moments and note it) —
     expect non-zero naming the moment.
   - Add a fake watched column `zzz` to the registry — expect check 3 failure
     naming it (and `tsgo` failure).
   - Hand-edit one output in `events.generated.ts` — expect check 4 failure.

**Verify:**
```bash
pnpm run check:workflow-catalog
# Expected (clean tree, after Task 9): exit 0
```

**Out of scope:** the deploy-time drift check (Task 13); running the checks against a live DB.

---

## Task 8: `raiseMoment` + Inngest event registration

**Depends on:** Task 3
**Files:**
- Create: `packages/lib/src/workflows/raise-moment.ts`
- Modify: `packages/lib/src/events.ts` — one new event
- Modify: `packages/lib/package.json` — add export `"./workflows": "./src/workflows/raise-moment.ts"` and `"@carbon/workflows": "workspace:*"` to `dependencies`

**Steps:**
1. In `packages/lib/src/events.ts`, add to `Events`:
   ```ts
   // Workflow moments — raised after a business action commits. Phase 3 consumes.
   "carbon/workflow-moment.raised": {
     data: {
       moment: string;
       companyId: string;
       /** auth.uid() of the actor; null for service-role / background writes. */
       actorId: string | null;
       /** Output name -> entity id, per the moment's declaration. */
       outputs: Record<string, { id: string }>;
     };
   };
   ```
2. `raise-moment.ts`:
   ```ts
   import type { MomentKey, MomentPayload } from "@carbon/workflows";
   import { getLogger } from "@carbon/logger";
   import { inngest } from "../inngest/client";

   const log = getLogger("lib", "workflows");

   /**
    * Announce a business moment after its write committed. Never throws into the
    * caller — losing a moment is a missed workflow; failing the caller is worse.
    */
   export async function raiseMoment<K extends MomentKey>(
     key: K,
     payload: MomentPayload<K> & { companyId: string; actorId: string | null }
   ): Promise<void> {
     try {
       const { companyId, actorId, ...outputs } = payload;
       await inngest.send({
         name: "carbon/workflow-moment.raised",
         data: { moment: key, companyId, actorId, outputs: outputs as Record<string, { id: string }> }
       });
     } catch (err) {
       log.error("Failed to raise workflow moment", { key, err });
     }
   }
   ```
   If `@carbon/logger` isn't already a dependency of `packages/lib`, use the
   import style `packages/lib/src/inngest/client.ts` uses (`@carbon/logger/inngest`
   proves the package is available) — plain `@carbon/logger` with `getLogger`.
3. `pnpm install` after the package.json edits.
4. Check `packages/lib` has no circular dep: `@carbon/workflows` depends only on
   `@carbon/utils` + `zod`, so lib → workflows is acyclic. If tsgo reports a
   cycle, STOP and report — do not improvise.

**Verify:**
```bash
pnpm --filter @carbon/lib exec tsgo --noEmit
# Expected: exit 0
pnpm --filter @carbon/workflows exec tsgo --noEmit
# Expected: exit 0
```

**Out of scope:** any consumer of `carbon/workflow-moment.raised` (phase 3); Inngest function registration.

---

## Task 9: Raise sites — production (ERP) + MES

**Depends on:** Task 8
**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` — `updateJobStatus` (lines ~2345–2373)
- Modify: `apps/erp/app/routes/x+/job+/$jobId.status.tsx` — pass `companyId`
- Modify: `apps/mes/app/services/operations.service.ts` — `finishJobOperation` (lines 151–199)

**Steps:**
1. `updateJobStatus` currently returns the un-awaited update builder and takes no
   `companyId`. Restructure:
   - Add `companyId: string` to `params`.
   - Before the update, read the prior status:
     `const prior = await client.from("job").select("status").eq("id", id).maybeSingle();`
   - Await the existing update into `const result = await client.from("job").update({...}).eq("id", id);`
   - After it, raise only on a genuine transition:
     ```ts
     if (!result.error && prior.data && prior.data.status !== status) {
       if (status === "Ready") {
         await raiseMoment("production.jobReleased", {
           job: { id }, releasedBy: { id: updatedBy }, companyId, actorId: updatedBy
         });
       } else if (status === "Paused") {
         await raiseMoment("production.jobHeld", {
           job: { id }, heldBy: { id: updatedBy }, companyId, actorId: updatedBy
         });
       }
     }
     return result;
     ```
   - Import: `import { raiseMoment } from "@carbon/lib/workflows";` — safe in a
     `.service.ts` by the in-tree precedent
     (`documents.service.ts` imports `trigger` from `@carbon/jobs`, which
     constructs the same Inngest client; `sideEffects: false` tree-shakes it out
     of the browser bundle). If the erp client build breaks on a node built-in
     after this import, STOP and report — the fallback is moving the raise to the
     route, but that loses MCP callers and needs a user decision.
2. Update the single caller `apps/erp/app/routes/x+/job+/$jobId.status.tsx`
   (line ~125): add `companyId` to the `updateJobStatus` call — `companyId` is
   already in scope from `requirePermissions` (line 20).
3. Run `pnpm run generate:mcp`; commit any regenerated
   `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json` churn caused by the
   signature change (MCP passes args by declared param names).
4. `finishJobOperation` (MES): inside the existing `if (!result.error) { ... }`
   block, after `await returnAllocatedRemaindersAtJobComplete(client, args);`
   (line ~195), add:
   ```ts
   const op = await client
     .from("jobOperation")
     .select("jobId")
     .eq("id", args.jobOperationId)
     .maybeSingle();
   if (op.data?.jobId) {
     await raiseMoment("production.jobOperationCompleted", {
       job: { id: op.data.jobId },
       jobOperation: { id: args.jobOperationId },
       completedBy: { id: args.userId },
       companyId: args.companyId,
       actorId: args.userId
     });
   }
   ```
   Same `@carbon/lib/workflows` import.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: exit 0 (package name is `erp`, NOT @carbon/erp — wrong name silently no-ops)
```

**Out of scope:** raising on `In Progress`/`Completed`/other statuses; the job-completed moment (deferred, phase 3).

---

## Task 10: Raise sites — sales

**Depends on:** Task 8
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — `finalizeQuote` (~line 1952), `convertQuoteToOrder` (~line 183)
- Modify: `apps/erp/app/routes/x+/quote+/$quoteId.finalize.tsx` — pass `companyId`

**Steps:**
1. `finalizeQuote(client, quoteId, userId)` currently returns the second update
   un-awaited and has no `companyId`. Restructure:
   - Signature → `finalizeQuote(client, quoteId, userId, companyId: string)`.
   - Await the trailing `quoteLine` update into `const lineUpdate = await ...`.
   - After it: `if (!lineUpdate.error) { await raiseMoment("sales.quoteSent", { quote: { id: quoteId }, sentBy: { id: userId }, companyId, actorId: userId }); }`
   - `return lineUpdate;`
2. Update its single caller `apps/erp/app/routes/x+/quote+/$quoteId.finalize.tsx`
   (line ~122) to pass `companyId` (in scope at line 30).
3. `convertQuoteToOrder` currently returns the un-awaited
   `client.functions.invoke`. Restructure:
   ```ts
   const result = await client.functions.invoke<{ convertedId: string }>("convert", {
     body: { type: "quoteToSalesOrder", ...payload }
   });
   if (!result.error && result.data?.convertedId) {
     await raiseMoment("sales.quoteAccepted", {
       quote: { id: payload.id },
       salesOrder: { id: result.data.convertedId },
       companyId: payload.companyId,
       actorId: payload.userId
     });
   }
   return result;
   ```
   No caller changes needed (both callers already `await` and check `.error`).
4. Run `pnpm run generate:mcp` again (finalizeQuote signature changed); commit metadata churn.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
pnpm run check:workflow-catalog
# Expected: check 1 no longer lists sales.quoteSent / sales.quoteAccepted as unraised
```

**Out of scope:** the digital-quote route (`api+/sales.digital-quote.$id.tsx`) — it calls `convertQuoteToOrder`, so the service-level raise already covers it; quote-lost (deferred).

---

## Task 11: Raise sites — posting moments

**Depends on:** Task 8
**Files:**
- Modify: `apps/erp/app/routes/x+/receipt+/$receiptId.post.tsx`
- Modify: `apps/erp/app/routes/x+/shipment+/$shipmentId.post.tsx`
- Modify: `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.post.tsx`
- Modify: `apps/erp/app/routes/x+/purchase-invoice+/$invoiceId.post.tsx`
- Modify: `packages/jobs/src/inngest/functions/tasks/post-transaction.ts`

These writes happen inside Deno edge functions that cannot import app code, so
each real CALLER raises after the invoke returns cleanly. `raiseMoment` never
throws, so calling it inside the routes' `try` blocks cannot trigger their
status-rollback `catch` paths — but place calls AFTER the try/catch where noted
anyway, to keep the rollback paths obviously untouched.

**Steps:**
1. Receipt route: immediately after the `postReceipt.error` guard closes
   (line ~232, still inside the `try`), add:
   `await raiseMoment("inventory.receiptPosted", { receipt: { id: receiptId }, postedBy: { id: userId }, companyId, actorId: userId });`
2. Shipment route: same pattern after the `postShipment.error` guard (line ~278):
   `await raiseMoment("inventory.shipmentPosted", { shipment: { id: shipmentId }, postedBy: { id: userId }, companyId, actorId: userId });`
3. Sales-invoice route: at line ~100, AFTER the try/catch closes and BEFORE
   `const salesInvoice = await getSalesInvoice(serviceRole, invoiceId);`:
   `await raiseMoment("invoicing.salesInvoicePosted", { salesInvoice: { id: invoiceId }, postedBy: { id: userId }, companyId, actorId: userId });`
4. Purchase-invoice route: at line ~110, AFTER the try/catch closes (the `catch`
   rolls status back to Draft — do not insert inside it):
   `await raiseMoment("invoicing.purchaseInvoicePosted", { purchaseInvoice: { id: invoiceId }, postedBy: { id: userId }, companyId, actorId: userId });`
5. `post-transaction.ts` (Inngest, `retries: 3`): add a SEPARATE step after the
   existing `step.run("post-transaction", ...)` resolves (after line ~133), so a
   retry of the raise can never re-run the posting step:
   ```ts
   if (result.success) {
     await step.run("raise-moment", async () => {
       const base = { companyId: payload.companyId, actorId: payload.userId ?? null };
       if (payload.type === "receipt") {
         await raiseMoment("inventory.receiptPosted", { receipt: { id: payload.documentId }, postedBy: { id: payload.userId }, ...base });
       } else if (payload.type === "shipment") {
         await raiseMoment("inventory.shipmentPosted", { shipment: { id: payload.documentId }, postedBy: { id: payload.userId }, ...base });
       } else if (payload.type === "purchase-invoice") {
         await raiseMoment("invoicing.purchaseInvoicePosted", { purchaseInvoice: { id: payload.documentId }, postedBy: { id: payload.userId }, ...base });
       }
     });
   }
   ```
   Adjust to the file's actual payload field names if they differ — if
   `documentId`/`userId` are named differently, STOP and re-read the file rather
   than guessing. Import from `@carbon/lib/workflows` (jobs already depends on
   `@carbon/lib`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs
# Expected: exit 0
pnpm run check:workflow-catalog
# Expected: exit 0 — all 9 moments now have at least one raise site
```

**Out of scope:** the edge functions themselves; dedupe logic (phase 1's run dedupe key handles double delivery in phase 3+).

---

## Task 12: Lingui wiring

**Depends on:** Task 5
**Files:**
- Modify: `lingui.config.js` — add `"packages/workflows/src"` to the `erp` catalog's `include` array (precedent: `"packages/glossary/src"` already there)
- Modify: `turbo.json` — add `"packages/workflows/src/**"` to `//#lingui:compile`'s `inputs`

**Steps:**
1. Make both edits.
2. Run `pnpm run lingui:extract`. KNOWN QUIRK on this branch: extract dumps
   large stale `.po` churn. Inspect
   `git diff --stat packages/locale/locales/en/erp.po` and confirm the new
   catalog msgids are present:
   `grep -c "A purchase order is created" packages/locale/locales/en/erp.po` → ≥1.
   If the churn is the known ~120k-line stale noise, revert everything except
   `en/erp.po` additions ONLY if the user has previously endorsed that split —
   otherwise leave the full extract result uncommitted and flag it in the final
   report for the user to decide.

**Verify:**
```bash
grep -c "msgid \"A purchase order's status changes\"" packages/locale/locales/en/erp.po
# Expected: 1
pnpm run lingui:compile
# Expected: exit 0
```

**Out of scope:** translating the new strings (the `/translate` flow is separate); mes catalog (labels are erp-only for now).

---

## Task 13: Deploy-time drift check

**Depends on:** Task 6
**Files:**
- Create: `packages/checks/src/scripts/check-workflow-drift.ts`
- Modify: `packages/checks/package.json` — add script `"workflow-drift": "tsx src/scripts/check-workflow-drift.ts"` and `"@carbon/workflows": "workspace:*"` to `devDependencies`
- Copy from (precedent): `packages/checks/src/scripts/run-invariants.ts` (DB connection + exit-code pattern)

**Steps:**
1. The script (needs a live DB — NOT wired into `check.yml`, NOT a floor gate,
   matching how `invariants` is handled):
   - Connect with `pg` the way `run-invariants.ts` does.
   - Query every active workflow:
     `SELECT w."id", w."companyId", w."activeVersionId", v."nodes" FROM "workflow" w JOIN "workflowVersion" v ON v."id" = w."activeVersionId" AND v."companyId" = w."companyId" WHERE w."active" = true`
   - For each: extract event ids from trigger nodes
     (`nodes` JSONB → entries with `type === "trigger"` → `data.events`),
     compare as a set against
     `SELECT "eventId" FROM "workflowTriggerEvent" WHERE "workflowId" = $1 AND "companyId" = $2`,
     and check every id exists via `createEventCatalog().getEvent(id)`.
   - Print each drifted workflow (id, companyId, missing/extra/unknown ids);
     exit 1 if any, else print `workflow-drift: ok (N active workflows)` exit 0.
2. Do NOT run it against a live DB in this phase (no rebuilds, no migrations —
   there are zero active workflows anyway). Verification is typecheck + tests only.

**Verify:**
```bash
pnpm --filter @carbon/checks exec tsgo --noEmit
# Expected: exit 0
pnpm --filter @carbon/checks test
# Expected: existing tests pass
```

**Out of scope:** wiring into CI or `FLOOR_GATES` (needs DB); fixing any drift it might find later.

---

## Task 14: Docs

**Depends on:** Tasks 1–13
**Files:**
- Modify: `packages/workflows/AGENTS.md`
- Create: `.claude/rules/workflow-event-catalog.md`
- Modify: `.ai/specs/2026-07-30-workflows-event-catalog.md` — changelog entry + the CatalogEvent `label` deviation
- Copy from (precedent): `.claude/rules/agent-knowledge-base.md` (tone/shape for a generated-artifact rule)

**Steps:**
1. `packages/workflows/AGENTS.md`: add a `src/catalog/` section to the Layout
   block and rules: regenerate with `pnpm run generate:workflow-catalog`, never
   hand-edit `*.generated.ts`; the label split exists because `msg` is a
   build-time macro (plain Node/vitest cannot import `labels.generated.ts`);
   `src/definition/` must never import `src/catalog/`; `@carbon/database` is
   type-only (devDependency).
2. New rule `.claude/rules/workflow-event-catalog.md` with frontmatter
   `paths: ["packages/workflows/src/catalog/**", "scripts/generate-workflow-catalog.ts", "scripts/check-workflow-catalog.ts"]`
   covering: the two hand-written inputs, the generator, the two outputs, the
   five checks, how to add an entity/moment, and the raise-site rules (service
   function over route; after the committed write; raiseMoment never throws).
3. Spec changelog: implementation date + the `CatalogEvent.label` deviation
   (labels live only in `labels.generated.ts`; the interface carries
   `permission`/`match` only).

**Verify:**
```bash
ls .claude/rules/workflow-event-catalog.md
# Expected: exists; content matches the implemented reality (spot-check paths)
```

**Out of scope:** product docs under `docs/` (no user-facing surface exists yet); `.codex/rules/` (install script copies it).

---

## Task 15: Full verification sweep

**Depends on:** all
**Steps:**
1. Regenerate + idempotency: `pnpm run generate:workflow-catalog` twice → clean `git status` on the catalog dir.
2. Checks: `pnpm run check:workflow-catalog` → exit 0. Then the three bite-tests
   from Task 7 step 3 (break, observe failure, restore).
3. Tests: `pnpm --filter @carbon/workflows test` and `pnpm --filter @carbon/checks test`.
4. Typecheck (scoped — whole-repo OOMs):
   `pnpm exec turbo run typecheck --filter=@carbon/workflows --filter=@carbon/lib --filter=@carbon/jobs --filter=@carbon/checks --filter=erp --filter=mes`
   If turbo cache masks a result, rerun the failing package with
   `pnpm --filter <pkg> exec tsgo --noEmit` directly.
5. Lint: `pnpm exec biome check packages/workflows packages/lib packages/checks scripts apps/erp/app/modules/production apps/erp/app/modules/sales apps/mes/app/services`
   — fix error-severity only; leave pre-existing warnings.
6. Ride-along churn: `git status` — revert NEW churn in the three generated
   `@carbon/database` files (do not revert phase-1 edits already on the branch).
7. Report results with command output. Do NOT commit — the user commits on
   explicit ask only.

**Verify:** the commands above ARE the verification; expected outputs inline.

**Out of scope:** browser testing (no UI exists), database rebuilds, Inngest dev-UI verification (requires the local stack; offer it to the user instead of running it unprompted).
