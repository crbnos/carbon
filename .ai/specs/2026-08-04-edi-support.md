# EDI Support — Sell-Side X12 via Embedded Provider

> Status: draft (autonomous-mode spec — open questions resolved from codebase precedent + research consensus; provider-based architecture confirmed by Brad 2026-08-04; remaining ⚠️ flags: vendor signup, retail-ASN timing)
> Author: Claude (with Brad Barbin)
> Date: 2026-08-04
> Research: `.ai/research/edi-support.md`
> Related: `.ai/specs/2026-07-04-e-invoicing.md` (the architectural sibling — adapter framework, Carbon owns model + state machine, partner owns transmission), `.ai/specs/2026-07-04-integration-surface.md` (webhook/event-system precedent)

## TLDR

Carbon gets sell-side EDI — the set trading partners actually mandate (research: Amazon/Walmart/industrial buyers all start here): **inbound 850 purchase orders landing in a review queue and becoming sales orders**, **outbound 855 acknowledgments on order confirmation**, **outbound 856 ASNs on shipment post**, **outbound 810 invoices on sales invoice post**, with **997 acknowledgment tracking** and SLA timers. Carbon does **not** build an X12 translator: translation, partner-specific validation, envelopes/control numbers, 997 generation, and AS2/SFTP/VAN connectivity are rented from an API-first EDI provider (recommended: Orderful; the design is provider-agnostic behind an `EdiProvider` interface in `packages/ee/src/edi/`, mirroring how `packages/ee/src/accounting` abstracts Xero/QBO/Rillet). Carbon owns what only the ERP can own — the trading partner profile (per-customer config: enabled documents, release mode, ship-to and part cross-references), the `ediDocument` staging record with an explicit status lifecycle and reprocess-after-fix semantics (SAP's proven model, with readable states instead of numeric codes), document↔record mapping through existing service functions (`insertSalesOrder`, `customerPartToItem`), and the exception/monitor UI. Outbound documents are generated from the **actual posted transaction** (shipment, invoice), never from the order — the research's #1 chargeback rule. Phase 1 ASNs use the flat shipment structure (no cartons); the carton/pallet packing model + GS1-128/SSCC-18 labels are Phase 2. Buy-side EDI (outbound 850 to suppliers) and automotive release accounting (830/862, CUMs, scheduling agreements) are explicitly out of scope — automotive is a separate future spec because it requires a blanket-order/release model Carbon doesn't have.

## Problem Statement

Manufacturers selling to large customers (retailers, OEMs, major industrial accounts) are **required** to trade via EDI as a condition of doing business — the buyer mandates it and enforces it with chargebacks ($50–$1,000 per violation; Walmart OTIF at 3% of PO value). Today Carbon has zero EDI capability (grep confirms: no EDI/X12/856/ASN references anywhere in source). A Carbon customer who wins a contract with an EDI-mandating buyer must today:

1. Re-key inbound customer POs from a web portal or PDF into sales orders by hand (slow, error-prone, and unacknowledged — most buyers require an 855 within 24h).
2. Have no way to send the mandatory 856 ASN at ship time, or the 810 invoice — which either blocks the relationship entirely or forces them onto a standalone web-EDI portal with double entry against Carbon.
3. Have no visibility into acknowledgment status — a silently rejected invoice never gets paid.

Competitively, every mid-market manufacturing ERP has an answer here (NetSuite via certified providers, Epicor via Demand Management + acquired EDI, Plex natively), and "do you support EDI" is a table-stakes RFP question. Research consensus (`.ai/research/edi-support.md`): the ERP must own the workflow surface and rent the wire — parsing X12 is ~10% of the problem; partner-map maintenance, acks, control numbers, and AS2/VAN operations are the other 90% and are exactly what API-first providers sell (~$189/partner/month flat at Orderful).

## Proposed Solution

### Architecture overview

```
                       ┌──────────────── Carbon ────────────────────────────┐
Trading    X12 over    │                                                    │
Partner ──AS2/VAN/SFTP──▶ EDI Provider ──webhook──▶ api+/webhook.edi.$companyId
(Walmart,  (provider-   │ (Orderful:      (JSON)    │ verify + trigger()    │
 OEM, …)    managed)    │  translate,               ▼                       │
                        │  validate,      Inngest edi-process-inbound       │
                        │  997s,          │ re-fetch via provider API       │
                        │  envelopes)     ▼                                 │
                        │           ediDocument (staged, status lifecycle)  │
                        │                 │ resolve: partner, parts,        │
                        │                 │ ship-to, price                  │
                        │                 ▼                                 │
                        │        clean + Automatic ──▶ insertSalesOrder     │
                        │        issues or Review ───▶ Needs Review queue   │
                        │                                                   │
                        │  salesOrder Confirmed ─┐                          │
                        │  shipment Posted ──────┼─event system──▶ Inngest  │
                        │  salesInvoice Posted ──┘  (EDI handler)  edi-send-│
                        │                                          document │
                        │                              │ build canonical   │
                        ◀──────────provider API POST───┘ payload (855/856/ │
                        │  provider ack webhook ──▶ status: Acknowledged    │
                        └────────────────────────────────────────────────────┘
```

- **Provider owns**: X12 ↔ JSON translation, partner-specific implementation-guide validation, ISA/GS/ST envelopes and control numbers, inbound/outbound 997 generation and matching, AS2/SFTP/VAN connectivity, partner onboarding/certification.
- **Carbon owns**: trading partner profiles and cross-references, the `ediDocument` staging/status lifecycle, mapping to/from real ERP records via existing service functions, the review/exception queue UI, acknowledgment SLA surfacing, and canonical JSON payload shapes.

### Inbound flow (850 → sales order)

1. Provider webhook hits `api+/webhook.edi.$companyId.ts` (Xero/Jira/Linear route pattern): verify the company's EDI integration is active, verify the provider signature against the raw body, then process **inline in the route** via `processInboundEdiTransaction` (sales service). Inbound cannot ride an Inngest job because sales-order creation must reuse `insertSalesOrder`/`resolvePrice`, which live in the ERP module layer the jobs package cannot import; the provider's webhook redelivery on non-2xx supplies the retry semantics. The signed body is trusted when it embeds the transaction; otherwise the service re-fetches it from the provider API.
2. `processInboundEdiTransaction`: map to the canonical `EdiOrderPayload` → insert `ediDocument` (direction `Inbound`, type `Purchase Order`, status `Received`, `externalId` = provider transaction id — the unique index makes redelivery idempotent).
3. **Resolution** (pure function in `packages/ee/src/edi/resolve.ts`, results recorded on `ediDocument.issues`):
   - **Partner**: provider partnership id → `ediTradingPartner` (webhook is company-scoped; unknown partner → issue).
   - **Ship-to**: buyer location code → `ediTradingPartnerLocation` → `customerLocationId` (miss → issue).
   - **Items** (resolution ladder per research): `customerPartToItem` by `(customerId, customerPartId)` → fallback exact match on `item.readableId` → miss → issue naming the unresolved buyer part.
   - **Price**: document unit price vs `resolvePrice` result; deviation beyond `ediTradingPartner.priceTolerancePercent` → issue (document price is what the SO will carry — see DD-10).
4. **Disposition**: zero issues + partner `releaseMode = 'Automatic'` → create the sales order immediately (`insertSalesOrder` + `insertSalesOrderLines`, `customerReference` = buyer PO number, document price on lines) and set status `Posted` with `sourceDocument`/`sourceDocumentId` linking the SO. Any issue, or `releaseMode = 'Review'` → status `Needs Review`; an operator resolves from the queue (add a part cross-reference, map a location, accept the price) and clicks **Release** — resolution re-runs against the *unchanged* stored payload (SAP's fix-the-data-reprocess-the-message semantics), then creates the SO. **Reject** sets status `Rejected` (terminal; the buyer is notified out-of-band or via a rejecting 855 in a later phase).
5. Fixing a missing cross-reference in the queue **persists** it (`customerPartToItem` / `ediTradingPartnerLocation` insert), so the same buyer part never needs manual attention twice.

### Outbound flow (855 / 856 / 810)

Outbound generation rides the event system (`.claude/rules/event-system.md`) — the writers (routes and edge functions like `post-shipment`) don't need to know EDI exists:

| Trigger | Event subscription | Document |
|---|---|---|
| `salesOrder` UPDATE, status leaves `Draft`/`Needs Approval` (checked in the handler — the confirm route sets status via `getSalesOrderStatus`, which may skip the literal `Confirmed`; dedup = no existing ack document for the order) | table `salesOrder`, no filter | 855 PO Acknowledgment (accept-as-is; line-level accept-with-changes is Phase 2) |
| `shipment` UPDATE, status → `Posted` | table `shipment`, filter `{ status: "Posted" }`; handler requires `sourceDocument = 'Sales Order'` | 856 ASN |
| `salesInvoice` UPDATE, status → `Submitted` (the posted state set by `post-sales-invoice`) | table `salesInvoice`, filter `{ status: "Submitted" }` | 810 Invoice |

A new `EDI` handler type (additive to the `eventSystemSubscription` CHECK + a new `packages/jobs/src/inngest/functions/events/edi.ts` handler, per `.claude/rules/workflow-event-system.md`) filters cheaply: look up the record's `customerId` → active `ediTradingPartner` with that document enabled → if none, drop; else `trigger("edi-send-document", { companyId, documentType, recordId })`.

Inngest `edi-send-document`: build the canonical payload **from the posted record** (856 from `shipment` + `shipmentLine` + `trackingNumber` + ship method SCAC; 810 from `salesInvoice(Line)`; both echo the buyer's PO number from `customerReference` and the buyer's part numbers via reverse `customerPartToItem` lookup) → insert `ediDocument` (direction `Outbound`, status `Pending`) → POST to the provider → status `Sent` + `externalId`. A missing `customerReference` or unmappable part is a hard `Failed` with an issue — never send a document the buyer can't match. Transport errors retry with Inngest backoff (document stays `Pending`); provider-side validation rejection → `Failed` with the provider's reasons verbatim in `issues`.

**Acknowledgment tracking**: provider ack webhooks (997 accepted/rejected) update the outbound document to `Acknowledged` or `Failed`. A scheduled Inngest job (`edi-reconcile-acks`, hourly) flags `Sent` documents older than 24h without an ack (adds an `unacknowledged` issue) so the queue's filter surfaces them — the research's "silently rejected 810 never gets paid" failure mode.

### Canonical payloads and provider interface (`packages/ee/src/edi/`)

```ts
// types.ts — canonical JSON shapes (the Guide-JSON idea, provider-neutral)
type EdiOrderPayload = {
  partnerReference: string;          // buyer PO number
  orderDate: string;
  requestedShipDate?: string;
  shipTo: { code: string; name?: string; address?: {...} };
  lines: Array<{
    partnerLineNumber: string;
    partnerPartId: string;           // buyer part number
    partnerPartRevision?: string;
    quantity: number;
    unitOfMeasure: string;
    unitPrice: number;
    requestedDate?: string;
  }>;
};
// EdiAckPayload, EdiShipNoticePayload (shipment-level: lines, quantities,
// tracking number, SCAC, ship/estimated-delivery dates, weight), EdiInvoicePayload

// provider.ts
interface EdiProvider {
  readonly id: "orderful";                       // future: "stedi", …
  getTransaction(companyId: string, externalId: string): Promise<InboundTransaction>;
  sendTransaction(companyId: string, args: {
    partnerExternalId: string;
    documentType: EdiDocumentType;
    payload: EdiOutboundPayload;
  }): Promise<{ externalId: string }>;
  verifyWebhook(request: Request): Promise<boolean>;
}
```

Provider adapters map canonical ↔ provider JSON. Credentials live in `companyIntegration.metadata` (a seeded `integration` row per provider, e.g. `orderful`, with `jsonschema` validation — Linear precedent), registered via `defineIntegration` in `packages/ee/src/edi/orderful/config.tsx` so it appears on the Settings → Integrations page. No new npm dependency: the provider is an HTTPS API.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Build vs rent the translator | Rent: API-first provider owns translation/validation/acks/connectivity; Carbon never parses X12 | Unanimous research consensus (NetSuite ecosystem, build-vs-buy analyses, thin OSS JS parsers); partner-spec churn is a compliance treadmill (SPS absorbs ~9,000 changes/yr) |
| 2 | First provider | **Orderful** (recommendation, pending Brad's commercial confirmation); interface is provider-agnostic from day one | Purpose-built "Embedded EDI for SaaS platforms" product, flat ~$189/partner/mo unlimited docs, pre-connected retail/OEM network, partner-specific pre-send validation (chargeback prevention). Stedi is architecturally cleanest but has pivoted GTM to healthcare clearinghouse (risk); managed networks (SPS/TrueCommerce) don't embed |
| 3 | Where the framework lives | `packages/ee/src/edi/` (canonical types, provider adapters, resolution logic); ERP glue in the **sales** module | Mirrors `packages/ee/src/accounting` + e-invoicing spec (DD-10 there); ee is the integrations home |
| 4 | Module / permission family | No new module or permission family: EDI documents are gated by `sales_*`, provider credentials by `settings_*` | Lesson "Features live inside existing permission modules"; Phase 1 is entirely sell-side (customers/orders). Revisit only if buy-side EDI lands |
| 5 | Multi-tenancy (heuristic 1) | All four new tables: `companyId`, composite PK `("id","companyId")`, `id('<prefix>')` defaults, audit columns, `customFields` | House convention; `customerId` FKs are composite `(customerId, companyId) → customer(id, companyId)` per `20260703143904_composite-tenant-fks.sql` |
| 6 | Service shape (heuristic 2) | New functions in `sales.service.ts` / validators in `sales.models.ts`; `(client, …) → { data, error }`, never throw | One service/models file per module (module-service memory); EDI lives in sales per DD-4 |
| 7 | RLS (heuristic 3) | Standard four policies per table: SELECT `get_companies_with_employee_role()`, INSERT/UPDATE/DELETE `get_companies_with_employee_permission('sales_*')`, `(SELECT …)::text[]` wrapping | Current RLS convention (module-conventions.md); Inngest jobs write via service role (bypasses RLS) as accounting sync does |
| 8 | Permission scoping (heuristic 4) | Queue/partner routes: `requirePermissions({ view/update: "sales" })`; integration config route: `settings`; webhook route: no session (signature + active-integration check, Xero pattern) | Matches existing webhook ingress and settings-gated integrations |
| 9 | Status lifecycle | One readable enum, direction-shared: `Received → Needs Review → Posted / Rejected` (inbound), `Pending → Sent → Acknowledged / Failed` (outbound); reprocess = re-run resolution on the unchanged stored payload | SAP status-model lessons applied (readable states, resumable errors, message-as-truth); no numeric codes, no editing the message |
| 10 | Price handling on inbound 850 | SO lines carry the **document** price; deviation beyond partner tolerance raises a review issue | Buyer's PO price is the commercial reality (mismatch surfaces as short-pays later otherwise — research Q1); tolerance default 0 = any mismatch reviews |
| 11 | Auto-create vs review | Per-partner `releaseMode`: `'Review'` (default) always holds; `'Automatic'` releases only when zero issues | Epicor "Accept If No Errors" pattern; silent auto-accept and blanket reject are both named anti-patterns |
| 12 | ASN structure | Phase 1 = flat shipment-level ASN (no carton/pallet detail); packing model + GS1-128/SSCC-18 labels = Phase 2, **required before onboarding a big-box retail partner** | Carbon has no carton model today; flat ASNs satisfy many industrial/OEM partners; label↔ASN coherence is where chargebacks live, so cartons must be done properly, not bolted on |
| 13 | Outbound trigger rail | Event-system subscriptions + new `EDI` handler type; never branch posting edge functions | Writers stay EDI-ignorant; the event system exists exactly for this (additive per workflow-event-system.md) |
| 14 | Dedup / idempotency | Inbound: unique `(companyId, externalId)` on `ediDocument` (provider transaction id); duplicate buyer PO number → review issue, not silent drop | Provider re-envelopes, so wire control numbers aren't ours (Stedi caveat); provider transaction id is the stable key |
| 15 | Document history | Status transitions audit-logged via the existing audit log system; current validation problems in `ediDocument.issues` JSONB | Reuse over a bespoke event table; SAP append-only-history intent preserved with zero new infrastructure |
| 16 | Backward compatibility (heuristic 7) | Everything additive: new tables, new enum values nowhere reused, new handler type, new routes. No EDI partner configured → no subscriptions match → zero behavior change | Existing customers/orders/shipments untouched |
| 17 | Forms (heuristic 5) | Trading partner config + location mappings via `ValidatedForm` + zod validators + route actions; detail views as Drawer overlays | House convention + Drawer-detail memory |
| 18 | 855 semantics (Phase 1) | Sent on SO `Confirmed` as accept-as-is; explicit user **Reject** in the queue does not yet emit a rejecting 855 | Line-level accept-with-changes (IC/IQ/IR codes) needs per-line UI — deferred with the 860/865 change flow to Phase 2 |

## Data Model Changes

Migration via `pnpm db:migrate:new edi-support` (forward-dated, randomized HHMMSS per lessons), then `pnpm run generate:types` before typechecking.

```sql
-- Enums (capitalized, display-friendly per house convention)
CREATE TYPE "ediDocumentType" AS ENUM (
  'Purchase Order',                  -- X12 850 (inbound)
  'Purchase Order Acknowledgment',   -- X12 855 (outbound)
  'Advance Ship Notice',             -- X12 856 (outbound)
  'Invoice'                          -- X12 810 (outbound)
);
CREATE TYPE "ediDocumentDirection" AS ENUM ('Inbound', 'Outbound');
CREATE TYPE "ediDocumentStatus" AS ENUM (
  'Received', 'Needs Review', 'Posted', 'Rejected',   -- inbound path
  'Pending', 'Sent', 'Acknowledged', 'Failed'          -- outbound path
);
CREATE TYPE "ediReleaseMode" AS ENUM ('Automatic', 'Review');

-- Trading partner profile: the central config entity (one per customer)
CREATE TABLE "ediTradingPartner" (
    "id" TEXT NOT NULL DEFAULT id('editp'),
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "externalId" TEXT,                     -- provider partnership/trading-partner id
    "active" BOOLEAN NOT NULL DEFAULT FALSE,
    "releaseMode" "ediReleaseMode" NOT NULL DEFAULT 'Review',
    "priceTolerancePercent" NUMERIC NOT NULL DEFAULT 0,   -- fraction 0–1, house convention
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    CONSTRAINT "ediTradingPartner_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "ediTradingPartner_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ediTradingPartner_customerId_fkey" FOREIGN KEY ("customerId", "companyId")
      REFERENCES "customer"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "ediTradingPartner_customer_unique" UNIQUE ("customerId", "companyId")
);

-- Per-partner document enablement (extensible to 860/846/… without schema change)
CREATE TABLE "ediTradingPartnerDocument" (
    "id" TEXT NOT NULL DEFAULT id('editpd'),
    "companyId" TEXT NOT NULL,
    "tradingPartnerId" TEXT NOT NULL,
    "documentType" "ediDocumentType" NOT NULL,
    "direction" "ediDocumentDirection" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "ediTradingPartnerDocument_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "ediTradingPartnerDocument_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ediTradingPartnerDocument_partner_fkey" FOREIGN KEY ("tradingPartnerId", "companyId")
      REFERENCES "ediTradingPartner"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "ediTradingPartnerDocument_unique"
      UNIQUE ("tradingPartnerId", "documentType", "direction", "companyId")
);

-- Buyer ship-to location code → Carbon customer location (the EDPAR idea, named for its role)
CREATE TABLE "ediTradingPartnerLocation" (
    "id" TEXT NOT NULL DEFAULT id('editpl'),
    "companyId" TEXT NOT NULL,
    "tradingPartnerId" TEXT NOT NULL,
    "externalCode" TEXT NOT NULL,          -- buyer's store/DC/DUNS location code
    "customerLocationId" TEXT NOT NULL REFERENCES "customerLocation"("id") ON DELETE CASCADE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "ediTradingPartnerLocation_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "ediTradingPartnerLocation_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ediTradingPartnerLocation_partner_fkey" FOREIGN KEY ("tradingPartnerId", "companyId")
      REFERENCES "ediTradingPartner"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "ediTradingPartnerLocation_unique"
      UNIQUE ("tradingPartnerId", "externalCode", "companyId")
);

-- The staged EDI document: message-as-truth record with status lifecycle
CREATE TABLE "ediDocument" (
    "id" TEXT NOT NULL DEFAULT id('edi'),
    "companyId" TEXT NOT NULL,
    "tradingPartnerId" TEXT,               -- nullable: unresolved partner is itself an issue
    "direction" "ediDocumentDirection" NOT NULL,
    "documentType" "ediDocumentType" NOT NULL,
    "status" "ediDocumentStatus" NOT NULL,
    "externalId" TEXT,                     -- provider transaction id (dedup + ack correlation)
    "partnerReference" TEXT,               -- buyer PO number
    "payload" JSONB NOT NULL,              -- canonical JSON (immutable after insert)
    "issues" JSONB NOT NULL DEFAULT '[]',  -- [{ code, message, path?, resolvedAt? }]
    "sourceDocument" TEXT,                 -- 'Sales Order' | 'Shipment' | 'Sales Invoice'
    "sourceDocumentId" TEXT,
    "sourceDocumentReadableId" TEXT,
    "acknowledgedAt" TIMESTAMP WITH TIME ZONE,
    "releasedBy" TEXT REFERENCES "user"("id"),
    "releasedAt" TIMESTAMP WITH TIME ZONE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    CONSTRAINT "ediDocument_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "ediDocument_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ediDocument_partner_fkey" FOREIGN KEY ("tradingPartnerId", "companyId")
      REFERENCES "ediTradingPartner"("id", "companyId") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "ediDocument_externalId_unique"
  ON "ediDocument" ("companyId", "externalId") WHERE "externalId" IS NOT NULL;
CREATE INDEX "ediDocument_status_idx" ON "ediDocument" ("companyId", "status");
CREATE INDEX "ediDocument_partner_idx" ON "ediDocument" ("companyId", "tradingPartnerId");

-- RLS on all four tables (standard shape; shown once)
ALTER TABLE "ediDocument" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "ediDocument" FOR SELECT USING (
  -- tightened view-permission variant, so reads require sales_view (matches acceptance criteria)
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[])
);
CREATE POLICY "INSERT" ON "ediDocument" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
CREATE POLICY "UPDATE" ON "ediDocument" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
CREATE POLICY "DELETE" ON "ediDocument" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);
-- (same four policies on ediTradingPartner / ediTradingPartnerDocument / ediTradingPartnerLocation)

-- Provider integration seed row (Linear precedent)
INSERT INTO "integration" ("id", "jsonschema")
VALUES ('orderful', '{ "type": "object", "properties": { "apiKey": {"type":"string"},
  "webhookSecret": {"type":"string"}, "environment": {"type":"string","enum":["sandbox","production"]} },
  "required": ["apiKey","webhookSecret"] }')
ON CONFLICT ("id") DO NOTHING;

-- Event-system additions
-- 1. Extend eventSystemSubscription handlerType CHECK to include 'EDI' (drop + re-add constraint)
-- 2. attach_event_trigger('salesOrder'…), attach_event_trigger('shipment'…),
--    attach_event_trigger('salesInvoice'…) where not already attached
```

No existing tables are modified. `customerPartToItem` is reused as-is for part cross-references.

## API / Service Changes

**`apps/erp/app/modules/sales/sales.service.ts`** (per DD-6):
- `getEdiTradingPartner(client, customerId, companyId)` / `getEdiTradingPartners(client, companyId, args)` / `upsertEdiTradingPartner` / `upsertEdiTradingPartnerDocuments` / `upsertEdiTradingPartnerLocation` / `deleteEdiTradingPartnerLocation`
- `getEdiDocuments(client, companyId, args)` (status/partner/type filters, paginated) / `getEdiDocument(client, id, companyId)`
- `releaseEdiDocument(client, id, companyId, userId)` — re-runs resolution on the stored payload; zero issues → creates the SO (composing `insertSalesOrder` / `insertSalesOrderLines`) and sets `Posted`; remaining issues → stays `Needs Review` with refreshed issues
- `rejectEdiDocument(client, id, companyId, userId)`

**`apps/erp/app/modules/sales/sales.models.ts`**: `ediTradingPartnerValidator`, `ediTradingPartnerLocationValidator`, `ediDocumentFilterValidator` (+ enum zod mirrors).

**`packages/ee/src/edi/`** (new): `types.ts` (canonical payloads), `provider.ts` (interface + registry), `orderful/` (`config.tsx` via `defineIntegration`, `lib/client.ts`, `lib/mapper.ts`), `resolve.ts` (pure resolution: partner/ship-to/item/price → issues list), `build.ts` (posted record → canonical outbound payload). Exported as `@carbon/ee/edi` (+ `.server` subpath), matching sibling providers.

**Routes**:
- `api+/webhook.edi.$companyId.ts` — provider webhook ingress (signature check, active-integration check, `trigger`)
- `x+/edi+/_layout.tsx` (`handle.module: "sales"`), `x+/edi+/documents.tsx` (queue list), `x+/edi+/documents.$id.tsx` (Drawer detail: payload summary, issues with inline fixes, linked record, Release/Reject/Retry, raw JSON view)
- `x+/customer+/$customerId.edi.tsx` — trading partner config on the customer detail (enable, provider partner id, document toggles, release mode, price tolerance, location mappings)
- Path helpers added to `apps/erp/app/utils/path.ts` (`path.to.ediDocuments`, etc.)

**Jobs** (`packages/jobs/src/inngest/functions/integrations/edi.ts`, registered per the barrel + `inngest/index.ts` functions-array recipe; events added to `packages/lib/src/events.ts` + `taskToEvent` in `trigger.ts`):
- `edi-send-document` (`carbon/edi.send-document`) — outbound build + provider POST
- `edi-reconcile-acks` (hourly cron) — flags `Sent` documents unacknowledged after 24h
- New event handler `packages/jobs/src/inngest/functions/events/edi.ts` for handlerType `EDI`
- (No inbound job — inbound runs inline in the webhook route; see Inbound flow.)

## UI Changes

- **Settings → Integrations**: Orderful card (API key, webhook secret, environment) — rendered automatically by the existing integrations registry once `defineIntegration` + seed row exist.
- **Customer detail → EDI tab**: partner config form (`ValidatedForm`), document toggles table, location-mapping table with inline add.
- **Sales sidebar → EDI**: document queue — table with status/type/partner filters and status badges; row click opens the Drawer detail. Issues render as an actionable list (e.g. "Unknown buyer part `WIDGET-42` — map to an item" with an inline item select that writes `customerPartToItem`). Unacknowledged-outbound filter chip surfaces ack SLA breaches.
- No MES changes.

## Acceptance Criteria

- [ ] With the Orderful integration active and a customer's trading partner configured (`releaseMode: 'Review'`, 850 inbound enabled), simulating the provider webhook for an 850 whose two lines both resolve via `customerPartToItem` creates an `ediDocument` in `Needs Review` with zero issues; clicking **Release** creates a sales order with the correct customer, two lines at the document prices, and `customerReference` equal to the buyer's PO number, and the document shows `Posted` with a link to the SO.
- [ ] The same inbound with `releaseMode: 'Automatic'` creates the sales order with no human action and the document lands directly in `Posted`.
- [ ] An inbound 850 referencing an unknown buyer part lands in `Needs Review` with an issue naming that part; mapping it to an item from the Drawer persists a `customerPartToItem` row, Release succeeds, and a second 850 with the same part auto-resolves.
- [ ] Redelivering the same provider webhook (same `externalId`) creates no second document and no second sales order.
- [ ] An inbound 850 with a unit price deviating beyond `priceTolerancePercent` shows a price issue and cannot auto-release even in `Automatic` mode.
- [ ] Posting a shipment for a sales order belonging to an EDI customer with ASN enabled creates an outbound `Advance Ship Notice` document that reaches `Sent`, whose payload contains the shipped quantities, buyer part numbers, buyer PO number, and tracking number (verified against a provider sandbox/mock).
- [ ] Posting a sales invoice for that customer produces an outbound `Invoice` document in `Sent`; confirming the sales order produces a `Purchase Order Acknowledgment` in `Sent`.
- [ ] A provider ack webhook reporting 997 acceptance moves the outbound document to `Acknowledged` (`acknowledgedAt` set); a rejection moves it to `Failed` with the provider's reasons visible in the Drawer.
- [ ] A `Sent` document with no ack after 24h is flagged by `edi-reconcile-acks` and appears under the queue's unacknowledged filter.
- [ ] A company with no EDI integration or partners sees zero behavior change: no jobs fire on order/shipment/invoice status changes (verified via Inngest dev server).
- [ ] A user without `sales_view` cannot read `ediDocument` rows; a user with `sales_view` but not `sales_update` can view the queue but not Release/Reject.
- [ ] `pnpm exec turbo run typecheck --filter=@carbon/erp --filter=@carbon/ee --filter=@carbon/jobs` passes after `pnpm run generate:types`.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Provider dependency (pricing changes, Orderful's roadmap, Stedi-style pivot) | Med | Provider-agnostic interface + canonical payloads from day one; `ediDocument.payload` stores the canonical JSON so history survives a provider switch |
| Flat ASN (no cartons) is insufficient for big-box retail compliance → chargebacks | High (if a retail partner onboards early) | Phase 2 (packing model + GS1-128/SSCC) is a hard prerequisite for retail partners; partner onboarding checklist states which ASN structures are supported |
| Partner onboarding is still weeks of provider-side certification per partner | Med | Set expectations in docs; Orderful's network claims days-not-weeks for already-connected buyers |
| Auto-released bad orders (Automatic mode) reach production | Med | Automatic releases only with zero issues; price tolerance defaults to 0; default mode is Review |
| Event-system fan-out adds load to posting paths | Low | AFTER STATEMENT triggers short-circuit with no active subscription (existing behavior); EDI handler drops non-EDI customers cheaply |
| 855 accept-as-is misrepresents partial acceptance | Low (Phase 1) | Documented limitation; buyers treat 855-accept + later contact as normal; line-level 855 is Phase 2 |
| `insertSalesOrder` contract drift breaks EDI order creation silently | Low | Acceptance test exercises the real service function; typecheck via `Awaited<ReturnType>` chain |

## Phasing

| Phase | Ships | Gate |
|---|---|---|
| **1 (this spec)** | Provider integration + partner profiles, inbound 850 → review queue → SO, outbound 855/856/810, ack tracking, queue UI | — |
| 2 | Carton/pallet packing model on shipments, GS1-128/SSCC-18 labels (printing system), pick-and-pack 856 structures, 860/865 change flow, line-level 855 | Required before any big-box retail partner |
| 3 | Buy-side: outbound 850 at PO finalize (branch alongside the existing email path), inbound 855/856/810 from suppliers | Partner-by-partner demand |
| 4 | Automotive release accounting: 830/862, scheduling agreements/blanket releases, CUM ledger, EDIFACT (DELFOR/DELJIT) | Separate spec — needs a release/blanket-order model Carbon doesn't have |

## Open Questions

> All resolved before writing (autonomous mode — resolutions from codebase precedent and research consensus; each is Brad-vetoable at review, and the first two are flagged as decisions Brad should explicitly confirm before implementation starts).

- [x] **Which EDI provider do we embed first (and is a commercial relationship acceptable)?** — **Autonomous:** design is provider-agnostic (`EdiProvider` interface, canonical payloads); **Orderful recommended** for the concrete Phase-1 adapter (embedded-EDI product, flat per-partner pricing, retail/OEM network, pre-send partner validation; Stedi's GTM pivot to healthcare makes it a riskier bet, managed networks don't embed). ⚠️ Signing up with a provider is a commercial decision only Brad can make — the adapter implementation should not start until confirmed. Everything else in the spec is provider-independent.
- [x] **Build our own X12 translator instead of a provider?** — **Autonomous:** no. Unanimous research consensus: syntax parsing is ~10% of the problem; partner-guide validation, ack reconciliation, control numbers, AS2 cert ops, and map churn are the 90% providers sell. OSS JS parsers are thin and unmaintained. Revisit only if a Plex-style bounded vertical (automotive) justifies native support in Phase 4.
- [x] **Phase 1 scope: which documents?** — **Autonomous:** inbound 850, outbound 855/856/810, 997 tracking — the near-universal mandated starter set (Amazon Vendor Central basics are exactly these). 860/865, 846, 940/945, buy-side, and automotive 830/862 all deferred per the phasing table.
- [x] **Flat ASN vs carton-level packing in Phase 1?** — **Autonomous:** flat (shipment→order→item) in Phase 1; Carbon has no carton/pallet model and bolting one on under EDI pressure risks exactly the label↔ASN mismatches that cause chargebacks. Phase 2 builds packing properly and is a hard gate for retail partners. ⚠️ If the first real customer for this feature ships to a big-box retailer, Phase 2 must be pulled forward — Brad should confirm the target partner profile.
- [x] **New `edi` module + permission family, or live in sales?** — **Autonomous:** sales module, `sales_*` permissions, `settings_*` for credentials (lesson: "Features live inside existing permission modules"; Phase 1 is wholly sell-side). A new family would need Ask-First approval and buys nothing yet.
- [x] **Auto-create sales orders or hold everything for review?** — **Autonomous:** per-partner `releaseMode`, defaulting to `Review`; `Automatic` releases only zero-issue documents (Epicor "Accept If No Errors" pattern; both blanket auto-accept and blanket reject are research-named anti-patterns).
- [x] **Which price wins when the 850 disagrees with Carbon pricing?** — **Autonomous:** the document price goes on the SO (it's the buyer's commercial commitment; internal-price substitution surfaces later as invoice short-pays), with deviation beyond a per-partner tolerance raising a blocking review issue. Tolerance defaults to 0.
- [x] **How do outbound documents trigger — branch the posting routes/edge functions, or the event system?** — **Autonomous:** event-system subscriptions with a new additive `EDI` handler type. Posting paths stay EDI-ignorant; the event system is the documented rail for exactly this (workflow-event-system.md), and edge-function writers (post-shipment) can't call `trigger()` directly anyway.
- [x] **Where do partner identifiers live — `externalIntegrationMapping` or a dedicated table?** — **Autonomous:** dedicated `ediTradingPartner` (+ document/location children). It's a config-rich domain entity (release mode, tolerances, doc enablement), not a bare id mapping; SAP/TPM consensus says the partner profile is the core entity. `ediDocument.externalId` carries the provider transaction id directly.
- [x] **How is inbound dedup keyed?** — **Autonomous:** unique `(companyId, externalId)` on the provider transaction id (wire control numbers belong to the provider's envelopes — Stedi's re-enveloping caveat). A repeated buyer PO number with a *different* transaction id raises a duplicate-PO review issue instead of silently dropping.
- [x] **Does rejecting an inbound 850 send anything to the buyer?** — **Autonomous:** not in Phase 1 (documented limitation; rejection is operator-driven and rare, and a rejecting 855 needs the line-level 855 work). Phase 2 adds it with the accept-with-changes codes.

## Changelog

- 2026-08-04 (implemented): Phase 1 implemented on `edi-support-research-spec` (15 tasks). Implementation refinements vs. the spec text: (1) the pure inbound-resolution helpers are exposed via the client-safe `@carbon/ee/edi` barrel and the sales service imports them there, keeping `sales.service.ts` (barrel-reachable) free of `node:crypto`; the webhook route re-fetches missing payloads via `@carbon/ee/edi.server`; (2) the parsed webhook carries `partnerExternalId` (provider partnership id) so the partner resolves against `ediTradingPartner.externalId`; (3) the Orderful adapter's `parseWebhook` (HMAC + mapper) is functional, but `getTransaction`/`sendTransaction` throw "not verified against sandbox" until the vendor account exists — so the outbound wire (855/856/810 reaching `Sent`/`Acknowledged`) is a **known gap** pending Brad's provider signup. Verified in the running app (curl + browser + psql): webhook signature gate, inbound 850 → resolve → review/auto-release, dedup, price-tolerance hold, 997 accepted→Acknowledged / rejected→Failed, and the Release action creating a sales order with document prices + buyer PO. UI (queue, drawer, customer EDI tab, Orderful integration card) renders. i18n filled for all 13 locales.
- 2026-08-04 (planning sync): Implementation plan written (`.ai/plans/2026-08-04-edi-support.md`). Two refinements folded back: (1) inbound processing runs inline in the webhook route via the sales service — jobs cannot import ERP module code where `insertSalesOrder`/`resolvePrice` live; provider webhook redelivery supplies retries; (2) the 855 trigger checks "status left Draft/Needs Approval + no existing ack document" in the handler instead of filtering on `status = 'Confirmed'`, because the confirm route sets status via `getSalesOrderStatus` and may skip the literal value. Also tightened `ediDocument` SELECT RLS to the `sales_view` variant to match the acceptance criteria.
- 2026-08-04: Created (autonomous mode — non-interactive session). Research completed the same day (`.ai/research/edi-support.md`, 6-agent survey: standards, SAP, NetSuite/Epicor/Plex, API-first providers, manufacturing workflows, Carbon codebase map). All 11 open questions resolved autonomously per the spec-writing skill's autonomous protocol; the provider-selection and retail-ASN-timing decisions are flagged ⚠️ for Brad's explicit confirmation before implementation.
