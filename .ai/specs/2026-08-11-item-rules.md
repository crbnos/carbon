# Sales Rules — commercial & compliance checks on sales documents

- Status: **Ready to implement** (all design questions resolved)
- Date: 2026-08-11
- Research: `.ai/research/2026-08-11-item-rules.md`, `.ai/research/2026-08-12-item-rules-enforcement-surface.md`
- Scope: Phase 1 (data model + engine extensions + admin UI + sales-line enforcement) · Phase 2 (notifications + acknowledgment evidence) · Phase 3 (enforcement completeness — terminal gates through invoice post, unbypassable hard errors)

## Problem

Carbon cannot enforce commercial or compliance restrictions when an item is added to a quote or sales order — e.g. *"if the item type is X and the customer's ship-to country is Y → block"*. Manufacturers need this for export control, distributor-only parts, and customer-status gating.

Two constraints shape the design:

1. **One combined error interface.** All violations on a submission must resolve into a single dialog — never stacked modals, never one dialog per rule.
2. **This is a compliance control, not a hint.** It has to hold at the points that matter, not only where the UI happens to call it — including the paths that skip the normal flow. Carbon lets a user raise a sales invoice with no upstream quote or order at all, so a control that only guards the quote→order→shipment path can be walked around by invoicing the customer directly.

## Design in one paragraph

Carbon already has a working predicate-rule engine behind **Storage Rules** (warehouse/MES transaction surfaces). Sales Rules is the *second family* of rules on that same engine, not a second engine. Both families share one condition-AST compiler, one evaluator shape, one violation modal, and — as of this work — **one table**, `enforcementRule`, discriminated by a `family` column. The sales family adds a customer context root, three sales-document surfaces (quote line, sales order line, sales invoice line), and a set of enforcement gates on the sales lifecycle.

## Data model

One rule table serves both families. The alternative — a table per family — was rejected: the two schemas are 90% identical, and a second table would duplicate the schema, the RLS, the CRUD, and every future column.

### Enums

```sql
CREATE TYPE "enforcementRuleFamily" AS ENUM ('storage', 'sales');

-- One surface catalog spanning both families.
CREATE TYPE "enforcementRuleSurface" AS ENUM (
  -- storage family (warehouse / MES transaction events)
  'receipt', 'shipment', 'stockTransfer', 'warehouseTransfer', 'inventoryAdjustment',
  'place', 'pick', 'operationStart', 'operationFinish', 'materialIssue', 'materialReceive',
  -- sales family (sales-document lines)
  'quoteLine', 'salesOrderLine', 'salesInvoiceLine'
);

CREATE TYPE "enforcementRuleTargetType" AS ENUM ('item', 'workCenter');
```

**A rule must not be able to subscribe to another family's surface** — a storage rule listening on `quoteLine` would silently never fire. With one shared enum the column type can no longer be the guard, so two CHECK constraints take over (below). This is the deliberate cost of the single table: *structural* isolation becomes *constraint + query* isolation.

### `enforcementRule`

```sql
CREATE TABLE "enforcementRule" (
  "id" TEXT NOT NULL DEFAULT id(),
  "companyId" TEXT NOT NULL,
  "family" "enforcementRuleFamily" NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "message" TEXT NOT NULL,                                  -- violation text, {token} interpolation
  "severity" TEXT NOT NULL CHECK ("severity" IN ('error', 'warn')),
  "conditionAst" JSONB NOT NULL,                            -- {kind: all|any|none, conditions:[{field,op,value}]}
  "surfaces" "enforcementRuleSurface"[] NOT NULL,
  -- storage-family shape; sales rows are pinned to the defaults by CHECK
  "targetType" "enforcementRuleTargetType" NOT NULL DEFAULT 'item',
  "appliesToAll" BOOLEAN NOT NULL DEFAULT FALSE,            -- workCenter-target broadcast toggle
  -- item scoping, both families (empty arrays = every item)
  "filteredItemTypes" TEXT[] NOT NULL DEFAULT '{}',
  "filteredItemGroupIds" TEXT[] NOT NULL DEFAULT '{}',
  "filteredItemMatchAll" BOOLEAN NOT NULL DEFAULT FALSE,    -- false = OR, true = AND across the two dimensions
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,

  CONSTRAINT "enforcementRule_surfaces_nonempty" CHECK (array_length("surfaces", 1) >= 1),
  CONSTRAINT "enforcementRule_storage_surfaces" CHECK (
    "family" <> 'storage' OR "surfaces" <@ ARRAY[/* the 11 transaction surfaces */]::"enforcementRuleSurface"[]
  ),
  CONSTRAINT "enforcementRule_sales_surfaces" CHECK (
    "family" <> 'sales' OR "surfaces" <@ ARRAY[
      'quoteLine','salesOrderLine','salesInvoiceLine'
    ]::"enforcementRuleSurface"[]
  ),
  CONSTRAINT "enforcementRule_sales_shape" CHECK (
    "family" <> 'sales' OR ("targetType" = 'item' AND "appliesToAll" = FALSE)
  )
);

ALTER TABLE "enforcementRule" ADD CONSTRAINT "enforcementRule_companyId_family_name_key"
  UNIQUE ("companyId", "family", "name");
```

Name uniqueness is **per family** — the same rule name may legitimately exist once in each family.

Indexes: `companyId`, `createdBy`, and two partial indexes on `(companyId, family)` and `(companyId, targetType)` where `active`.

### Assignment tables

Two tables, not one polymorphic table: a polymorphic `targetId` cannot carry a real foreign key, and losing `ON DELETE CASCADE` from `item`/`workCenter` would leave orphaned pins.

- **`enforcementRuleItemAssignment`** — PK `(itemId, ruleId)`, serves **both** families.
- **`enforcementRuleWorkCenterAssignment`** — PK `(workCenterId, ruleId)`, storage family only.

Both carry `companyId`, audit columns, and a composite FK `(ruleId, companyId) → enforcementRule(id, companyId) ON DELETE CASCADE`.

Because the item table is shared, **a pin alone does not tell you the family**. Every reader must resolve pinned rules against a family-filtered rule fetch — never a PostgREST embed, which would happily return the other family's rule.

### `enforcementRuleAcknowledgment`

Append-only override/block evidence, one row per deduped violation:

`id`, `companyId`, `ruleId` (**soft reference, no FK**), `ruleName` (denormalized), `documentType` (`'quote'|'salesOrder'|'salesInvoice'`), `documentId`, `documentLineId`, `itemId`, `severity`, `outcome` (`'blocked'|'acknowledged'`), `message`, audit columns.

`ruleId` deliberately has no FK so a rule delete can neither cascade evidence away nor be blocked by it; the denormalized `ruleName` plus the verbatim rendered `message` keep each row self-contained. Retiring a rule that has fired should be a deactivation (`active = false`), but deletion stays available without audit loss.

### Company setting

```sql
ALTER TABLE "companySettings"
  ADD COLUMN "salesRuleNotificationGroup" text[] NOT NULL DEFAULT '{}';
```

### Custom fields

The merged table registers **one** `customFieldTable` row (`'enforcementRule'`, `'Rule'`). Both rule editors therefore share a custom-field namespace — an accepted product tradeoff; per-family custom fields would be a UI filter, not a schema change.

## Permissions & RLS

Each family keeps the permission its own domain implies. **Read** is any employee of the company; **writes** are per-family:

| Table | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|
| `enforcementRule` | any employee | `family='storage'` → `inventory_*` · `family='sales'` → `sales_*` |
| `enforcementRuleItemAssignment` | any employee | resolved through the pinned rule's family: storage → `parts_*`, sales → `sales_*` |
| `enforcementRuleWorkCenterAssignment` | any employee | `resources_*` |
| `enforcementRuleAcknowledgment` | any employee | INSERT via `sales_create`; **no UPDATE/DELETE policies** (append-only) |

Two requirements that are easy to get wrong:

- The rule table's UPDATE policy needs **both** `USING` and `WITH CHECK` with the same per-family predicate, or a row could be edited into a family the actor lacks permission for.
- The item-assignment policies correlate to the pinned rule with an `EXISTS`. Inside that subquery an **unqualified** `"companyId"` binds to the *inner* table, silently making the tenant correlation a tautology. Qualify the outer row explicitly: `r."companyId" = "enforcementRuleItemAssignment"."companyId"`.

## Engine (`@carbon/utils`)

The engine is family-neutral and lives in `packages/utils/src/rules.ts` (+ `rule-filters.ts`, `field-registry.ts`, and the zod AST mirror `rules-schema.ts`):

- `ConditionAst = {kind: all|any|none, conditions: [{field, op, value}]}`; operators `eq, neq, in, notIn, isSet, isNotSet, gt, lt`.
- `compileRule` / `compileWithCache` (LRU), `evaluateRules`, `interpolateMessage` (`{token}` support), and required-field semantics — a condition referencing an empty field emits "{label} is required" at the rule's severity.
- `ItemFilter` / `ruleAppliesToItem` / `toItemFilter` — the broadcast item-scoping matcher, shared by both families (`rule-filters.ts`).
- Surface catalogs and per-surface context-availability maps for each family.

Sales additions: a `customer` root on `RuleContext` (`{ id, typeId, statusId, location: { countryCode }, customFields }`), the three sales surfaces, and field-registry entries for **customer type**, **customer status**, and **ship-to country** (alpha-2, matching the app-wide convention) plus synthesized `customer.customFields.*`. Storage-rule behavior is unchanged.

TypeScript keeps the per-family surface unions independent of the DB enum, so the one engine can evaluate either family while each form still offers only its own surfaces.

## Evaluator (`@carbon/ee/rules`)

`packages/ee/src/rules/` holds `storage/` and `sales/` evaluator directories with the shared violation modal + hook at the root. Package exports: `./rules` (client-safe services/UI) and `./rules.server` (both evaluators, `isBlocked`, `dedupeViolations`).

The sales evaluator mirrors the storage one:

- `service.ts` — cross-app queries: active rules for items (incl. broadcasts + filters), assignments for an item, list, assign/unassign.
- `server.ts` — `evaluateSalesRuleLines({ client, companyId, userId, surface, lines, customerId, customerLocationId })` → `{ violations, ruleNames }`. `userId` is required because the service-role client cannot infer the acting user; it lands in `transaction.userId`.
- `context.ts` — builds one `RuleContext` per line: item fields batch-loaded (incl. `customFields`, flattened `itemPostingGroupId`), customer context resolved once per document (`customerTypeId`/`customerStatusId`/`customFields` + `customerLocation.addressId → address.countryCode`).

**Rule selection contract.** Every active rule of the family is a broadcast; empty filters match all items; `filteredItemMatchAll` chooses OR (false) or AND (true) across the type/group dimensions; an explicit pin bypasses the broadcast filters. Per line, pins and broadcasts merge by `ruleId` before evaluation; violations dedupe on `ruleId` + message (+ `lineId` for document-level gates). A line whose item row fails to load matches explicit pins only.

Non-negotiables:

- **Service-role client** (`getCarbonServiceRole()`) — the check must see full truth regardless of the acting user's read permissions. The route's `requirePermissions` remains the action gate.
- **Tenant isolation below the service-role boundary.** RLS is bypassed on this client, so *every* query — rules, pins, items, customer, customerLocation — carries an explicit `companyId` predicate. These predicates ARE the isolation; a service-role query without one is a defect, not a style choice.
- **Family isolation.** Every read filters `family`; pins resolve against a family-filtered fetch. Lock it with a test that fails when the guard is removed.
- **Plan gate** — the existing `SALES_RULES` feature key (`packages/ee/src/plan.ts`, Business/Partner). Evaluation returns no violations when the gate is off.
- **A failed load must not read as "no rules".** A query error that silently yields zero rules or zero items turns enforcement off. Fail loud rather than proceed.
- **Reuse `useRuleViolations` + `RuleViolationModal`** — they are generic over `Violation`. Do not fork the violation UI.
- Missing ship-to: rules referencing `customer.location.countryCode` rely on the engine's required-field semantics — empty → "Customer location is required" at the rule's severity.

## ERP placement

A rule family is not its own ERP domain — it lives inside the domain module it gates. Storage rules live in `~/modules/inventory`; sales rules live in `~/modules/sales`. Neither gets a standalone `~/modules/*` directory.

- `sales.models.ts` — `salesRuleValidator` (surfaces restricted to the two sales surfaces; `.superRefine` rejects a condition on a field whose context the evaluator won't populate for every selected surface), `salesRuleAssignmentValidator`.
- **Admin CRUD is shared, not per-family.** One parametrized implementation in `~/modules/shared` (`getEnforcementRules`, `getEnforcementRule`, `upsertEnforcementRule`, `deleteEnforcementRule`, `getEnforcementRuleAssignmentCounts`); callers pass their family. Duplicating it per module would be two copies of the same query drifting apart.
- Cross-app queries are imported from `@carbon/ee/rules` **directly at the call site**, not re-exported through the module barrel — the package boundary should be visible where it is used.
- `ui/SalesRules/` — `SalesRuleForm.tsx` (ModalDrawer + ValidatedForm) and `SalesRulesTable.tsx`. Reuse the props-driven builder components from the storage UI (`RuleBuilder`, `ConditionRow`, `SurfacesField`, `SeveritySelect`, `MessageWithTokens`, `ItemFilterSelector`) by deep import; parameterize rather than copy, and keep any parameterization additive so storage behavior is preserved. These components must never import a module *barrel* — that would create a cycle.
- The plan-gate upgrade overlay chrome is shared (`~/components/RulesUpgradeOverlay`); each family supplies only its preview table, fixtures, and copy.

## Routes & wiring

- `x+/sales+/sales-rules.tsx` (list), `.new.tsx`, `.$id.tsx`, `.$id.delete.tsx`, plus `sales-rules.assign.$itemId.tsx` / `sales-rules.unassign.$itemId.$ruleId.tsx`. Write routes: `requirePlan({ feature: "SALES_RULES" })` + `create/update/delete: "sales"`.
- Path helpers in `apps/erp/app/utils/path.ts`; react-query key `salesRulesQuery`.
- Sidebar: "Sales Rules" in the Sales → Configure group (`useSalesSubmodules`), beside Pricing Rules.
- Part detail → Inventory tab: a "Sales rules" card beneath the storage-rules card, listing explicit + broadcast rules with assign/unassign.
- Settings → Sales: a "Sales Rule Violations" notification-group card.
- Sales invoice: the two line-write routes (`x+/sales-invoice+/$invoiceId.new.tsx`, `$invoiceId.$lineId.details.tsx`) and the post route (`$invoiceId.post.tsx`) gain the check; the post modal (`SalesInvoicePostModal`) gains the `acknowledged` field and the shared violation modal, which it does not have today.
- Naming discipline: `salesRule*` / `storageRule*` for the family-specific pieces, `enforcementRule*` for the shared table and shared CRUD; never a bare `rule`. The configurator's `configurationRule*` is unrelated.

## Enforcement

### Phase 1 — line-level, for fast feedback

- `x+/quote+/$quoteId.new.tsx` — after validation, before `upsertQuoteLine`: read `acknowledged` from formData, evaluate on surface `quoteLine` with the header's `customerId`/`customerLocationId`, and on `isBlocked` return `{ violations, ruleNames }`.
- `x+/sales-order+/$orderId.new.tsx` — same, before `upsertSalesOrderLine`, surface `salesOrderLine`.
- Line **edit** actions (`$quoteId.$lineId.details.tsx`, `$orderId.$lineId.details.tsx`) — same evaluation, so an edit cannot dodge a rule.
- **Item-only guard:** lines with no `itemId` (e.g. `Comment` sales-order lines) skip evaluation entirely — the guard wraps the evaluation block, never the action.
- Client: `QuoteLineForm` / `SalesOrderLineForm` submit through `useRuleViolations({ action })` and render the shared modal. Coexists with the inline supersession notice and the ConfiguratorModal.

Reference wiring already in production: `x+/shipment+/$shipmentId.post.tsx` (read `acknowledged` → evaluate → dedupe → `isBlocked` → return `{violations, ruleNames}` on block).

### Phase 3 — where the guarantee actually lives

Line-level checks are the right place for *feedback* and the wrong place for *the guarantee*: 14 entry points can put an `itemId` on a sales line, and three of them (direct PostgREST with an API key, `SECURITY DEFINER` RPCs, service-role paths such as the unauthenticated digital-quote accept) execute no Carbon TypeScript at all. The MCP executor resolves any named export of `sales.service.ts` by name, so the very function the enforced route protects is reachable unprotected.

**Principle: a compliance control fails at the document, not the line.** Per-write enforcement must be exhaustive to be worth anything, and this write surface is provably non-exhaustible. Per-*gate* enforcement only has to cover the transitions — and because a gate re-reads the whole document, it catches lines from writers nobody instrumented, plus staleness (rule authored later, ship-to changed, item attributes changed) for free.

| Gate | Route | Note |
|---|---|---|
| Sales order confirm | `x+/sales-order+/$orderId.confirm.tsx` | cleanest — already returns objects rather than redirecting |
| Quote finalize / send | `x+/quote+/$quoteId.finalize.tsx` | add the returned-violations branch **before** the existing `throw redirect(...)` paths |
| Quote → order convert | `x+/quote+/$quoteId.convert.tsx` | gate in the route, before `convertQuoteToOrder`. Also the natural place to evaluate quantity rules — quote quantity is not meaningful until conversion |
| RFQ → quote convert | `x+/sales-rfq+/$rfqId.convert.tsx` | same; evaluate the resulting quote lines' items |
| Shipment post | `x+/shipment+/$shipmentId.post.tsx` | last physical checkpoint; catches orders confirmed before a rule existed. Add sales violations to the array the storage loop already builds |
| **Sales invoice post** | `x+/sales-invoice+/$invoiceId.post.tsx` | the revenue checkpoint, and the only gate that covers an invoice raised with no upstream document — see below |

Gating the two convert routes **in the route** is deliberate: it achieves the same protection as a Deno-side evaluator with none of the cost. The engine is portable, but the evaluator imports `companyHasPlan` → `@carbon/auth` (module-load `process.env`) → `react-router`, and CI runs zero `deno` invocations, so a Node/Deno divergence would be silent. Do not port the evaluator.

`api+/sales.digital-quote.$id.tsx` is **hard-block-on-error only** — there is no employee session, nobody may acknowledge, and internal compliance text must not reach the customer. Log and proceed on warns.

**Unbypassable hard errors.** Move the *error-severity* half of the check into `upsertQuoteLine` and `upsertSalesOrderLine` so the MCP surface is covered — an `error` violation throws. Warn handling stays in the route actions, where `acknowledged` and the modal live. Blocklist `sales_insertSalesOrderLines` (no in-app caller).

**Drop-ship ship-to.** A drop shipment's real destination is `salesOrderShipment.customerLocationId`, not the header's. Resolve the effective ship-to — drop-ship location when present, else header — before evaluating, or a country rule clears orders that ship to the restricted country.

**Supporting change.** `Violation` is `{ruleId, severity, message}` with no line reference. A document-level gate needs per-line attribution so the modal can group violations and deep-link to the offending line — extend it with `lineId` and key the modal by line.

### Sales invoices — closing the "skip the order" bypass

An invoice is where revenue is actually recognised, and Carbon lets you raise one
**without any upstream document**: `x+/sales-invoice+/new.tsx` falls through to a
blank form when no `?sourceDocument` is given, and lines are then added freely
against it. Every other gate in this spec sits on the quote→order→shipment path,
so a restricted item invoiced directly would reach revenue having passed nothing.

**The invoice-line surface.** `salesInvoiceLine` joins `quoteLine` and
`salesOrderLine`, with the same line-level check on the two write routes
(`$invoiceId.new.tsx`, `$invoiceId.$lineId.details.tsx`) and a terminal gate at
post.

**Ship-to is the whole design problem, and it resolves cleanly.** A sales invoice
has **no customer ship-to**. `salesInvoice.customerId` is NOT NULL, so customer
type/status/custom fields resolve exactly as elsewhere — but the only customer
address on the invoice is `invoiceCustomerLocationId`, which is the **bill-to**,
and both `salesInvoice.locationId` and `salesInvoiceShipment.locationId` are
*Carbon's own* warehouse locations, not customer addresses. So:

- **Line came from a sales order** (`salesInvoiceLine.salesOrderId` /
  `salesOrderLineId` are set — the convert path always populates them): resolve
  the ship-to through `resolveSalesOrderShipTo`, exactly as the order gate does.
  Drop-ship handling comes along for free, and re-evaluating here catches
  staleness — a rule authored after the order was confirmed.
- **Standalone line** (`salesOrderLineId IS NULL`): there is no ship-to to
  resolve, and none may be invented. Pass `customerLocationId: null` and let the
  engine's required-field semantics do their job — any rule referencing
  `customer.location.countryCode` raises "Customer location is required" at that
  rule's severity.

That second case *is* the bypass fix, and it is the right shape rather than a
consolation prize: an invoice raised with no order **cannot demonstrate where the
goods went**, so a destination-restricted item does not quietly pass — it blocks
(severity `error`) or demands an acknowledgment (`warn`), and either way the
attempt lands in the evidence table. The bypass path carries strictly *less*
information than the path it skips, so it fails closed instead of open. Rules
that never mention the ship-to — customer status, customer type, item group —
evaluate at full strength on a standalone invoice with no degradation.

**Never substitute the bill-to for the ship-to.** `invoiceCustomerLocationId` is
a different address and frequently a different country; using it would clear a
rule that should have blocked. This is the same failure the drop-ship defect
produced, and it is the one shortcut a future implementer is most likely to take.
(Note `salesInvoiceLocations` looks like it offers a country: it joins
`customerLocation` against *company*-location ids, so its `customerCountryCode`
and `shipmentCountryCode` branches do not resolve for invoices created by either
`insertSalesInvoice` or `convert`. Only its bill-to branch resolves. Do not read
a ship-to from that view.)

**Where the gate goes, and what it does not cover.** Posting is a Deno edge
function (`post-sales-invoice`), so — per the same reasoning that keeps the
convert gates in the route — the check goes in the **route action**
(`$invoiceId.post.tsx`) *before* it invokes the function. Two implementation
details that will bite otherwise: the route optimistically writes
`status = 'Pending'` before invoking, so the gate must run **before** that write
or a blocked post strands the invoice in `Pending`; and the customer email is
sent later in the same action, after the edge function has committed, so a gate
that runs first also prevents the email. A service-role caller invoking the edge
function directly still bypasses this — the same residual hole the other gates
have, and the same reason the error-severity backstop below matters.

**Void is never gated.** Voiding is corrective; blocking it would trap a bad
invoice in a posted state.

**MCP and the unbypassable half.** The MCP backstop currently maps only
`sales_upsertQuoteLine` and `sales_upsertSalesOrderLine` and returns null for
everything else, so every invoicing tool is unchecked. Add
`invoicing_upsertSalesInvoiceLine` → `salesInvoiceLine` to that map, and move the
error-severity check into `upsertSalesInvoiceLine` itself so it holds for callers
that never touch a route.

## Notifications + acknowledgment evidence (Phase 2)

- `packages/notifications`: `NotificationEvent.SalesRuleViolation` (topic Sales; in-app + email).
- `packages/jobs` notify handler: recipients from `companySettings.salesRuleNotificationGroup`. The payload is a **document-level summary**, not a per-violation fan-out: a compound document id (`<quote|salesOrder>:<documentId>:<blocked|acknowledged>` — the JobOperation compound-id precedent; the notify payload's own `documentType` is a narrower DB enum that cannot carry quote/salesOrder) plus the acting user. The handler resolves document reference and customer name for rendering. Per-violation detail deliberately does not ride the notification — the notification is the pointer, the evidence table is the record.
- **Scope & idempotency:** one notification per enforcement-action outcome. A repeated blocked attempt re-notifies deliberately — repeat attempts are signal for compliance, not noise. Violations within one action are already deduped before the single notify fires. A durable per-document dedup key is a recorded follow-up, not v1.
- **Evidence persistence (both outcomes):** insert one `enforcementRuleAcknowledgment` row per deduped violation on **blocked** returns (`outcome: 'blocked'`, `documentLineId` null — no line exists) and on **acknowledged** proceeds. On create actions the acknowledged-path insert runs after the line write so `documentLineId` captures the new line's id; edit actions pass the route's `lineId`.
- **Evidence atomicity:** best-effort, never blocking. A blocked return writes only evidence. On an acknowledged proceed, an evidence-insert failure is logged and the sale proceeds — the business action must never fail because the audit write did. Duplicate rows from client retries are acceptable in an append-only table.

## Known gaps, accepted

- **`acknowledged` is client-supplied.** It is read from FormData with no server-side record that a violation was displayed, so a crafted first submit can skip every `warn`. Errors are unaffected — they block unconditionally. Accepted for v1.
- **The acknowledgment table has writers and no reader.** It is write-only audit until a surface is built for it.
- **Service-only orders skip the shipment checkpoint.** Services are `Non-Inventory` items that are never shipped, so a service-only order goes straight to `To Invoice`. The invoice-post gate now covers them, so this is no longer a hole — but it means the invoice gate, not shipment post, is the last checkpoint for a service.
- **No nightly sweep.** Drafts are a scratchpad — users must be free to experiment, and the confirm gate catches it before it counts. Avoids a cron, a violation-state table, and notification-fatigue tuning.
- **No Postgres trigger.** It could enforce only the error-severity subset (no warn/acknowledge, no interpolated messages), and plan gating has no DB precedent while `CarbonEdition`/`STRIPE_BYPASS_COMPANY_IDS` are invisible to Postgres. A second evaluator in a second language that disagrees with the first is worse than a known gap.
- **No rule-impact preview** ("what does my new rule break?").
- **A service-role caller invoking `post-sales-invoice` directly** bypasses the invoice gate, exactly as one invoking `convert` bypasses the conversion gates. The error-severity check inside `upsertSalesInvoiceLine` is what covers that path; there is no gate inside the edge function itself, because a second evaluator in Deno that disagrees with the first is worse than a known gap.

## Out of scope

Line-value (price/qty/date) context; purchasing surfaces / AVL; supersession fold-in; export-licence entity; MES surfaces. Configurator rules untouched; storage rules untouched except for the shared table, shared CRUD, and shared-component parameterization.

## Also in scope

- Update `apps/erp/app/modules/sales/AGENTS.md` and `apps/erp/app/modules/inventory/AGENTS.md` (shared table, family filtering, shared CRUD), plus `packages/{utils,ee}/AGENTS.md` and affected `.claude/rules` files.
- Tests: context building (customer root, alpha-2 country), field-registry additions, evaluator happy path, required-field (missing ship-to), acknowledged flow, and **cross-family isolation** — a pin pointing at the other family's rule must never enter evaluation.
- Invoice-specific tests: an order-derived invoice line resolves the ship-to through its source order (including drop-ship), and a **standalone** line with a country rule produces the required-field violation rather than passing. The second is the bypass this feature exists to close, so it should fail loudly if someone later "fixes" it by falling back to the bill-to.

## Verification

```bash
pnpm db:migrate && pnpm run generate:types
pnpm exec turbo run typecheck --filter=@carbon/utils --filter=@carbon/ee --filter=@carbon/database --filter=erp --filter=mes
pnpm --filter @carbon/utils test && pnpm --filter @carbon/ee test
pnpm run lint
```

Beyond the gates: exercise the RLS policies with a real authenticated request. The per-family predicates and the assignment-table `EXISTS` correlation cannot be verified by typecheck, tests, or a schema diff — only by a logged-in user hitting the routes.
