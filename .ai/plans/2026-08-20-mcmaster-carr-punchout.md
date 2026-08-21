# McMaster-Carr Punchout Integration — implementation plan

**Spec:** .ai/specs/2026-08-19-mcmaster-carr-punchout.md
**Research:** .ai/research/mcmaster-punchout.md
**Branch:** cxml-punchout-integration

Sample cXML fixtures come from the seven attachments in the originating
conversation, currently at `.context/attachments/*/Sample cXML *.txt` — Task 3
copies them into the repo. The POSR sample is wrapped in a
`System.ApplicationException:` line that must be stripped.

Global notes for every task:
- Never run a whole-repo typecheck. Scoped filters only.
- No JS `Date` for parsing/formatting cXML timestamps — `@internationalized/date`
  (`parseAbsolute`, `now`) + `@carbon/utils` helpers.
- New UI strings use Lingui (`t`/`Trans` per surrounding code); missing .po strings
  are filled by /translate at commit time — do not hand-edit .po files.
- All service functions: `client` first param, return `{ data, error }`, never
  throw; live in the module's existing `{module}.service.ts` / `{module}.models.ts`.

## Progress
- [x] Task 1: Migration — punchout tables, integration seed, PO line column
- [x] Task 2: Regenerate DB types
- [x] Task 3: cXML core in @carbon/ee (types, parse, build, fixtures, tests)
- [x] Task 4: Cart line resolver (pure) + tests in @carbon/ee
- [x] Task 5: mcmaster-carr integration definition + secrets + settings field types
- [x] Task 6: Punchout models + services in the purchasing module
- [x] Task 7: Punchout session routes (start / return / status / consume) + paths
- [x] Task 8: Outbound PO send (event, Inngest job, finalize option)
- [x] Task 9: Inbound webhook route + document application services
- [x] Task 10: cXML document queue UI (list + drawer + release/reject/resend)
- [x] Task 11: Punchout entry-point UI (orders list button, waiting modal, PO append)
- [x] Task 12: Dev-only mock supplier endpoint
- [x] Task 13: Docs sync (curated docs site page)
- [x] Task 14: Browser verification via /test

## Dependencies
- Task 2 needs Task 1. Tasks 3, 4 are independent of 1–2 and of each other.
- Task 5 independent of 1–4 (touches only packages/ee + settings UI).
- Task 6 needs Task 2 (types). Task 7 needs 3, 5, 6 (+4 for consume). Task 8 needs
  2, 3, 6. Task 9 needs 3, 6. Task 10 needs 6, 9. Task 11 needs 7.
- Task 12 needs 3 only. Tasks 13 waits for 5–11 (documents real behavior).
  Task 14 last.
- Parallelizable groups: {3, 4, 5} after Task 2 starts; {7, 8, 9} after 6.

---

## Task 1: Migration — punchout tables, integration seed, PO line column

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{timestamp}_mcmaster-punchout.sql` (via `pnpm db:migrate:new mcmaster-punchout`)
- Copy from (precedent): `packages/database/supabase/migrations/20260810100100_workflows-foundation.sql` (table + RLS shape), `20260529120000_purchase-order-line-supplier-part.sql` (purchaseOrderLines view handling)

**Steps:**
1. `pnpm db:migrate:new mcmaster-punchout` — never hand-pick the timestamp. The
   generated timestamp must be newer than `20260818014100` (newest on main); if the
   generator produces `000000` HHMMSS, rename with a randomized time.
2. Migration content — all DDL idempotent:

```sql
-- 1. Integration registry seed
INSERT INTO "integration" ("id", "jsonschema")
VALUES ('mcmaster-carr', '{}'::json)
ON CONFLICT ("id") DO NOTHING;

-- 2. Enums
DO $$ BEGIN
  CREATE TYPE "punchoutSessionStatus" AS ENUM ('Pending', 'Returned', 'Consumed', 'Cancelled', 'Expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "cxmlDocumentType" AS ENUM ('Purchase Order', 'Order Confirmation', 'Ship Notice', 'Invoice', 'Credit Memo');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "cxmlDocumentDirection" AS ENUM ('Inbound', 'Outbound');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "cxmlDocumentStatus" AS ENUM ('Received', 'Needs Review', 'Posted', 'Rejected', 'Pending', 'Sent', 'Failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. punchoutSession
CREATE TABLE IF NOT EXISTS "punchoutSession" (
    "id" TEXT NOT NULL DEFAULT id('pnch'),
    "companyId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "buyerCookie" TEXT NOT NULL,
    "status" "punchoutSessionStatus" NOT NULL DEFAULT 'Pending',
    "purchaseOrderId" TEXT,
    "cart" JSONB,
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "punchoutSession_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "punchoutSession_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "punchoutSession_supplierId_fkey" FOREIGN KEY ("supplierId", "companyId")
      REFERENCES "supplier"("id", "companyId"),
    CONSTRAINT "punchoutSession_integrationId_fkey" FOREIGN KEY ("integrationId")
      REFERENCES "integration"("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "punchoutSession_buyerCookie_idx" ON "punchoutSession" ("buyerCookie");
CREATE INDEX IF NOT EXISTS "punchoutSession_companyId_idx" ON "punchoutSession" ("companyId");

ALTER TABLE "punchoutSession" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "punchoutSession";
CREATE POLICY "SELECT" ON "punchoutSession" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_view'))::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "punchoutSession";
CREATE POLICY "INSERT" ON "punchoutSession" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "punchoutSession";
CREATE POLICY "UPDATE" ON "punchoutSession" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
);
-- No DELETE policy: sessions expire, never user-deleted.

-- 4. cxmlDocument
CREATE TABLE IF NOT EXISTS "cxmlDocument" (
    "id" TEXT NOT NULL DEFAULT id('cxml'),
    "companyId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "direction" "cxmlDocumentDirection" NOT NULL,
    "documentType" "cxmlDocumentType" NOT NULL,
    "status" "cxmlDocumentStatus" NOT NULL,
    "payloadId" TEXT NOT NULL,
    "externalId" TEXT,
    "payload" JSONB NOT NULL,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "purchaseOrderId" TEXT,
    "sourceDocument" TEXT,
    "sourceDocumentId" TEXT,
    "sourceDocumentReadableId" TEXT,
    "releasedBy" TEXT REFERENCES "user"("id"),
    "releasedAt" TIMESTAMP WITH TIME ZONE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "cxmlDocument_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "cxmlDocument_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "cxmlDocument_supplierId_fkey" FOREIGN KEY ("supplierId", "companyId")
      REFERENCES "supplier"("id", "companyId"),
    CONSTRAINT "cxmlDocument_integrationId_fkey" FOREIGN KEY ("integrationId")
      REFERENCES "integration"("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "cxmlDocument_dedup_idx"
  ON "cxmlDocument" ("companyId", "integrationId", "direction", "documentType", "payloadId");
CREATE INDEX IF NOT EXISTS "cxmlDocument_companyId_status_idx" ON "cxmlDocument" ("companyId", "status");

ALTER TABLE "cxmlDocument" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "cxmlDocument";
CREATE POLICY "SELECT" ON "cxmlDocument" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_view'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "cxmlDocument";
CREATE POLICY "UPDATE" ON "cxmlDocument" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
);
-- No INSERT/DELETE policies: rows are written by service-role (webhook/job) only.

-- 5. Opaque punchout cookie on PO lines
ALTER TABLE "purchaseOrderLine" ADD COLUMN IF NOT EXISTS "supplierPartAuxiliaryId" TEXT;
```

3. The `purchaseOrderLines` view must be dropped and recreated so `pl.*` picks up
   the new column. Find the NEWEST definition first (lessons.md: never fork a stale
   one):
   `grep -l 'CREATE OR REPLACE VIEW "purchaseOrderLines"' packages/database/supabase/migrations/*.sql | sort | tail -1`
   Copy that definition verbatim into this migration after
   `DROP VIEW IF EXISTS "purchaseOrderLines";` — change nothing else about it.
4. Apply locally: `pnpm db:migrate`. If it fails, fix the migration file — never
   leave partial state unguarded.

**Verify:**
```bash
pnpm db:migrate
# Expected: applies cleanly. Then:
psql $DATABASE_URL -c '\d "punchoutSession"' -c '\d "cxmlDocument"' -c '\d "purchaseOrderLine"' | grep -E "punchoutSession|cxmlDocument|supplierPartAuxiliaryId"
# Expected: both tables exist; purchaseOrderLine has supplierPartAuxiliaryId
```

**Out of scope:** No new permission family, no `module` enum change, no changes to
`supplierPart`, no event-system trigger attachment.

## Task 2: Regenerate DB types

**Depends on:** Task 1
**Files:**
- Modify: `packages/database/src/types.ts` (generated — never hand-edit)

**Steps:**
1. `pnpm run generate:types`
2. Commit the regenerated file together with the migration (types regen is normal
   and expected).

**Verify:**
```bash
grep -c "punchoutSession\|cxmlDocument\|supplierPartAuxiliaryId" packages/database/src/types.ts
# Expected: > 0 for all three (grep prints a non-zero count)
```

**Out of scope:** Any manual edits to generated types.

## Task 3: cXML core in @carbon/ee (types, parse, build, fixtures, tests)

**Depends on:** none (pure TypeScript, no DB types)
**Files:**
- Create: `packages/ee/src/punchout/types.ts`
- Create: `packages/ee/src/punchout/cxml/parse.ts`
- Create: `packages/ee/src/punchout/cxml/build.ts`
- Create: `packages/ee/src/punchout/cxml/__fixtures__/` — seven files: `posr.xml`, `poom.xml`, `order-request.xml`, `order-confirmation.xml`, `ship-notice.xml`, `invoice.xml`, `credit-memo.xml`
- Create: `packages/ee/src/punchout/cxml/parse.test.ts`, `build.test.ts`
- Modify: `packages/ee/package.json` — add `"fast-xml-parser": "^5.7.2"` to dependencies (approved by Brad; already in lockfile transitively)
- Copy from (precedent): none exists for cXML; follow `packages/ee/src/` file conventions (plain TS modules, vitest colocated tests as in existing `*.test.ts` files under packages/ee if present — otherwise vitest default)

**Steps:**
1. Copy the seven sample documents from `.context/attachments/*/Sample cXML *.txt`
   into `__fixtures__/` with the names above. Strip the leading
   `System.ApplicationException: ` prefix from the POSR sample so each fixture is
   valid XML. If the attachment files are missing, STOP and report — do not invent
   fixtures.
2. `types.ts` — canonical types owned by Carbon (no fast-xml-parser types leak):
   ```ts
   export type CxmlIdentity = { domain: string; identity: string };
   export type CxmlCredentials = {
     from: CxmlIdentity; to: CxmlIdentity; sender: CxmlIdentity;
     sharedSecret: string; deploymentMode: "test" | "production"; userAgent: string;
   };
   export type PunchoutCartLine = {
     supplierPartId: string; supplierPartAuxiliaryId: string | null;
     quantity: number; unitPrice: number; currencyCode: string;
     description: string; unitOfMeasureCode: string;  // raw UN/CEFACT code from cart
     classification: string | null; manufacturerPartId: string | null; manufacturerName: string | null;
   };
   export type PunchoutCart = { buyerCookie: string; total: number | null; currencyCode: string | null; operationAllowed: "create" | "inspect" | "edit" | null; lines: PunchoutCartLine[] };
   export type CxmlConfirmationLine = { lineNumber: number; quantity: number; unitOfMeasureCode: string | null; type: string; shipmentDate: string | null; deliveryDate: string | null };
   export type CxmlConfirmationPayload = { payloadId: string; confirmId: string | null; supplierOrderId: string | null; orderId: string | null; orderPayloadId: string | null; noticeDate: string | null; total: number | null; lines: CxmlConfirmationLine[] };
   export type CxmlShipNoticePayload = { payloadId: string; shipmentId: string; shipmentDate: string | null; deliveryDate: string | null; carrier: string | null; trackingNumber: string | null; orderId: string | null; lines: Array<{ lineNumber: number; quantity: number; unitOfMeasureCode: string | null }> };
   export type CxmlInvoiceLine = { invoiceLineNumber: number; orderLineNumber: number | null; supplierPartId: string | null; description: string | null; quantity: number; unitOfMeasureCode: string | null; unitPrice: number; subtotal: number | null };
   export type CxmlInvoicePayload = { payloadId: string; invoiceId: string; purpose: "standard" | "lineLevelCreditMemo"; invoiceDate: string | null; orderId: string | null; paymentTermDays: number | null; lines: CxmlInvoiceLine[]; subtotal: number | null; tax: number | null; shipping: number | null; specialHandling: number | null; gross: number | null; net: number | null; due: number | null; currencyCode: string | null };
   export type CxmlParseResult<T> = { data: T | null; error: string | null };
   ```
3. `parse.ts` — use `XMLParser` from `fast-xml-parser` with
   `{ ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: true }`.
   Export:
   - `parseCxmlEnvelope(xml: string)` → `{ payloadId, timestamp, senderIdentity, senderSharedSecret, body }` (body = the `Request`/`Message` object). Used by the webhook route for auth before dispatch.
   - `parsePunchOutSetupResponse(xml)` → `CxmlParseResult<{ statusCode: number; startPageUrl: string | null }>`
   - `parsePunchOutOrderMessage(xml)` → `CxmlParseResult<PunchoutCart>` — handle single-vs-array `ItemIn` (fast-xml-parser returns an object when there is one element — always coerce with a local `asArray` helper). Empty/absent `ItemIn` → `lines: []` (cancel signal).
   - `decodePunchoutFormPost(form: URLSearchParams)` → the raw cXML string: check `cxml-base64` first (base64-decode), then `cxml-urlencoded`, both case-insensitively (iterate keys with `.toLowerCase()`).
   - `parseConfirmationRequest(xml)`, `parseShipNoticeRequest(xml)`, `parseInvoiceDetailRequest(xml)` → the payload types above. `parseInvoiceDetailRequest` handles both `standard` and `lineLevelCreditMemo` purposes (credit memo = negative quantities/amounts, passed through as-is).
   - `parseCxmlMoney(value: unknown): number | null` — strips `$`, commas, whitespace before `Number(...)`; used everywhere Money is read (McMaster's own confirmation sample contains `$629.52`).
   - All parsers return `{ data, error }`; never throw on malformed XML.
4. `build.ts` — build documents with template literals (escaping via a local
   `escapeXml` helper for text nodes and attributes; `SupplierPartAuxiliaryID`
   content is inserted **verbatim, unescaped** — it arrives already-escaped from
   the POOM and must round-trip byte-for-byte). Export:
   - `buildPunchOutSetupRequest(input: { credentials: CxmlCredentials; buyerCookie: string; returnUrl: string; userEmail: string | null; userName: string | null; payloadId: string; timestamp: string })` → cXML 1.2.019 doc matching the POSR fixture shape (Header From/To/Sender + SharedSecret, `operation="create"`, `BuyerCookie`, `BrowserFormPost/URL`, `Extrinsic name="UserEmail"` when present).
   - `buildOrderRequest(input: { credentials; payloadId; timestamp; orderId: string; orderDate: string; total: number; currencyCode: string; shipTo: CxmlAddress | null; billTo: CxmlAddress | null; contactEmail: string | null; contactName: string | null; comments: string | null; lines: Array<{ lineNumber: number; quantity: number; supplierPartId: string; supplierPartAuxiliaryId: string | null; unitPrice: number; description: string; unitOfMeasureCode: string }> })` with `CxmlAddress = { name: string; deliverTo: string | null; street: string[]; city: string; state: string | null; postalCode: string | null; countryCode: string }` — shape matches the PO fixture (`OrderRequestHeader type="new"`, `ItemOut` echoing both ItemID children).
   - `buildCxmlResponse(input: { statusCode: number; statusText: string; payloadId: string; timestamp: string })` — the reply the webhook route sends (200 "success" / 401 / 400).
5. Tests (`vitest`): for every fixture, parse → assert key fields (POOM: 3 lines,
   part `3201T16`, aux id `8310486455458`, price 0.9, UOM `PR` on line 3;
   confirmation: `$629.52` parses to 629.52, 4 lines, delivery dates; ASN: tracking
   `1Z602878787878787878`, carrier UPS, UOM `PK`; invoice: gross 269.92, term 30;
   credit memo: quantity -2, due -269.92). Build tests: `buildOrderRequest` output
   re-parsed with XMLParser must contain the aux id byte-for-byte; a
   `buildPunchOutSetupRequest` → parse round-trip preserves BuyerCookie and URL.
6. Export the module from a new barrel `packages/ee/src/punchout/index.ts`
   (types + parse + build; everything here is isomorphic-safe — no Node APIs), and
   re-export as `Punchout` types from `packages/ee/src/index.ts` only if needed by
   the ERP app imports in later tasks (prefer a subpath export
   `"./punchout"` in `packages/ee/package.json` mirroring how existing exports are
   declared there — check that file's `exports` map and follow it; if it has no
   `exports` map, plain deep imports `@carbon/ee/src/...` are NOT the pattern —
   re-export from `packages/ee/src/index.ts` instead).

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: new parse/build tests pass (all 7 fixtures covered)
pnpm --filter @carbon/ee typecheck
# Expected: exit 0
```

**Out of scope:** No DB access, no OCI format, no Level 2 index parsing, no
edit/inspect POSR variants.

## Task 4: Cart line resolver (pure) + tests in @carbon/ee

**Depends on:** Task 3
**Files:**
- Create: `packages/ee/src/punchout/resolve.ts`, `packages/ee/src/punchout/resolve.test.ts`

**Steps:**
1. Pure function (no DB) so the whole resolution matrix is unit-testable:
   ```ts
   export type ResolvedCartLine = {
     purchaseOrderLineType: "Part" | "G/L Account";
     itemId: string | null; accountId: string | null;
     description: string; purchaseQuantity: number;
     supplierUnitPrice: number; supplierPartId: string; supplierPartAuxiliaryId: string | null;
     purchaseUnitOfMeasureCode: string; inventoryUnitOfMeasureCode: string | null;
     conversionFactor: number; issues: string[];
   };
   export function resolveCartLines(input: {
     cart: PunchoutCart;
     supplierParts: Array<{ supplierPartId: string; itemId: string; supplierUnitOfMeasureCode: string | null; conversionFactor: number | null; inventoryUnitOfMeasureCode?: string | null }>;
     uomCodes: string[];                    // company's unitOfMeasure codes
     defaultExpenseAccountId: string;
   }): ResolvedCartLine[]
   ```
   Rules (from the spec): match `supplierPartId` case-insensitively against
   `supplierParts` → Part line with the cross-reference's UOM/conversion;
   no match → G/L Account line with `defaultExpenseAccountId` and the cart
   description (`supplierPartId` still carried). Cart UOM code not in `uomCodes`
   → use `"EA"` and push issue `Unmapped unit of measure "<code>" — defaulted to EA`.
   Prices pass through untouched (no rounding — internal scale on persist).
2. Tests: matched line, unmatched line, unmapped UOM, case-insensitive part match,
   empty cart → `[]`.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: resolve tests pass
```

**Out of scope:** No item auto-creation, no supplierPart writes, no price-tolerance
checks.

## Task 5: mcmaster-carr integration definition + secrets + settings field types

**Depends on:** none
**Files:**
- Create: `packages/ee/src/mcmaster-carr/config.tsx`
- Modify: `packages/ee/src/index.ts` — import `McMasterCarr`, add to `integrations` array (approved by Brad)
- Modify: `packages/ee/src/integrations/secrets.ts` — add `"mcmaster-carr": ["sharedSecret", "inboundSharedSecret"]` to `SECRET_KEYS`
- Modify: `packages/ee/src/types.ts` — extend `IntegrationSetting` `type` union with `"supplier" | "account"`
- Modify: `apps/erp/app/modules/settings/ui/Integrations/IntegrationForm.tsx` — render the two new field types
- Copy from (precedent): `packages/ee/src/paperless-parts/config.tsx` (whole file shape, SetupInstructions with webhook URL)

**Steps:**
1. `config.tsx`: `defineIntegration({ name: "McMaster-Carr", id: "mcmaster-carr",
   active: true, category: "Purchasing", logo, shortDescription: "Punchout catalog
   and cXML purchase orders, confirmations, ship notices, and invoices.",
   description, setupInstructions: SetupInstructions, images: [], settings: [...],
   schema })`. Settings array (types per `packages/ee/src/types.ts`):
   - `supplierId` — type `"supplier"`, label "Supplier", required
   - `environment` — type `"options"`, listOptions `["Test", "Production"]`, value `"Test"`, required
   - `punchoutUrl` — `"text"`, label "Punchout URL", required
   - `orderUrlTest` — `"text"`, label "Order URL (Test)", required
   - `orderUrlProduction` — `"text"`, label "Order URL (Production)", required: false
   - `fromIdentity` — `"text"`, label "From/Sender Identity (NetworkID)", required
   - `fromDomain` — `"text"`, value `"NetworkID"`, required
   - `toIdentity` — `"text"`, value `"006931349"`, required
   - `toDomain` — `"text"`, value `"DUNS"`, required
   - `sharedSecret` — `"secret"`, required
   - `inboundSharedSecret` — `"secret"`, required
   - `defaultExpenseAccountId` — type `"account"`, label "Default expense account for unmatched items", required
   Zod schema mirrors the settings (all strings; `environment: z.enum(["Test", "Production"])`).
   `SetupInstructions({ companyId })`: copyable webhook URL
   `${window.location.origin}/api/webhook/mcmaster-carr/${companyId}` and the
   BrowserFormPost origin note; instructions to email eProcurement@mcmaster.com
   with the McMaster account number (~30-day onboarding; separate punchout and
   order-posting URLs; note the payment-model change and the same/next-day
   shipping cancellation caveat). Logo: inline SVG wordmark ("McMaster-Carr" text
   mark is fine — follow how paperless-parts embeds its `Logo` SVG component).
2. `types.ts`: add `"supplier" | "account"` to the `IntegrationSetting["type"]`
   union.
3. `IntegrationForm.tsx`: find the switch/map that renders a field per
   `setting.type` and add two cases: `"supplier"` → the `Supplier` combobox from
   `~/components/Form`, `"account"` → the `Account` combobox from
   `~/components/Form` (grep `apps/erp/app/components/Form/index.ts` for exact
   export names; both exist as form-bound selects used across purchasing/
   accounting forms). If either component does not exist under `~/components/Form`,
   STOP and report — do not build a new combobox.
4. Register in `packages/ee/src/index.ts` (import + array entry, alphabetical-ish
   with siblings).
5. `SECRET_KEYS` entry as above — empty-string submits must keep vaulted values
   (that behavior is already inside `splitSecrets`; no code needed, just do not
   bypass `persistIntegrationSecrets`, which the generic settings route already
   calls).

**Verify:**
```bash
pnpm --filter @carbon/ee typecheck && pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0 for both
```
Manual: `/x/settings/integrations` shows the McMaster-Carr card; its form renders
supplier + account pickers and masked secret fields.

**Out of scope:** No server hooks (`hooks.server.ts`) — no install-time side
effects needed; no `FEATURE_PLANS` gating change; no OAuth.

## Task 6: Punchout models + services in the purchasing module

**Depends on:** Task 2 (DB types); uses Task 3/4 types at compile time
**Files:**
- Modify: `apps/erp/app/modules/purchasing/purchasing.models.ts` — add validators
- Modify: `apps/erp/app/modules/purchasing/purchasing.service.ts` — add service functions
- Modify: `apps/erp/app/modules/purchasing/index.ts` — barrel re-exports
- Copy from (precedent): existing functions in the same files (`insertPurchaseOrder` L1433, `upsertPurchaseOrderLine` L1801, `finalizePurchaseOrder` L1098)

**Steps:**
1. Models: `punchoutStartValidator` (`{ purchaseOrderId: zfd.text(z.string().optional()) }`),
   `cxmlDocumentRejectValidator` (`{ id: z.string() }`). The mcmaster settings
   metadata validator `mcmasterIntegrationMetadataValidator` (mirrors the Task 5
   schema, plus optional resolved secrets) lives here too so routes/jobs parse
   `companyIntegration.metadata` consistently.
2. Services (all `client` first, `{data, error}` returns, `companyId` scoping on
   every query):
   - `createPunchoutSession(client, { companyId, integrationId, supplierId, purchaseOrderId, createdBy })` — generates `buyerCookie` via `crypto.randomUUID()` twice concatenated (unguessable), `expiresAt` = now + 2h (use `@internationalized/date` `now("UTC").add({ hours: 2 })` → ISO string).
   - `getPunchoutSession(client, id, companyId)`; `getPunchoutSessionByCookie(client, buyerCookie)` (service-role caller; single row by unique cookie, returns row including companyId).
   - `updatePunchoutSession(client, { id, companyId, status, cart? })` — guarded transitions: `Pending → Returned|Cancelled|Expired`, `Returned → Consumed`; refuse others (return error, no throw).
   - `consumePunchoutCart(client, { sessionId, companyId, userId, companyGroupId })` — loads session (must be `Returned`, not expired), loads integration metadata (supplierId, defaultExpenseAccountId), loads supplier parts for the supplier (`.from("supplierPart").select("supplierPartId, itemId, supplierUnitOfMeasureCode, conversionFactor").eq("companyId", companyId).eq("supplierId", supplierId).eq("active", true)`) — one query, no N+1 — and UOM codes via `getUnitOfMeasuresList` (items service), calls `resolveCartLines` (Task 4), then: if `session.purchaseOrderId` is null → `insertPurchaseOrder` (copy the call shape from `apps/erp/app/routes/x+/purchase-order+/new.tsx`, status stays Draft) else verify the PO is `Draft` and supplier matches; then `upsertPurchaseOrderLine` per resolved line (sequential loop is acceptable — lines carry per-line sort order; this mirrors `new.tsx` invoice-line creation). On any line failure after creating a fresh PO, delete the PO (EDI-branch release pattern). Marks session `Consumed` with the PO id. Returns `{ purchaseOrderId, issues }`.
   - `insertCxmlDocument(client, { companyId, integrationId, supplierId, direction, documentType, status, payloadId, externalId, payload, purchaseOrderId, createdBy })` — on unique-violation of `cxmlDocument_dedup_idx` return the existing row with `duplicate: true` instead of an error.
   - `getCxmlDocuments(client, companyId, args)` (paginated, filter by status/type — copy the `getWorkflowRuns`-style list shape), `getCxmlDocument(client, id, companyId)`, `rejectCxmlDocument(client, { id, companyId, userId })` (status → `Rejected`), `updateCxmlDocumentStatus(client, { id, companyId, status, externalId?, issues?, sourceDocument?, sourceDocumentId?, sourceDocumentReadableId?, releasedBy? })`.
   - `applyCxmlConfirmation(client, { companyId, payload: CxmlConfirmationPayload })` — find PO by readable id: `.from("purchaseOrder").select("id, purchaseOrderId").eq("companyId", companyId).eq("purchaseOrderId", payload.orderId)`; not found → return `{ error }` so caller stages with issue. Updates: `purchaseOrder.supplierReference` = supplierOrderId ?? confirmId; per line (match by line number order of PO lines sorted by sort order — collect PO lines in ONE query, then one update per changed line) `promisedDate` = line deliveryDate (date part only); `purchaseOrderDelivery.receiptPromisedDate` = earliest deliveryDate.
   - `applyCxmlShipNotice(client, { companyId, payload })` — same PO lookup; sets `purchaseOrderDelivery.trackingNumber` = trackingNumber (last-wins).
   - `releaseCxmlInvoice(client, { id, companyId, userId, companyGroupId })` — loads the staged Invoice/Credit Memo document + its PO and PO lines, creates a draft purchase invoice: `upsertPurchaseInvoice` (invoicing service; get next sequence the same way `x+/purchase-invoice+/new.tsx` does — copy that call chain exactly) then `upsertPurchaseInvoiceLine` per cXML line: match `orderLineNumber` → PO line (gives `invoiceLineType`/`itemId`/`purchaseOrderLineId`); unmatched → `invoiceLineType: "Comment"` with description. Tax: whole-document tax lands on the first line with `taxPercent = Math.min(1, deriveRate(tax, subtotal))` — copy the `new.tsx` extraction pattern verbatim including `taxableBase`/`deriveRate` imports. Credit memo: quantities/amounts arrive negative, pass through. Marks the document `Posted` with `sourceDocument: "Purchase Invoice"`, sourceDocumentId/ReadableId, releasedBy/At.
3. Barrel: re-export new validators + service functions from the module `index.ts`
   following its existing style.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** No auto-posting of invoices (`post-purchase-invoice` untouched),
no receipt creation, no changes to `finalizePurchaseOrder` (Task 8), no new
service/models files.

## Task 7: Punchout session routes (start / return / status / consume) + paths

**Depends on:** Tasks 3, 4, 5, 6
**Files:**
- Create: `apps/erp/app/routes/api+/integrations.punchout.start.ts`
- Create: `apps/erp/app/routes/api+/punchout.$sessionId.return.ts`
- Create: `apps/erp/app/routes/api+/integrations.punchout.$sessionId.status.ts`
- Create: `apps/erp/app/routes/api+/integrations.punchout.$sessionId.consume.ts`
- Modify: `apps/erp/app/utils/path.ts` — add `punchoutStart`, `punchoutStatus(id)`, `punchoutConsume(id)` under the api section; `cxmlDocuments` + `cxmlDocument(id)` under `x` (used in Task 10)
- Copy from (precedent): `apps/erp/app/routes/api+/webhook.paperless-parts.$companyId.ts` (service-role + secrets resolution), `$orderId.finalize.tsx` (requirePermissions + validator + redirect shape)

**Steps:**
1. **start** (action, `requirePermissions({ create: "purchasing" })`): validate
   `punchoutStartValidator`; load the company's `mcmaster-carr` integration via
   `getIntegration` (settings service) — must be active, else 400 with message;
   `resolveIntegrationSecrets` for `sharedSecret`; `createPunchoutSession`;
   build the return URL `${origin}/api/punchout/${session.id}/return` (derive
   origin the way SetupInstructions/share links do — grep for an existing
   server-side origin helper, e.g. how `webhook` URLs or share URLs are built in
   loaders; if none exists server-side, take `new URL(request.url).origin`);
   `buildPunchOutSetupRequest` with credentials from metadata
   (`deploymentMode: environment === "Production" ? "production" : "test"`,
   userAgent `"Carbon"`, user name/email from the session user); POST to
   `punchoutUrl` with `Content-Type: text/xml` and a 15s `AbortSignal.timeout`;
   `parsePunchOutSetupResponse`; non-200 status or missing StartPage → mark
   session `Cancelled`, return `{ error }`; else return
   `{ startPageUrl, sessionId }` as plain object (never `Response.json`).
2. **return** (public action — NO `requirePermissions`; add
   `export const config = { runtime: "nodejs" }` only if the paperless webhook has
   it — it does not, so omit): reads `params.sessionId`, form data via
   `request.formData()`; `getCarbonServiceRole()`;
   `getPunchoutSession` by id (service-role, no companyId from caller — the
   session row carries it); checks: exists, status `Pending`, `expiresAt` in the
   future (compare ISO strings via `Date.parse` is banned — use
   `parseAbsolute(expiresAt, "UTC").compare(now("UTC")) > 0`); decode with
   `decodePunchoutFormPost`, `parsePunchOutOrderMessage`; verify
   `cart.buyerCookie === session.buyerCookie` else 401; empty `lines` → status
   `Cancelled`; else store cart, status `Returned`. Always respond with a tiny
   HTML page (Content-Type text/html):
   `<script>if (window.opener) window.opener.postMessage("punchout:" + STATUS + ":" + SESSION_ID, "*"); window.close();</script><p>You can close this window.</p>`
   where STATUS is `returned`/`cancelled`/`error`. Never set or read cookies in
   this route. Duplicate posts (status already `Returned`/`Consumed`) → same HTML
   with current status, no state change.
3. **status** (loader, `requirePermissions({ view: "purchasing" })`):
   `getPunchoutSession(client, sessionId, companyId)` → `{ status, purchaseOrderId }`.
   Client polls it as fallback when postMessage is missed.
4. **consume** (action, `requirePermissions({ create: "purchasing" })`):
   `consumePunchoutCart`; on success redirect to
   `path.to.purchaseOrder(purchaseOrderId)` with `flash(success(...))`; surface
   resolver issues in the flash message ("2 lines could not be matched — review
   the G/L lines"). On error, flash error and redirect back to
   `path.to.purchaseOrders`.
5. Path helpers: follow the existing `path.to` literal/generatePath style from
   the purchasing entries.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
curl -s -X POST http://localhost:3000/api/punchout/does-not-exist/return -d "cxml-urlencoded=x" | grep -c "close"
# Expected: 1 (HTML response, error status — no stack trace, no redirect to login)
```
(The curl check runs against the local dev stack; if the stack is not running,
defer it to Task 14.)

**Out of scope:** No UI (Task 11), no webhook route (Task 9), no edit/inspect
operations.

## Task 8: Outbound PO send (event, Inngest job, finalize option)

**Depends on:** Tasks 2, 3, 6
**Files:**
- Modify: `packages/lib/src/trigger.ts` — `taskToEvent` entry `"punchout-send-po": "carbon/punchout.send-po"`
- Modify: `packages/lib/src/events.ts` — `Events` entry `"carbon/punchout.send-po": { data: { companyId: string; purchaseOrderId: string; userId: string } }`
- Create: `packages/jobs/src/inngest/functions/integrations/punchout.ts`
- Modify: `packages/jobs/src/inngest/functions/integrations/index.ts` — `export { punchoutSendPoFunction } from "./punchout";`
- Modify: `packages/jobs/src/inngest/index.ts` — import + add to the functions array
- Modify: `apps/erp/app/modules/purchasing/purchasing.models.ts` — `purchaseOrderFinalizeValidator` notification enum: `z.enum(["Email", "cXML", "None"])`; extend the `.refine` so `"cXML"` does not require `supplierContact`
- Modify: `apps/erp/app/routes/x+/purchase-order+/$orderId.finalize.tsx` — add `case "cXML":` to the notification switch: `await trigger("punchout-send-po", { companyId, purchaseOrderId: orderId, userId })`
- Modify: `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderFinalizeModal.tsx` — add the cXML option
- Copy from (precedent): `packages/jobs/src/inngest/functions/integrations/paperless-parts.ts` (createFunction shape + registration)

**Steps:**
1. `punchoutSendPoFunction = inngest.createFunction({ id: "punchout-send-po", retries: 3 }, { event: "carbon/punchout.send-po" }, ...)` with two steps:
   - `step.run("stage")`: service-role client; load PO + lines (`purchaseOrder`,
     `purchaseOrderLine` ordered by sort order, `purchaseOrderDelivery`, supplier,
     company address, PO location address — each a single query, no loops); load
     integration metadata + `resolveIntegrationSecrets` (`sharedSecret`); guard:
     integration active, PO supplier === configured supplierId (else return
     skipped); `insertCxmlDocument` direction `Outbound`, type `Purchase Order`,
     status `Pending`, payloadId = `${purchaseOrderId}@carbon` + timestamp,
     payload = the built request summary (orderId, total, line echo data). If a
     `Sent` outbound PO document already exists for this PO, return skipped
     (duplicate-send guard).
   - `step.run("send")`: `buildOrderRequest` — orderId = readable
     `purchaseOrderId`, total = sum of line extended prices rounded to the
     currency's decimals (use `round` + the currency `decimalPlaces` from the
     company currency — data, not a literal), lines echo `supplierPartId` +
     `supplierPartAuxiliaryId` verbatim, UOM = line `purchaseUnitOfMeasureCode`;
     POST to `environment === "Production" ? orderUrlProduction : orderUrlTest`
     (missing URL → `Failed` with issue); parse the synchronous `Response` status;
     2xx cXML status → `updateCxmlDocumentStatus` `Sent` (+ externalId if the
     response carries an order id); anything else → `Failed` with the status text
     in `issues`. HTTP errors caught → `Failed` (Inngest retries rethrow only on
     network-level failures — follow how paperless-parts distinguishes; if it
     doesn't, catch everything and store `Failed` so retries don't double-send:
     the stage-step duplicate guard makes retries safe).
2. Finalize modal: in `PurchaseOrderFinalizeModal.tsx`, mirror the `canEmail`
   pattern: `const canPunchout = integrations.has("mcmaster-carr")` AND the PO's
   supplier matches the integration metadata supplierId — the modal already
   receives the PO/supplier context; if the supplier id is not available in
   component props, read the integration metadata supplierId via the existing
   loader data pattern for the modal's parent route; if that is not plumbable
   without a new loader, STOP and report the smallest loader change needed.
   Option list: add `{ label: "Send via cXML to McMaster-Carr", value: "cXML" }`
   when `canPunchout`; pre-select it when true. Warning line under the option:
   "McMaster-Carr ships same or next day — cancelling this PO in Carbon does not
   cancel the order."
3. Resend: handled in Task 10's drawer (same `trigger` call).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=erp
# Expected: exit 0
pnpm --filter @carbon/jobs test
# Expected: existing tests still pass
```

**Out of scope:** No change-order/cancel documents, no event-system
(`eventSystemSubscription`) wiring — the finalize route triggers directly.

## Task 9: Inbound webhook route + document application services

**Depends on:** Tasks 3, 6
**Files:**
- Create: `apps/erp/app/routes/api+/webhook.mcmaster-carr.$companyId.ts`
- Copy from (precedent): `apps/erp/app/routes/api+/webhook.paperless-parts.$companyId.ts`

**Steps:**
1. Action only (loader returns `{ success: true }` like the precedent). Flow:
   - `companyId` from params; raw body via `await request.text()`.
   - `getCarbonServiceRole()`; `getIntegration(serviceRole, "mcmaster-carr", companyId)`; inactive/missing → 400.
   - `resolveIntegrationSecrets` → `inboundSharedSecret`.
   - `parseCxmlEnvelope(rawBody)`; compare `senderSharedSecret` with
     `crypto.timingSafeEqual` over equal-length buffers (length check first) —
     mismatch → respond `buildCxmlResponse({ statusCode: 401, statusText: "unauthorized" })` with HTTP 401, Content-Type text/xml.
   - Dispatch on the body's root element: `ConfirmationRequest` → `parseConfirmationRequest`; `ShipNoticeRequest` → `parseShipNoticeRequest`; `InvoiceDetailRequest` → `parseInvoiceDetailRequest`. Unknown → cXML 400 response.
   - For each: `insertCxmlDocument` (direction `Inbound`; documentType
     `Order Confirmation` / `Ship Notice` / `Invoice` or `Credit Memo` by purpose;
     `payloadId` from the envelope; `externalId` = confirmID/shipmentID/invoiceID;
     `supplierId` from integration metadata; `createdBy: "system"` — grep one
     existing service-role write using `createdBy: "system"` to confirm the
     literal; if the convention is a different sentinel, use that). If
     `duplicate: true` → immediately reply cXML 200 (idempotent redelivery).
   - Confirmation: `applyCxmlConfirmation`; success → document `Posted` (with the
     PO id linked); PO-not-found or partial → `Needs Review` + issues.
   - Ship notice: `applyCxmlShipNotice`; same status handling.
   - Invoice/Credit Memo: link the PO if found (issues if not); status always
     `Needs Review`. No invoice creation here.
   - Reply `buildCxmlResponse({ statusCode: 200, statusText: "success", ... })`,
     HTTP 200, `Content-Type: text/xml`. Handler-level try/catch → cXML 500 +
     HTTP 500 so McMaster redelivers.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```
Functional check (dev stack + installed integration, else defer to Task 14):
```bash
curl -s -X POST http://erp.cxml-punchout-integration.dev/api/webhook/mcmaster-carr/$COMPANY_ID \
  -H "Content-Type: text/xml" --data-binary @packages/ee/src/punchout/cxml/__fixtures__/order-confirmation.xml | grep -o 'code="[0-9]*"'
# Expected: code="401" with wrong secret fixture; code="200" after setting the fixture's secret as inboundSharedSecret
```

**Out of scope:** No auto invoice creation, no receipt creation, no 997-style ack
reconciliation.

## Task 10: cXML document queue UI (list + drawer + release/reject/resend)

**Depends on:** Tasks 6, 9 (and 8 for resend)
**Files:**
- Create: `apps/erp/app/routes/x+/purchasing+/cxml.tsx`
- Create: `apps/erp/app/routes/x+/purchasing+/cxml.$id.tsx`
- Create: `apps/erp/app/modules/purchasing/ui/Cxml/CxmlDocumentsTable.tsx`
- Create: `apps/erp/app/modules/purchasing/ui/Cxml/CxmlDocumentStatus.tsx`
- Create: `apps/erp/app/modules/purchasing/ui/Cxml/index.ts`
- Modify: `apps/erp/app/modules/purchasing/ui/usePurchasingSubmodules.tsx` — add `{ name: t`Documents`, to: path.to.cxmlDocuments, icon: <LuFileCode />, table: "cxmlDocument" }` to the Manage group
- Copy from (precedent): `apps/erp/app/routes/x+/workflows+/runs.tsx` + `runs.$runId.tsx` (list + Drawer pair), `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrdersTable.tsx` (Table usage + status badge patterns)

**Steps:**
1. List route: `requirePermissions({ view: "purchasing" })`,
   `getGenericQueryFilters`, `getCxmlDocuments`, render
   `<VStack spacing={0} className="h-full"><CxmlDocumentsTable data count /><Outlet /></VStack>`.
   Columns: type, direction, status (badge component: `Received`/`Posted`/`Sent`
   green-ish, `Needs Review`/`Pending` yellow, `Failed`/`Rejected` red — copy the
   badge idiom from an existing status component in purchasing), supplier,
   PO readable id (link to `path.to.purchaseOrder`), externalId, createdAt. Row
   click navigates to `path.to.cxmlDocument(id)`.
2. Drawer route: loader loads the document; render `Drawer` (size `"lg"` — ERP
   default is md but payload JSON needs room; match the workflows drawer size
   choice) with: header (type + externalId), status, issues list, linked PO link,
   pretty-printed payload (`<pre>` with the JSON), and action buttons:
   - Invoice/Credit Memo in `Needs Review`: "Create invoice" → action calls
     `releaseCxmlInvoice`, redirects to the created purchase invoice with flash.
   - Any `Needs Review`: "Reject" → `rejectCxmlDocument`.
   - Outbound `Failed`: "Resend" → `trigger("punchout-send-po", ...)` (permission
     `purchasing_update`).
   Actions live in the drawer route's action, dispatched by intent field
   (ValidatedForm or plain `<Form method="post">` with `name="intent"` — copy the
   intent-dispatch idiom from `runs.$runId.tsx` if present, else from any drawer
   route with multiple actions).
3. No counts in parentheses anywhere (house rule).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```
Manual (dev stack): `/x/purchasing/cxml` renders the table; posting the
confirmation fixture (Task 9 curl) makes a row appear; opening it shows the drawer.

**Out of scope:** No realtime subscription (revisit if queue latency matters), no
CSV export, no filters beyond the generic ones.

## Task 11: Punchout entry-point UI (orders list button, waiting modal, PO append)

**Depends on:** Task 7
**Files:**
- Create: `apps/erp/app/modules/purchasing/ui/Punchout/PunchoutShopButton.tsx` (button + waiting dialog + popup/postMessage logic)
- Create: `apps/erp/app/modules/purchasing/ui/Punchout/index.ts`
- Modify: `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrdersTable.tsx` — render `<PunchoutShopButton />` next to the `New` primary action (inside the same `primaryAction` fragment) when `useIntegrations().has("mcmaster-carr")` and `permissions.can("create", "purchasing")`
- Modify: the draft-PO header component (find it: `grep -r "PurchaseOrderHeader" apps/erp/app/modules/purchasing/ui/PurchaseOrder/ --include="*.tsx" -l`) — add a secondary "Add from McMaster-Carr" action shown only when status is `Draft`, integration installed, and `purchaseOrder.supplierId` equals the integration's configured supplier
- Copy from (precedent): `packages/ee/src/onshape/config.tsx` `onClientInstall` (window.open + message listener + popup-blocked fallback), `apps/erp/app/components/New.tsx` (button styling), `PurchaseOrderFinalizeModal.tsx` (modal + fetcher idiom)

**Steps:**
1. `PunchoutShopButton({ purchaseOrderId? })`:
   - onClick: `fetcher.submit` to `path.to.api.punchoutStart` with optional
     `purchaseOrderId`. On `{ startPageUrl, sessionId }`: open centered popup
     (Onshape geometry: 600×800 minimum — use 1100×800 for a shopping site);
     popup blocked → `window.open(startPageUrl, "_blank")` fallback (do NOT
     full-redirect the ERP tab — the punchout return closes its own window).
   - Show a Modal: "Shopping on McMaster-Carr — check out there to bring your
     cart back." with a Cancel button (marks nothing server-side; just closes
     and ignores the session).
   - `window.addEventListener("message", ...)` for `punchout:returned:{sessionId}`
     → `fetcher.submit` POST to `path.to.api.punchoutConsume(sessionId)` (the
     action redirects to the PO). `punchout:cancelled:*` → close the modal
     quietly.
   - Fallback poll: while the modal is open, poll `path.to.api.punchoutStatus`
     every 3s with a fetcher (`useInterval`-style `setInterval` in a `useEffect`,
     cleared on unmount); on `Returned` do the same consume submit. This covers
     COOP/popup edge cases where postMessage never arrives.
   - Because the consume POST comes from the ERP tab, audit fields carry the real
     user.
2. The integration's configured supplierId for the append-button condition:
   expose it the same way the finalize modal got it in Task 8 (shared helper or
   loader data — reuse whatever Task 8 landed; do not duplicate a second
   metadata-fetch path).
3. ERP component sizing: default `size="md"` (ERP, not MES).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```
Manual flow is Task 14's job (needs the Task 12 mock).

**Out of scope:** No punchout tile/catalog page, no Level 2 search, no MES surface.

## Task 12: Dev-only mock supplier endpoint

**Depends on:** Task 3
**Files:**
- Create: `apps/erp/app/routes/api+/punchout.mock.ts`

**Steps:**
1. Guard: at the top of both loader and action,
   `if (process.env.NODE_ENV === "production") throw new Response("Not found", { status: 404 })`.
2. Action (plays McMaster's POSR endpoint): parse the posted POSR XML with
   `parseCxmlEnvelope` + a light read of `BuyerCookie` and `BrowserFormPost/URL`;
   respond with a `PunchOutSetupResponse` (build inline — this is a fixture-grade
   template literal) whose `StartPage/URL` is
   `${origin}/api/punchout/mock?cookie=${encodeURIComponent(buyerCookie)}&return=${encodeURIComponent(returnUrl)}`.
3. Loader (plays the McMaster storefront): renders a minimal HTML page ("Mock
   McMaster-Carr — 3 items") with two forms POSTing to the `return` URL:
   - "Checkout" — hidden `cxml-urlencoded` field containing the POOM fixture with
     its BuyerCookie replaced by the `cookie` query param (string-replace on the
     fixture at request time).
   - "Cancel" — hidden `cxml-urlencoded` with an empty-cart POOM (same envelope,
     no `ItemIn`).
4. To test end-to-end locally: install the integration with
   `punchoutUrl = ${origin}/api/punchout/mock` and any secrets.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** No mock for the order URL beyond returning a static 200 cXML
Response (add a `?as=order` branch on the action that returns
`buildCxmlResponse(200)` so Task 8 can be exercised too — one line, do include it).

## Task 13: Docs sync (curated docs site page)

**Depends on:** Tasks 5–11 (documents real behavior)
**Files:**
- Create/Modify: page under `docs/content/` for the McMaster-Carr integration (use the `carbon-docs` skill; place it wherever existing integration docs live — locate with `grep -ril "paperless" docs/content/ | head`)

**Steps:**
1. Invoke the `carbon-docs` skill. Content: what the integration does, the
   onboarding path (eProcurement@mcmaster.com, ~30 days, credential list), the
   settings fields, the punchout shopping flow, what happens automatically
   (confirmations, tracking) vs reviewed (invoices), and the cancellation caveat.
   Ground every claim in the implemented code, not this plan.

**Verify:**
```bash
pnpm --filter docs build
# Expected: build succeeds (per carbon-docs skill's verification loop)
```

**Out of scope:** API reference docs (codegen), glossary changes unless the skill's
checklist demands one.

## Task 14: Browser verification via /test

**Depends on:** all previous
**Files:** none (verification)

**Steps:**
1. Boot the stack with plain `crbn up` (portless). Log in via `/auth`.
2. Enable the integration at `/x/settings/integrations`: pick a supplier (create
   "McMaster-Carr" supplier if the seed lacks one), environment Test,
   `punchoutUrl` = `<origin>/api/punchout/mock`, order URLs =
   `<origin>/api/punchout/mock?as=order`, identities per fixtures
   (`fromIdentity: tester`, `toIdentity: 006931349`), both secrets `mcmaster`
   (matching the fixtures), a default expense account.
3. Create `supplierPart` rows for one fixture part (e.g. `3201T16`) against an
   existing item so the matched-line path is exercised.
4. Drive with `/test` (agent-browser): full punchout round trip (button → mock
   shop → checkout → draft PO with 3 lines: 1 matched Part line, 2 G/L lines),
   cancel path, finalize with "Send via cXML" → document `Sent`, webhook curl
   posts for confirmation/ASN/invoice fixtures → PO fields updated + queue rows,
   "Create invoice" from the drawer → draft purchase invoice with correct totals.
   Screenshot each stage (memory: PRs for net-new work include screenshots).
5. Spec acceptance criteria checklist: walk every box in the spec's Acceptance
   Criteria and record pass/fail in the run log (`.ai/runs/`).

**Verify:**
```bash
# The /test skill's own pass/fail output, plus:
pnpm run lint
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee --filter=@carbon/jobs
pnpm --filter @carbon/ee test
# Expected: all green
```

**Out of scope:** Live McMaster endpoints (blocked on onboarding — spec question C).
