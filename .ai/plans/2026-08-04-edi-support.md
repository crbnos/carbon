# EDI Support (Phase 1, sell-side via provider) — implementation plan

**Spec:** .ai/specs/2026-08-04-edi-support.md
**Research:** .ai/research/edi-support.md
**Branch:** edi-support-research-spec

Two plan-level refinements vs. the spec text (spec updated in the same commit as this plan):

1. **Inbound processing runs in the ERP webhook route, not an Inngest job.** Sales-order
   creation must reuse `insertSalesOrder` / `insertSalesOrderLines` / `resolvePrice`, which
   live in `apps/erp/app/modules/sales/sales.service.ts` — the jobs package cannot import
   ERP app code. The provider redelivers webhooks on non-2xx, which supplies the retry
   semantics the queue would have. Outbound (855/856/810) stays on the event-system →
   Inngest rail as specced.
2. **The 855 trigger cannot filter on `status = 'Confirmed'`.** The confirm route
   (`x+/sales-order+/$orderId.confirm.tsx`) sets status from `getSalesOrderStatus(...)`
   (`packages/utils/src/status.ts`), which may produce `To Ship and Invoice` etc. directly.
   The EDI event handler instead fires when status is NOT one of
   `Draft` / `Needs Approval` / `Cancelled` AND no acknowledgment document exists yet for
   that order (dedup-by-existing-document).

## Progress

- [x] Task 1: Create the `edi-support` migration
- [x] Task 2: Regenerate DB types
- [x] Task 3: EDI framework in `@carbon/ee` (canonical types, provider registry, pure helpers + tests)
- [x] Task 4: Orderful adapter + integration registration (⚠️ e2e verification gated on vendor account)
- [x] Task 5: Event-system plumbing (`HandlerTypeSchema`, `Events`, `taskToEvent`)
- [x] Task 6: Sales module models (zod validators + enum arrays)
- [x] Task 7: Sales module service functions (partner CRUD, subscriptions, inbound processing, release/reject, ack)
- [x] Task 8: Webhook ingress route + path helpers (runtime curl deferred to Task 15 stack boot)
- [x] Task 9: EDI event handler + queue dispatch (`@carbon/jobs`)
- [x] Task 10: Outbound send job + ack-reconcile cron (`@carbon/jobs`)
- [x] Task 11: Customer detail → EDI tab UI
- [x] Task 12: EDI documents queue list UI + sales nav entry
- [x] Task 13: EDI document detail drawer UI (Release / Reject / Retry, inline issue fixes)
- [x] Task 14: Sync `apps/erp/app/modules/sales/AGENTS.md`
- [x] Task 15: Browser verification via /test

## Dependencies

- Task 2 needs Task 1. Task 4 needs Task 3. Task 6 needs Task 2.
- Task 7 needs Tasks 2, 3, 5, 6. Task 8 needs Tasks 4, 7.
- Task 9 needs Tasks 2, 3, 5. Task 10 needs Tasks 2, 3, 4, 5.
- Tasks 11–12 need Tasks 6, 7. Task 13 needs Tasks 7, 12.
- Independent groups (parallel-safe): {1→2} ∥ {3→4} ∥ {5}; later {9, 10} ∥ {11, 12, 13}.
- Task 14 needs 1–13; Task 15 is last.

---

## Task 1: Create the `edi-support` migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_edi-support.sql` (via CLI, never hand-named)
- Copy from (precedent): `packages/database/supabase/migrations/20250209170952_shipment.sql` (table+RLS shape), `20251127091215_add_linear_integration.sql` (integration seed), `20260326120000_fix-embedding-triggers.sql` (handlerType CHECK widening)

**Steps:**

1. Run `pnpm db:migrate:new edi-support`. Confirm the generated timestamp is ≥ `20260804111631` (newest on branch: `20260804111631_picked-material-return-timing.sql`) and its HHMMSS is not `000000`.
2. Write the following SQL into the new file (idempotent throughout — the deploy runner retries failed files over committed partial state):

```sql
-- Enums
DO $$ BEGIN
  CREATE TYPE "ediDocumentType" AS ENUM
    ('Purchase Order', 'Purchase Order Acknowledgment', 'Advance Ship Notice', 'Invoice');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ediDocumentDirection" AS ENUM ('Inbound', 'Outbound');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ediDocumentStatus" AS ENUM
    ('Received', 'Needs Review', 'Posted', 'Rejected', 'Pending', 'Sent', 'Acknowledged', 'Failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ediReleaseMode" AS ENUM ('Automatic', 'Review');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tables (copy the four CREATE TABLE blocks verbatim from the spec's Data Model Changes
-- section, .ai/specs/2026-08-04-edi-support.md, wrapping each as CREATE TABLE IF NOT EXISTS):
--   "ediTradingPartner", "ediTradingPartnerDocument", "ediTradingPartnerLocation", "ediDocument"

-- Indexes (companyId + every FK, per conventions-database.md)
CREATE INDEX IF NOT EXISTS "ediTradingPartner_companyId_idx" ON "ediTradingPartner" ("companyId");
CREATE INDEX IF NOT EXISTS "ediTradingPartner_customerId_idx" ON "ediTradingPartner" ("customerId");
CREATE INDEX IF NOT EXISTS "ediTradingPartner_createdBy_idx" ON "ediTradingPartner" ("createdBy");
CREATE INDEX IF NOT EXISTS "ediTradingPartnerDocument_companyId_idx" ON "ediTradingPartnerDocument" ("companyId");
CREATE INDEX IF NOT EXISTS "ediTradingPartnerDocument_partner_idx" ON "ediTradingPartnerDocument" ("tradingPartnerId");
CREATE INDEX IF NOT EXISTS "ediTradingPartnerDocument_createdBy_idx" ON "ediTradingPartnerDocument" ("createdBy");
CREATE INDEX IF NOT EXISTS "ediTradingPartnerLocation_companyId_idx" ON "ediTradingPartnerLocation" ("companyId");
CREATE INDEX IF NOT EXISTS "ediTradingPartnerLocation_partner_idx" ON "ediTradingPartnerLocation" ("tradingPartnerId");
CREATE INDEX IF NOT EXISTS "ediTradingPartnerLocation_customerLocationId_idx" ON "ediTradingPartnerLocation" ("customerLocationId");
CREATE INDEX IF NOT EXISTS "ediTradingPartnerLocation_createdBy_idx" ON "ediTradingPartnerLocation" ("createdBy");
CREATE UNIQUE INDEX IF NOT EXISTS "ediDocument_externalId_unique"
  ON "ediDocument" ("companyId", "externalId") WHERE "externalId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "ediDocument_status_idx" ON "ediDocument" ("companyId", "status");
CREATE INDEX IF NOT EXISTS "ediDocument_partner_idx" ON "ediDocument" ("companyId", "tradingPartnerId");
CREATE INDEX IF NOT EXISTS "ediDocument_createdBy_idx" ON "ediDocument" ("createdBy");

-- RLS: for EACH of the four tables ("ediTradingPartner", "ediTradingPartnerDocument",
-- "ediTradingPartnerLocation", "ediDocument"), emit this exact block with <t> replaced:
--   ALTER TABLE "public"."<t>" ENABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS "SELECT" ON "public"."<t>";
--   CREATE POLICY "SELECT" ON "public"."<t>" FOR SELECT USING (
--     "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[])
--   );
--   DROP POLICY IF EXISTS "INSERT" ON "public"."<t>";
--   CREATE POLICY "INSERT" ON "public"."<t>" FOR INSERT WITH CHECK (
--     "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
--   );
--   DROP POLICY IF EXISTS "UPDATE" ON "public"."<t>";
--   CREATE POLICY "UPDATE" ON "public"."<t>" FOR UPDATE USING (
--     "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
--   );
--   DROP POLICY IF EXISTS "DELETE" ON "public"."<t>";
--   CREATE POLICY "DELETE" ON "public"."<t>" FOR DELETE USING (
--     "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
--   );
-- (SELECT uses the tightened sales_view variant, per the spec's acceptance criteria.)

-- Provider integration seed row (Linear precedent)
INSERT INTO "integration" ("id", "jsonschema")
VALUES ('orderful',
  '{"type":"object","properties":{"apiKey":{"type":"string"},"webhookSecret":{"type":"string"},"environment":{"type":"string","enum":["sandbox","production"]}},"required":["apiKey","webhookSecret"]}')
ON CONFLICT ("id") DO NOTHING;

-- Widen the event-system handlerType CHECK (current list from 20260326120000)
ALTER TABLE "eventSystemSubscription" DROP CONSTRAINT IF EXISTS "eventSystemSubscription_handlerType_check";
ALTER TABLE "eventSystemSubscription" ADD CONSTRAINT "eventSystemSubscription_handlerType_check"
  CHECK ("handlerType" IN ('WEBHOOK','WORKFLOW','SYNC','SEARCH','AUDIT','EMBEDDING','EDI'));

-- Attach async event triggers to "shipment" ONLY if absent. Do NOT re-call
-- attach_event_trigger for "salesOrder"/"salesInvoice" (already attached in
-- 20260119084845; re-calling with empty arrays would DROP their existing sync
-- interceptors, e.g. prevent_posted_sales_invoice_deletion).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = '"shipment"'::regclass AND tgname LIKE 'trg_event_async_%'
  ) THEN
    PERFORM attach_event_trigger('shipment', ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
  END IF;
END $$;
```

3. Before finishing: `grep -rn "attach_event_trigger('shipment'" packages/database/supabase/migrations/` — if a hit exists with non-empty interceptor arrays, keep the guard as written (it will skip); if a hit exists that this branch added, STOP and report — do not double-attach.

**Verify:**
```bash
pnpm db:migrate
# Expected: applies the new migration with no error, then regenerates types.
PORT_DB=$(grep '^PORT_DB' .env.local | cut -d= -f2); PGPASSWORD=postgres psql -h 127.0.0.1 -p "$PORT_DB" -U postgres -d postgres \
  -c 'SELECT count(*) FROM "ediTradingPartner";' \
  -c "SELECT conname FROM pg_constraint WHERE conname = 'eventSystemSubscription_handlerType_check';" \
  -c "SELECT id FROM \"integration\" WHERE id = 'orderful';"
# Expected: 0 | eventSystemSubscription_handlerType_check | orderful
```

**Out of scope:** No changes to existing tables' columns; no per-company subscription backfill (subscriptions are created lazily in Task 7); no edits to any applied migration.

---

## Task 2: Regenerate DB types

**Depends on:** Task 1
**Files:**
- Modify (generated): `packages/database/src/types.ts`, `packages/database/src/swagger-docs-schema.ts`, `packages/database/supabase/functions/lib/types.ts`

**Steps:**
1. Run `pnpm run generate:types` (if `pnpm db:migrate` in Task 1 already regenerated, this is a no-op — run it anyway).
2. Commit the regenerated files with the migration (types regen is normal and committed).

**Verify:**
```bash
grep -c 'ediDocument\|ediTradingPartner' packages/database/src/types.ts
# Expected: a number > 0
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit 0
```

**Out of scope:** Never hand-edit the generated files.

---

## Task 3: EDI framework in `@carbon/ee`

**Depends on:** none (self-contained types; runs parallel with Tasks 1–2)
**Files:**
- Create: `packages/ee/src/edi/types.ts` — canonical payloads + issue shape
- Create: `packages/ee/src/edi/provider.ts` — `EdiProvider` interface + registry
- Create: `packages/ee/src/edi/validate.ts` — pure validation helpers
- Create: `packages/ee/src/edi/build.ts` — pure outbound payload builders
- Create: `packages/ee/src/edi/validate.test.ts`, `packages/ee/src/edi/build.test.ts`
- Create: `packages/ee/src/edi/lib/index.ts` (client-safe barrel: types only), `packages/ee/src/edi/lib/index.server.ts` (server barrel: provider registry, validate, build)
- Modify: `packages/ee/package.json` — add `"./edi": "./src/edi/lib/index.ts"`, `"./edi.server": "./src/edi/lib/index.server.ts"` to `exports` (copy the `./linear` / `./linear.server` entry shape)
- Copy from (precedent): `packages/ee/src/paperless-parts/lib/utils.test.ts` (vitest shape in ee)

**Steps:**
1. `types.ts`: define and export:
   - `EdiDocumentType = "Purchase Order" | "Purchase Order Acknowledgment" | "Advance Ship Notice" | "Invoice"` and `EdiDocumentDirection`, `EdiDocumentStatus`, `EdiReleaseMode` string unions mirroring the DB enums exactly.
   - `EdiIssue = { code: "unknown-partner" | "unknown-ship-to" | "unknown-part" | "price-mismatch" | "duplicate-reference" | "missing-reference" | "provider-rejected" | "unacknowledged"; message: string; path?: string; context?: Record<string, string | number> }`.
   - `EdiOrderPayload` exactly as in the spec (partnerReference, orderDate, requestedShipDate?, shipTo {code,name?,address?}, lines[{partnerLineNumber, partnerPartId, partnerPartRevision?, quantity, unitOfMeasure, unitPrice, requestedDate?}]).
   - `EdiAckPayload = { partnerReference: string; accepted: true }`, `EdiShipNoticePayload = { partnerReference: string; shipDate: string; trackingNumber?: string; shipVia?: string; lines: Array<{ partnerPartId: string; quantity: number; unitOfMeasure: string }> }`, `EdiInvoicePayload = { partnerReference: string; invoiceNumber: string; invoiceDate: string; currencyCode: string; lines: Array<{ partnerPartId: string; quantity: number; unitOfMeasure: string; unitPrice: number }>; total: number }`, and `EdiOutboundPayload` union.
   - `ParsedEdiWebhook = { kind: "transaction"; externalId: string; documentType: EdiDocumentType; payload?: EdiOrderPayload } | { kind: "acknowledgment"; externalId: string; accepted: boolean; reasons: string[] }`.
2. `provider.ts`:
   ```ts
   export type EdiProviderCredentials = { apiKey: string; webhookSecret: string; environment?: "sandbox" | "production" };
   export interface EdiProvider {
     readonly id: "orderful";
     parseWebhook(args: { rawBody: string; signature: string | null; secret: string }): Promise<ParsedEdiWebhook | null>; // null = bad signature
     getTransaction(creds: EdiProviderCredentials, externalId: string): Promise<{ documentType: EdiDocumentType; payload: EdiOrderPayload }>;
     sendTransaction(creds: EdiProviderCredentials, args: { partnerExternalId: string; documentType: EdiDocumentType; payload: EdiOutboundPayload }): Promise<{ externalId: string }>;
   }
   export const ediProviderIds = ["orderful"] as const;
   export function getEdiProvider(id: (typeof ediProviderIds)[number]): EdiProvider  // registry populated in Task 4; until then throw `Unknown EDI provider: ${id}` for unregistered ids
   ```
3. `validate.ts` — pure functions (no DB access; callers pass pre-fetched rows):
   - `resolveOrderLines(payload: EdiOrderPayload, args: { partMappings: Array<{ customerPartId: string; customerPartRevision: string; itemId: string }>; itemsByReadableId: Record<string, string> }): { lines: Array<{ line: EdiOrderPayload["lines"][number]; itemId: string | null }>; issues: EdiIssue[] }` — ladder: exact `(customerPartId, customerPartRevision ?? '')` mapping match → `itemsByReadableId[partnerPartId]` → `unknown-part` issue naming the part.
   - `checkPrices(lines: Array<{ itemId: string; unitPrice: number; expectedPrice: number | null }>, tolerancePercent: number): EdiIssue[]` — `price-mismatch` when `expectedPrice != null && Math.abs(unitPrice - expectedPrice) > expectedPrice * tolerancePercent`.
   - `checkShipTo(code: string, locationMappings: Array<{ externalCode: string; customerLocationId: string }>): { customerLocationId: string | null; issues: EdiIssue[] }`.
   - `checkDuplicateReference(partnerReference: string, existingReferences: string[]): EdiIssue[]`.
4. `build.ts` — pure builders taking plain row objects (caller fetches):
   - `buildAckPayload({ salesOrder }): EdiAckPayload` (throws never; missing `customerReference` → return `{ payload: null, issues: [missing-reference] }` — use a `BuildResult<T> = { payload: T | null; issues: EdiIssue[] }` return shape for all three).
   - `buildShipNoticePayload({ shipment, shipmentLines, partNumbersByItemId, shipVia }): BuildResult<EdiShipNoticePayload>` — issues for missing `customerReference` (from the source sales order) or unmapped items.
   - `buildInvoicePayload({ salesInvoice, salesInvoiceLines, partNumbersByItemId }): BuildResult<EdiInvoicePayload>`.
5. Tests: cover the part-resolution ladder (mapping hit, readableId fallback, miss), price tolerance boundary (exactly at tolerance = pass; above = issue; tolerance 0 = any deviation fails), ship-to miss, duplicate reference, and each builder's happy path + missing-reference issue.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: all tests pass, including the new edi validate/build tests
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** No DB access, no fetch calls, no Orderful specifics (Task 4), no X12 parsing anywhere.

---

## Task 4: Orderful adapter + integration registration

**Depends on:** Task 3
**Files:**
- Create: `packages/ee/src/edi/orderful/config.tsx` — `defineIntegration`
- Create: `packages/ee/src/edi/orderful/lib/client.ts` — HTTP client implementing `EdiProvider`
- Create: `packages/ee/src/edi/orderful/lib/mapper.ts` — Orderful JSON ↔ canonical payloads
- Modify: `packages/ee/src/index.ts` — import `Orderful` config, append to the `integrations` array (currently `[Email, ExchangeRates, Jira, Linear, Onshape, PaperlessParts, QuickBooks, Sage, Slack, Xero, Zapier]`)
- Modify: `packages/ee/src/edi/lib/index.server.ts` — export the registered provider
- Copy from (precedent): `packages/ee/src/linear/config.tsx` (defineIntegration shape, SetupInstructions with webhook URL, inline SVG logo)

**Steps:**
1. `config.tsx`: `defineIntegration({ name: "Orderful", id: "orderful", active: true, category: "EDI", logo, description, shortDescription, setupInstructions: SetupInstructions, images: [], settings: [ {name:"apiKey", label:"API Key", type:"password", required:true, value:""}, {name:"webhookSecret", label:"Webhook Secret", type:"password", required:true, value:""}, {name:"environment", label:"Environment", type:"options", options:["sandbox","production"], required:false, value:"sandbox"} ], schema: z.object({ apiKey: z.string().min(1), webhookSecret: z.string().min(1), environment: z.enum(["sandbox","production"]).optional() }) })`. `SetupInstructions({ companyId })` renders the webhook URL `${origin}/api/webhook/edi/${companyId}` (Linear precedent builds this inline). If the `settings` field types used here don't exist in `packages/ee/src/types.ts` (`text|number|password|switch|processes|options|cards|array`), STOP and report rather than inventing a type.
2. `lib/client.ts`: implement `EdiProvider` against Orderful's public REST API (base URL per environment; `Authorization` header from `creds.apiKey`). `parseWebhook` verifies an HMAC-SHA256 signature of the raw body with `secret` using `crypto.timingSafeEqual` (Xero webhook precedent: `apps/erp/app/routes/api+/webhook.xero.ts`), then maps the body via `mapper.ts`; when the webhook body embeds the full transaction, return it as `payload` so callers can skip the API re-fetch. **Escape hatch:** if Orderful's actual webhook/API shapes cannot be confirmed from public docs during implementation, implement the client against the canonical shapes with the mapper as the single TODO seam, make `getTransaction`/`sendTransaction` throw `"orderful adapter not verified against sandbox"`, and report — do not fabricate response shapes silently.
3. `lib/mapper.ts`: `toCanonicalOrder(orderfulTransaction): { documentType, payload: EdiOrderPayload }` and `fromCanonical(documentType, payload): OrderfulTransactionBody` — keep every Orderful-specific key in this one file.
4. Register in `packages/ee/src/index.ts` and export `orderfulProvider` from `edi/lib/index.server.ts`; wire `getEdiProvider("orderful")` to return it.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
pnpm --filter @carbon/ee test
# Expected: pass (mapper unit test: sample Orderful-shaped fixture → canonical → back, lossless for mapped fields)
```

**Out of scope:** Live API calls in tests; sandbox end-to-end (⚠️ gated on Brad opening the Orderful account); no changes to other integrations.

---

## Task 5: Event-system plumbing

**Depends on:** none
**Files:**
- Modify: `packages/database/src/event.ts` — add `"EDI"` to `HandlerTypeSchema`
- Modify: `packages/lib/src/events.ts` — add two `Events` entries
- Modify: `packages/lib/src/trigger.ts` — add `"edi-send-document": "carbon/edi.send-document"` to `taskToEvent` (~line 9–42)
- Copy from (precedent): the `"carbon/event-webhook"` entry (events.ts ~:347) and `"sync-issue-from-linear"` task mapping (trigger.ts ~:38)

**Steps:**
1. `events.ts` additions:
   ```ts
   "carbon/event-edi": {
     data: { records: Array<{ event: { table: string; recordId: string; operation: "INSERT" | "UPDATE" | "DELETE"; [key: string]: unknown }; companyId: string }> };
   };
   "carbon/edi.send-document": {
     data: { companyId: string; table: "salesOrder" | "shipment" | "salesInvoice"; recordId: string; documentType: string };
   };
   ```
2. `event.ts`: widen `HandlerTypeSchema` z.enum with `"EDI"` (DB CHECK already widened in Task 1).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/lib --filter=@carbon/database
# Expected: exit 0
```

**Out of scope:** No handler code (Task 9), no queue changes (Task 9).

---

## Task 6: Sales module models

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — append EDI validators
- Copy from (precedent): existing validators in the same file (zfd usage), `apps/erp/app/modules/items/items.models.ts:384` (`customerPartValidator`)

**Steps:**
1. Add and export:
   - `ediReleaseModeType = ["Automatic", "Review"] as const`, `ediDocumentTypeType = ["Purchase Order", "Purchase Order Acknowledgment", "Advance Ship Notice", "Invoice"] as const`, `ediDocumentStatusType = ["Received", "Needs Review", "Posted", "Rejected", "Pending", "Sent", "Acknowledged", "Failed"] as const`, `ediDocumentDirectionType = ["Inbound", "Outbound"] as const`.
   - `ediTradingPartnerValidator = z.object({ id: zfd.text(z.string().optional()), customerId: z.string().min(1, { message: "Customer is required" }), externalId: zfd.text(z.string().optional()), active: zfd.checkbox(), releaseMode: z.enum(ediReleaseModeType), priceTolerancePercent: zfd.numeric(z.number().min(0).max(1)), documents: z.array(z.string()).optional() })` — `documents` carries enabled documentType keys as `"<documentType>:<direction>"` strings from checkbox group.
   - `ediTradingPartnerLocationValidator = z.object({ id: zfd.text(z.string().optional()), externalCode: z.string().min(1, { message: "Location code is required" }), customerLocationId: z.string().min(1, { message: "Customer location is required" }) })`.
2. Derive types with `z.infer` and export.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0 (models compile; nothing consumes them yet)
```

**Out of scope:** No service or UI code.

---

## Task 7: Sales module service functions

**Depends on:** Tasks 2, 3, 5, 6
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — append EDI functions (single service file per module)
- Modify: `apps/erp/app/modules/sales/types.ts` — `EdiDocument`, `EdiTradingPartner` types via `Awaited<ReturnType<...>>["data"]`
- Copy from (precedent): `insertSalesOrder` (`sales.service.ts:4989`), `insertSalesOrderLines` (`:1954`), `resolvePrice` (`:2018`), `upsertItemCustomerPart` (`apps/erp/app/modules/items/items.service.ts:3779`), `createEventSystemSubscription` usage (`.claude/rules/workflow-event-system.md` Workflow B)

**Steps:**
1. Reads: `getEdiTradingPartner(client, customerId, companyId)` (partner + its `ediTradingPartnerDocument` + `ediTradingPartnerLocation` rows — embed by target-table name, NOT `alias:fkColumn(...)`, because the FKs are composite); `getEdiTradingPartners(client, companyId, args: GenericQueryFilters & { search?: string })`; `getEdiDocuments(client, companyId, args: GenericQueryFilters & { search?: string; status?: string; type?: string })`; `getEdiDocument(client, id, companyId)`.
2. Writes: `upsertEdiTradingPartner`, `upsertEdiTradingPartnerDocuments(client, tradingPartnerId, companyId, documents: Array<{documentType; direction; enabled}>, userId)` (delete-and-reinsert within the partner is fine — config rows, no history), `upsertEdiTradingPartnerLocation`, `deleteEdiTradingPartnerLocation`.
3. `ensureEdiEventSubscriptions(serviceRole, companyId)` — idempotently create three subscriptions via `createEventSystemSubscription` from `@carbon/database/event` (param key is `type`, NOT `handlerType`):
   - `{ name: "edi-sales-order", table: "salesOrder", operations: ["UPDATE"], type: "EDI", filter: {} }`
   - `{ name: "edi-shipment", table: "shipment", operations: ["UPDATE"], type: "EDI", filter: { status: "Posted" } }`
   - `{ name: "edi-sales-invoice", table: "salesInvoice", operations: ["UPDATE"], type: "EDI", filter: { status: "Submitted" } }`
   Tolerate unique-violation errors (subscription already exists → success). Called from the Task 11 route action when a partner is saved with `active: true`.
4. `processInboundEdiTransaction(serviceRole, { companyId, parsed: ParsedEdiWebhook, creds })`:
   - `kind === "acknowledgment"` → `applyEdiAcknowledgment` (step 7).
   - `kind === "transaction"` → payload from webhook or `provider.getTransaction(creds, externalId)`; insert `ediDocument` (`direction: "Inbound"`, `documentType`, `status: "Received"`, `externalId`, `partnerReference`, `payload`, `createdBy: "system"`); on unique violation of `ediDocument_externalId_unique` return `{ data: { duplicate: true }, error: null }` — no second document, no SO.
   - Then run resolution (step 5) and, when `issues.length === 0 && partner.releaseMode === "Automatic"`, release (step 6); else set `status: "Needs Review"` with the computed `issues`.
5. `resolveEdiOrderDocument(serviceRole, doc)` (internal helper): fetch partner by `doc.tradingPartnerId` ?? lookup via `externalId` of the provider partnership; fetch `ediTradingPartnerLocation` rows, `customerPartToItem` rows for the customer, items by `readableId` for fallback, prior inbound `ediDocument.partnerReference`s for the partner; call the pure `@carbon/ee/edi.server` helpers (`resolveOrderLines`, `checkShipTo`, `checkDuplicateReference`); for each resolved line call `resolvePrice(client, companyId, { customerId, itemId, quantity })` and feed `checkPrices(..., partner.priceTolerancePercent)`. Persist `issues` + `tradingPartnerId` on the document. Returns `{ issues, resolvedLines, customerLocationId }`.
6. `releaseEdiDocument(serviceRole, { id, companyId, userId })` — re-run step 5 against the stored payload; if issues remain, update `issues` and stay `Needs Review`, returning them; if clean: `insertSalesOrder` (`customerId`, `customerLocationId`, `customerReference: partnerReference`, `orderDate`, `createdBy: userId`) + `insertSalesOrderLines` (document `unitPrice`, `saleQuantity`, `unitOfMeasureCode` from the resolved lines, `salesOrderLineType: "Part"` — if the resolved item's type is not Part-compatible, record an `unknown-part` issue instead of guessing), then update the document `{ status: "Posted", sourceDocument: "Sales Order", sourceDocumentId, sourceDocumentReadableId, releasedBy: userId, releasedAt }`. All-or-nothing: if line insert fails, delete the created SO header and return the error.
7. `rejectEdiDocument(client, { id, companyId, userId })` — guard current status is `Needs Review` or `Received`; set `Rejected`. `applyEdiAcknowledgment(serviceRole, { companyId, externalId, accepted, reasons })` — find outbound doc by `(companyId, externalId)`; accepted → `{ status: "Acknowledged", acknowledgedAt: now }`; rejected → `{ status: "Failed", issues: reasons.map(r => ({ code: "provider-rejected", message: r })) }`.
8. Every function: `client` first arg, returns `{ data, error }`, never throws; `companyId` scoping on every query.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** No routes/UI; no Inngest code; do not modify `insertSalesOrder` / `insertSalesOrderLines` / `resolvePrice` themselves. If `insertSalesOrder`'s input shape rejects any field listed here, STOP and report — do not fork a variant.

---

## Task 8: Webhook ingress route + path helpers

**Depends on:** Tasks 4, 7
**Files:**
- Create: `apps/erp/app/routes/api+/webhook.edi.$companyId.ts`
- Modify: `apps/erp/app/utils/path.ts` — add `webhookEdi: (companyId: string) => \`${api}/webhook/edi/${companyId}\`` beside `webhookStripe` (~:281), plus `ediDocuments`, `ediDocument(id)`, `customerEdi(customerId)` entries in the `path.to` map (mirror neighbors' shapes)
- Copy from (precedent): `apps/erp/app/routes/api+/webhook.linear.$companyId.ts` (structure), `apps/erp/app/routes/api+/webhook.xero.ts` (raw-body signature verification)

**Steps:**
1. `loader`: GET returns `{ success: true }` after guarding `companyId` (Linear precedent — provider URL validation pings).
2. `action`:
   - Guard `companyId`; `serviceRole = getCarbonServiceRole()`.
   - For each id in `ediProviderIds`: `getIntegration(serviceRole, id, companyId)` (from `~/modules/settings`); take the first active one. None active → 400 `"EDI integration not active"`.
   - Read the RAW body (`await request.text()`) before any JSON parse; `parsed = await provider.parseWebhook({ rawBody, signature: request.headers.get(<provider signature header>), secret: metadata.webhookSecret })`; `null` → 401.
   - `await processInboundEdiTransaction(serviceRole, { companyId, parsed, creds: metadata })`; on `error` → return 500 (provider redelivers); else `{ success: true }`.
   - `export const config = { runtime: "nodejs" }`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
# Runtime check (dev stack running):
curl -s -X POST "http://$(grep '^ERP_URL' .env.local | cut -d= -f2- | sed 's|https\?://||')/api/webhook/edi/nonexistent" -d '{}' -H 'content-type: application/json'
# Expected: JSON error response ("not configured"/"not active"), NOT a 404 route miss
```

**Out of scope:** No queue/Inngest involvement on the inbound path (plan refinement #1).

---

## Task 9: EDI event handler + queue dispatch

**Depends on:** Tasks 2, 3, 5
**Files:**
- Create: `packages/jobs/src/inngest/functions/events/edi.ts`
- Modify: `packages/jobs/src/inngest/functions/events/queue.ts` — add `EDI: []` to the `grouped` initializer (~:80–87) and a batched dispatch branch inside the drain loop
- Modify: `packages/jobs/src/inngest/functions/events/index.ts` — export the handler
- Modify: `packages/jobs/src/inngest/index.ts` — add to the `functions` array (~:70)
- Copy from (precedent): `packages/jobs/src/inngest/functions/events/search.ts` (batched handler — NO `idempotency` on batched handlers), queue dispatch branch per `.claude/rules/workflow-event-system.md` Workflow C step 5 (step ids MUST include the `pass` suffix)

**Steps:**
1. `edi.ts`: `ediEventFunction = inngest.createFunction({ id: "event-handler-edi", retries: 3 }, { event: "carbon/event-edi" }, ...)`. For each record:
   - Fetch the row by table via service-role client: `salesOrder` → `{ customerId, status, companyId }`; `shipment` → `{ customerId, status, sourceDocument, sourceDocumentId }` (require `status === "Posted" && sourceDocument === "Sales Order"`); `salesInvoice` → `{ customerId, status }` (require `status === "Submitted"`).
   - For `salesOrder`: skip when `status` is `"Draft" | "Needs Approval" | "Cancelled"` (plan refinement #2).
   - Look up active `ediTradingPartner` for the customer with the target document enabled in `ediTradingPartnerDocument` (`salesOrder` → `Purchase Order Acknowledgment`, `shipment` → `Advance Ship Notice`, `salesInvoice` → `Invoice`, all direction `Outbound`). No match → skip.
   - Dedup: existing `ediDocument` with `sourceDocumentId = recordId` and that `documentType` in status other than `Failed` → skip.
   - Else `step.sendEvent` a `carbon/edi.send-document` event (step id must embed record index).
2. `queue.ts`: batched branch identical in shape to the SEARCH branch, event name `carbon/event-edi`, `chunk(records, CHUNK_SIZE)`, step id `dispatch-edi-${pass}-${i}`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exit 0
grep -n 'EDI' packages/jobs/src/inngest/functions/events/queue.ts
# Expected: hits in both the grouped initializer and a dispatch branch
grep -n 'ediEventFunction' packages/jobs/src/inngest/index.ts
# Expected: one hit inside the functions array
```

**Out of scope:** The send job itself (Task 10). Do not add `debounce` (broken on the local Inngest dev server per lessons).

---

## Task 10: Outbound send job + ack-reconcile cron

**Depends on:** Tasks 2, 3, 4, 5
**Files:**
- Create: `packages/jobs/src/inngest/functions/integrations/edi.ts`
- Modify: `packages/jobs/src/inngest/functions/integrations/index.ts` — export both functions
- Modify: `packages/jobs/src/inngest/index.ts` — add both to the `functions` array
- Copy from (precedent): `packages/jobs/src/inngest/functions/integrations/linear.ts` (integration fn shape), `packages/jobs/src/inngest/functions/scheduled/update-exchange-rates.ts` (cron shape)

**Steps:**
1. `ediSendDocumentFunction = inngest.createFunction({ id: "edi-send-document", retries: 3 }, { event: "carbon/edi.send-document" }, ...)`:
   - Service-role client; re-verify partner + enablement + dedup (same checks as Task 9 — the event may be stale).
   - Fetch rows: salesOrder (+ nothing more) for 855; shipment + `shipmentLine` + `shippingMethod.name` + the source sales order (`customerReference`) for 856; salesInvoice + `salesInvoiceLine` for 810. Reverse part numbers: `customerPartToItem` rows for `(customerId, itemId in lines)`.
   - Call the matching `@carbon/ee/edi.server` builder. `payload === null` → insert `ediDocument` as `Failed` with the builder's issues and stop (never send an unmatchable document).
   - Insert `ediDocument` (`Outbound`, `Pending`, `payload`, `sourceDocument`/`sourceDocumentId`/`sourceDocumentReadableId`, `tradingPartnerId`, `partnerReference`, `createdBy: "system"`) in `step.run("stage", ...)`; then in `step.run("send", ...)` call `provider.sendTransaction(creds, ...)` → update `{ status: "Sent", externalId }`. Provider 4xx → update `{ status: "Failed", issues: [{ code: "provider-rejected", message }] }` and return (no retry); network/5xx → throw (Inngest retries; document stays `Pending`).
2. `ediReconcileAcksFunction = inngest.createFunction({ id: "edi-reconcile-acks", retries: 1 }, { cron: "17 * * * *" }, ...)`: one service-role query for `ediDocument` rows with `status = 'Sent'`, `acknowledgedAt IS NULL`, `createdAt < now() - interval '24 hours'`, and no `unacknowledged` issue yet; append `{ code: "unacknowledged", message: "No functional acknowledgment received within 24 hours" }` to `issues` for each.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exit 0
grep -n 'ediSendDocumentFunction\|ediReconcileAcksFunction' packages/jobs/src/inngest/index.ts
# Expected: both present in the functions array
```

**Out of scope:** No inbound logic; no direct ERP-module imports (jobs cannot import `apps/erp`).

---

## Task 11: Customer detail → EDI tab UI

**Depends on:** Tasks 6, 7
**Files:**
- Create: `apps/erp/app/routes/x+/customer+/$customerId.edi.tsx`
- Create: `apps/erp/app/modules/sales/ui/Customer/CustomerEdiForm.tsx` (re-export from `.../ui/Customer/index.ts` if a barrel exists there — check siblings)
- Modify: `apps/erp/app/modules/sales/ui/Customer/CustomerSidebar/useCustomerSidebar.tsx` — add `{ name: "EDI", to: path.to.customerEdi(customerId), icon: <...> }` entry (copy a sibling entry's shape)
- Copy from (precedent): `apps/erp/app/routes/x+/customer+/$customerId.payments.tsx` (loader/action/form shape), `apps/erp/app/routes/x+/customer+/$customerId.contacts.tsx` (nested list pattern for location mappings)

**Steps:**
1. Loader: `requirePermissions({ view: "sales" })` → `getEdiTradingPartner(client, customerId, companyId)` + `getCustomerLocations` (for the mapping select). A missing partner row renders the form with defaults (`releaseMode: "Review"`, `priceTolerancePercent: 0`, `active: false`).
2. Action (`assertIsPost` → `requirePermissions({ update: "sales" })`), two intents (hidden `intent` field):
   - `partner`: `validator(ediTradingPartnerValidator).validate(formData)` → `upsertEdiTradingPartner` + `upsertEdiTradingPartnerDocuments` (parse the `documents` checkbox values `"<documentType>:<direction>"`); when `active === true`, call `ensureEdiEventSubscriptions(getCarbonServiceRole(), companyId)`. Success → `throw redirect(path.to.customerEdi(customerId), await flash(request, success("EDI settings updated")))`.
   - `location`: `validator(ediTradingPartnerLocationValidator).validate(formData)` → `upsertEdiTradingPartnerLocation`. A `deleteLocation` intent calls `deleteEdiTradingPartnerLocation`.
3. `CustomerEdiForm`: `ValidatedForm` with `Boolean` (active), `Select` (releaseMode from `ediReleaseModeType`), `Input` (externalId), `Number` (priceTolerancePercent, `formatOptions` passed as a stable value per lessons), checkbox group for the four document types (855/856/810 outbound, 850 inbound), and a small location-mappings table (externalCode → customerLocation name) with an inline add row. All user-visible strings via `useLingui().t` / `<Trans>`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```
Browser check happens in Task 15.

**Out of scope:** No document queue UI; no changes to other customer tabs.

---

## Task 12: EDI documents queue list UI + sales nav entry

**Depends on:** Tasks 6, 7
**Files:**
- Create: `apps/erp/app/routes/x+/sales+/edi.tsx` — if `apps/erp/app/routes/x+/sales+/` does not exist, STOP, locate the route file behind `path.to.salesOrders` (grep `salesOrders:` in `apps/erp/app/utils/path.ts`, then grep routes for that path), and place the file as its sibling instead — report the substitution.
- Create: `apps/erp/app/modules/sales/ui/Edi/EdiDocumentsTable.tsx`, `apps/erp/app/modules/sales/ui/Edi/EdiDocumentStatus.tsx`
- Modify: `apps/erp/app/modules/sales/ui/useSalesSubmodules.tsx` — add `{ name: t\`EDI\`, to: path.to.ediDocuments, icon: <...>, table: "ediDocument" }` to the `Manage` group
- Copy from (precedent): `apps/erp/app/routes/x+/inventory+/shipments.tsx` (route/loader), `apps/erp/app/modules/inventory/ui/Shipments/ShipmentsTable.tsx` (Table columns, status-badge `meta.filter` with `type: "static"`), `apps/erp/app/modules/inventory/ui/Shipments/ShipmentStatus.tsx`-equivalent for the badge component (grep for it; the ShipmentsTable import shows the path)

**Steps:**
1. Route loader: `requirePermissions({ view: "sales" })` → `getGenericQueryFilters(searchParams)` + `search` → `getEdiDocuments(...)` → `{ documents, count }`; render `<EdiDocumentsTable data count />` + `<Outlet />`; `handle.breadcrumb`.
2. `EdiDocumentStatus`: status → badge color: `Received`/`Pending` gray, `Needs Review` orange, `Posted`/`Acknowledged` green, `Sent` blue, `Rejected`/`Failed` red. Show counts plainly (no parentheses around numbers).
3. `EdiDocumentsTable` columns: document id (Hyperlink → `path.to.ediDocument(id)`), direction, documentType (static filter from `ediDocumentTypeType`), partner (customer name), partnerReference, status (badge + static filter from `ediDocumentStatusType`), issue count, createdAt. Include a filterable "unacknowledged" view: the status filter plus an `issues` indicator column suffices — no bespoke chip if `Table`'s saved-views (`table="ediDocument"`, `withSavedView`) cover it.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** Drawer detail (Task 13); no realtime subscription unless `useRealtime` works untouched for the new table.

---

## Task 13: EDI document detail drawer UI

**Depends on:** Tasks 7, 12
**Files:**
- Create: `apps/erp/app/routes/x+/sales+/edi.$id.tsx` (same directory rule as Task 12)
- Copy from (precedent): `apps/erp/app/routes/x+/settings+/audit-logs.details.tsx` (Drawer-in-child-route via Outlet), `apps/erp/app/routes/x+/customer+/$customerId.contacts.tsx` siblings (form drawers)

**Steps:**
1. Loader: `requirePermissions({ view: "sales" })` → `getEdiDocument`; 404 → `throw redirect` back to the list with a flash error (never let a fetcher 404 hit the route error boundary).
2. Drawer content: header (type, direction, status badge, partner, partnerReference, linked record Hyperlink via `sourceDocumentReadableId`), issues list, payload summary table (lines: buyer part, resolved item, qty, price), collapsible raw JSON `<pre>`.
3. Action intents (`requirePermissions({ update: "sales" })`):
   - `release` → `releaseEdiDocument`; remaining issues → flash error listing them; success → flash success, document now `Posted`.
   - `reject` → `rejectEdiDocument`.
   - `retry` (outbound `Failed` docs) → `trigger("edi-send-document", { companyId, table, recordId: sourceDocumentId, documentType })`.
   - `map-part` → `upsertItemCustomerPart(client, { customerId, customerPartId, customerPartRevision, itemId, companyId, createdBy })` (from `~/modules/items`), then re-run `releaseEdiDocument`-style resolution refresh (call the resolve service to refresh `issues` without releasing).
   - `map-location` → `upsertEdiTradingPartnerLocation`, same refresh.
4. Issue rows with `code: "unknown-part"` render an inline item `Combobox` (grep `~/components/Form` for the item selector used by sales order line forms — copy that component) + Map button posting `map-part`. `unknown-ship-to` rows render a customer-location select + Map button.
5. Release/Reject buttons visible only with `permissions.can("update", "sales")`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** No editing of the stored payload (message-as-truth); no 855-on-reject.

---

## Task 14: Sync `apps/erp/app/modules/sales/AGENTS.md`

**Depends on:** Tasks 1–13
**Files:**
- Modify: `apps/erp/app/modules/sales/AGENTS.md` — add the four `edi*` tables to Key Data Model, the new service functions to Key Service Functions, and one Domain Concepts paragraph (trading partner, document lifecycle, release semantics)

**Steps:**
1. Every claim added must name a real function/table from the merged code — verify each against the source before writing.

**Verify:**
```bash
grep -c 'ediTradingPartner\|ediDocument\|releaseEdiDocument' apps/erp/app/modules/sales/AGENTS.md
# Expected: > 0
```

**Out of scope:** Product docs site (follow-up once the feature is user-visible and verified).

---

## Task 15: Browser verification via /test

**Depends on:** Tasks 1–14
**Files:** none (verification only; playbook lands in `.ai/playbooks/`)

**Steps:**
1. Stack up (`crbn up`, portless), log in via `/auth`.
2. Settings → Integrations: activate Orderful with dummy creds (`apiKey: test`, `webhookSecret: testsecret`, environment sandbox). Expect the card to appear and activate (schema-valid metadata).
3. Customer → EDI tab: enable a partner for an existing seeded customer, `releaseMode: Review`, enable all four documents, add a location mapping for a seeded customer location (code `DC-001`).
4. Simulate inbound 850: POST to `/api/webhook/edi/<companyId>` a canonical-transaction webhook body **with inline payload** (two lines referencing seeded items: one via a `customerPartToItem` mapping created through the part's Sales → Customer Parts UI, one via exact `readableId`), signed with HMAC-SHA256(`testsecret`, rawBody) in the provider's signature header. Expect 200.
5. EDI queue: document in `Needs Review` with zero issues → open drawer → Release → sales order created (verify customer, two lines, document prices, `customerReference` = the PO number); document `Posted` with SO link.
6. Repeat with an unknown buyer part → issue names it → inline map to an item → Release succeeds → verify a second identical webhook (new externalId) auto-resolves that part.
7. Redeliver the exact same webhook body (same externalId) → still exactly one document/SO.
8. Flip partner to `Automatic`, send a clean 850 with a new externalId → SO exists with no human action.
9. Send an 850 whose price deviates with tolerance 0 → price issue present; document holds in `Needs Review` despite `Automatic`.
10. Outbound: post a shipment for the EDI customer's SO (via the shipments UI) → EDI queue shows an `Advance Ship Notice` document. With dummy creds the provider POST fails → expect `Pending` → `Failed` with a provider error issue after Inngest retries exhaust (watch the local Inngest dev UI); the Retry button re-triggers. **Sandbox `Sent`/`Acknowledged` verification is gated on the Orderful account — record this as a known gap in the run report, do not fake it.**
11. Ack path: POST an acknowledgment-kind webhook for a manually-seeded `Sent` document (SQL: insert an outbound `ediDocument` with `status: 'Sent'`, an `externalId`) → accepted → `Acknowledged` with `acknowledgedAt`; rejected variant → `Failed` with reasons in the drawer.
12. Zero-impact check: for a customer with no EDI partner, confirm a shipment post produces no EDI document and the Inngest dev UI shows the EDI handler skipping (or not firing).

**Verify:** the /test run report with screenshots for steps 5, 6, 10, 11; all listed expectations met except the explicitly gated sandbox `Sent` path.

**Out of scope:** Load testing; RLS negative tests beyond the permissions UI check (covered by policy review in code).
