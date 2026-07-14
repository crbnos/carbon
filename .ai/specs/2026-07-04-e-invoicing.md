# E-Invoicing — EN 16931 Semantic Model, Format Renderers, Clearance State Machine

> Status: in-progress
> Author: Claude (readiness finding GAP-D2)
> Date: 2026-07-04
> Tracking issue: crbnos/carbon#1054
> Related: `.ai/specs/2026-07-04-avalara-integration-foundation.md` (#1061 — credentials/client), `.ai/specs/2026-07-04-gapless-numbering-legal-series.md` (#1038 — legal series), `.ai/specs/2026-07-03-multi-jurisdiction-tax.md` (registrations, tax summary, `invoiceMessage`), `.ai/specs/2026-07-03-public-company-readiness.md` (GAP-D2, SD-2)

## TLDR

Carbon has zero e-invoicing code while mandates land on its actual customer base (EU + US footprint): **France's B2B issue mandate hits September 2026 (~2 months out)**, **Poland's KSeF is already mandatory in 2026**, **Germany has required inbound structured-invoice receipt since 2025** (issue mandate 2027–28), **Italy's SDI has been mandatory for years**, and ViDA makes structured intra-EU invoicing universal by 2030. This spec builds the **adapter framework, not fifty adapters** (SAP DRC pattern): a single **EN 16931 semantic invoice model** mapped from Carbon sales invoices and credit memos (using the tax spec's registrations, tax summary components, and VAT clauses) and validated against the BR-\* business rules before anything leaves the building; **pure-function format renderers** (Peppol BIS 3.0 UBL as the baseline, Factur-X for France, XRechnung for Germany, FatturaPA for Italy, FA(3) for Poland's KSeF); a per-document **clearance state machine** (`Pending → Submitted → Accepted/Rejected → Corrected`) with retries, surfaced rejection reasons, and rectification-document flows — an issued invoice is never edited; **transmission through Avalara's e-invoicing API** behind one internal `ClearanceAdapter` interface with country routing; **inbound** structured supplier invoices landing as draft purchase invoices with supplier/line matching; and **legal-series + issuance gating** so an invoice for a clearance-model country is not "issued" (numbered-final, deliverable) until the platform accepts it. Rollout is France first, then Poland/Italy, then Germany outbound.

## Problem Statement

1. **No structured output.** `packages/documents/src/pdf/SalesInvoicePDF.tsx` renders a human-readable PDF only. No UBL, no CII, no country XML. A German customer of a Carbon user can already lawfully refuse a paper/PDF-image invoice; from Sept 2026 a French Carbon user cannot legally *issue* one to a French B2B buyer at all.
2. **No clearance concept.** In Poland (KSeF) and Italy (SDI) the government platform is in the legal path: the invoice does not exist as a legal document until the platform accepts it and (KSeF) assigns its number. Carbon's `salesInvoiceStatus` flow (`Draft → Pending → Submitted → Paid…`) has no notion of "posted in GL but not yet legally issued," no rejection handling, and no rectification chain.
3. **No inbound.** Germany's receive mandate (since 2025) and Peppol generally mean suppliers will send XML, not PDFs. Carbon's only structured intake is AI PDF extraction (`documentExtraction`, migration `20260609001724`) — probabilistic, where XML is exact.
4. **Prerequisites now exist on this branch.** The tax spec provides per-component tax breakdowns, `taxRegistration` (seller VAT IDs), `customerTax.vatNumber`, reporting categories (mapping to EN 16931 VAT category codes S/Z/E/AE/K/G/O), and `invoiceMessage` clauses. The gapless-numbering spec (#1038) provides `legalSeries` per entity + country + doc type. E-invoicing is the consumer both were built for.

## Proposed Solution

### 1. EN 16931 semantic invoice model (`packages/ee/src/e-invoicing/semantic/`)

One TypeScript type, `SemanticInvoice`, structured after EN 16931's business terms (BT-1…BT-165, groups BG-1…BG-32): document header (BT-1 number, BT-2 issue date, BT-3 type code 380/381, BT-5 currency), seller (name, address, **BT-31 VAT identifier from `taxRegistration`** matched to the invoice country, electronic address/Peppol participant ID), buyer (from `customer` + `customerTax.vatNumber`), payment terms/means, allowances/charges, line group (BG-25: quantity, unit code UN/ECE Rec 20 mapped from `unitOfMeasure`, net price, item identifiers), and **VAT breakdown (BG-23) built directly from the tax spec's per-component summary** with category codes derived from `taxCode.reportingCategory` (`Standard→S`, `Zero-Rated→Z`, `Exempt→E`, `Reverse Charge→AE`, `Export→G/K`, `Out of Scope→O`) and exemption reason text from `invoiceMessage`.

- **Builder**: `buildSemanticInvoice(client, companyId, { documentType, documentId })` in `eInvoicing.service.ts` — reads `salesInvoice(+Lines)`, `taxLedger` rows (posted; drafts compute live via `resolveLineTaxes`), registrations, payment terms. Credit memos map to type code 381 with the preceding-invoice reference (BG-3) — the rectification substrate.
- **Validation**: `validateSemanticInvoice(model, countryCode)` runs (a) the core EN 16931 BR rules we implement as pure predicates (the arithmetic set BR-CO-\*, the mandatory-field set BR-1…BR-65, VAT-category rules BR-S/Z/E/AE/G/O-\*), then (b) a per-country CIUS delta (XRechnung's mandatory `BT-10 buyerReference`/Leitweg-ID, FatturaPA's codice destinatario, KSeF FA(3) structural constraints). Returns structured `{ rule, severity, message, path }[]` so the UI can point at the exact missing field **before** a round-trip to Avalara. Avalara re-validates; ours exists for actionable pre-flight errors.

**Field mapping reference (core subset — the full table lives beside the builder as its test fixture):**

| EN 16931 term | Carbon source |
|---|---|
| BT-1 Invoice number | `legalSeries` number (#1038); falls back to `salesInvoice.invoiceId` for non-mandate countries |
| BT-2 / BT-9 Issue / due date | `salesInvoice.dateIssued` (stamped at issuance, §5) / `dateDue` from payment terms |
| BT-3 Type code | 380 invoice; 381 credit memo; BG-3 preceding reference from the memo's originating invoice |
| BT-5 Currency | `salesInvoice.currencyCode`; BT-6 (VAT accounting currency) = company base currency when they differ |
| BG-4 Seller | `company` + active `taxRegistration` for the invoice country (BT-31); Peppol participant ID from `eInvoiceCountrySetting` |
| BG-7 Buyer | `customer` + invoice-to address + `customerTax.vatNumber` (BT-48) |
| BT-10 Buyer reference | `salesInvoice.customerReference` (Leitweg-ID for DE B2G) |
| BG-13 Delivery | shipment ship-to address + ship date where linked |
| BG-16 Payment instructions | payment terms + (bank-rec spec) company bank IBAN/BIC when configured |
| BG-25 Lines | `salesInvoiceLine`: quantity, `unitOfMeasure` → UN/ECE Rec 20 code map, unit price net, item id/description |
| BG-23 VAT breakdown | tax spec per-component summary; category from `taxCode.reportingCategory`, exemption text from `invoiceMessage` |
| BT-106…115 Totals | invoice totals recomputed from lines and cross-checked (BR-CO-10…15) — a mismatch is a build error, never silently forwarded |

### 2. Format renderers (`packages/ee/src/e-invoicing/formats/`)

Pure functions `render(model: SemanticInvoice) → { xml: string, mimeType, filename }`:

| Format | Country/use | Syntax | Notes |
|---|---|---|---|
| `peppol-bis-3` | Network baseline, NL/BE/Nordics, ViDA bet | UBL 2.1 | The house canonical serialization; every other renderer is a sibling, and archived alongside country formats |
| `factur-x` | France | CII XML (+ hybrid PDF/A-3) | France's PDP syntaxes are UBL, CII, Factur-X. v1 transmits **CII XML**; hybrid PDF/A-3 assembly (embed XML into `SalesInvoicePDF` output via `pdf-lib`) is a fast-follow because react-pdf does not emit PDF/A (see Risks) |
| `xrechnung` | Germany | UBL 2.1 + XRechnung CIUS | Leitweg-ID in BT-10 for B2G; plain EN 16931 core for B2B |
| `fatturapa` | Italy | FatturaPA 1.2.x | Not EN 16931-syntax; rendered via a dedicated mapping from the same semantic model (richer party/regime fields from registrations) |
| `ksef-fa3` | Poland | FA(3) XSD | KSeF's schema; KSeF number returned on acceptance is stored as `clearanceId` and printed on the PDF |

Renderers are dependency-light string/XML builders with golden-file tests (sample semantic model → expected XML, validated against the official XSDs in CI). Carbon owns rendering (archival fidelity, partner independence); Avalara owns transmission.

### 3. Clearance/submission state machine

Every outbound legal document gets one `eInvoiceDocument` row snapshotting the semantic model at submission time (immutable after `Submitted` — status-transition-only trigger, per readiness DD-1):

```
Pending ──submit──▶ Submitted ──▶ Accepted
   ▲                    │
   │ (retryable         ├──▶ Rejected ──rectify──▶ Corrected (new document row,
   │  transport error:   │                          supersedesId chain)
   │  stays Pending,     └──▶ Cancelled (voided before clearance)
   │  attempts logged)
```

- **Submission** is an Inngest job (`e-invoice-submit`, event `carbon/e-invoice.submit`) fired on invoice posting for countries with an active `eInvoiceCountrySetting`: build → validate → render → `adapter.submit()` → record transmission attempt. Transport failures (5xx, timeout) retry with Inngest backoff, document stays `Pending`; **business rejections** (schema/BR/platform refusal) move to `Rejected` with `rejectionReasons` surfaced verbatim in the UI.
- **Status updates** arrive via the Avalara webhook (route `api+/webhook.avalara-einvoicing.ts` → Inngest `e-invoice-status`) plus a reconciliation poll job for silent documents older than a threshold.
- **Rectification, never edit**: a `Rejected` pre-clearance document may be fixed and resubmitted (new `eInvoiceDocument` row, `supersedesId` → old row → `Corrected`) because no legal document exists yet. Post-acceptance corrections go through **documents**: credit memo (type 381, references BT-25 preceding invoice) + optionally a new invoice — Poland's *faktura korygująca* and France's *avoir* map to exactly this. The sales invoice itself is never mutated after issuance (aligns with posted-record immutability, SD-1/MW-1).
- **Adapter interface** (`packages/ee/src/e-invoicing/adapters/types.ts`):

```ts
interface ClearanceAdapter {
  readonly id: "avalara" | "internal-archive"; // future: sovos, direct-ksef…
  supports(countryCode: string, direction: "outbound" | "inbound"): boolean;
  submit(doc: RenderedEInvoice): Promise<{ transportId: string } | ClearanceRejection>;
  getStatus(transportId: string): Promise<ClearanceStatus>;
  parseInbound(payload: unknown): Promise<SemanticInvoice>;
}
```

`AvalaraEInvoicingAdapter` (Avalara E-Invoicing & Live Reporting API) is the first-class implementation — credentials, client, retry/rate-limit plumbing, and the `companyIntegration` row come from the Avalara foundation spec (#1061); this spec only consumes `getAvalaraClient(companyId)`. Country routing: `resolveAdapter(companyId, countryCode)` reads `eInvoiceCountrySetting.adapter` (default `avalara`). `internal-archive` is the no-mandate path (e.g. US customers): render + archive Peppol BIS, no transmission.

**Per-country lifecycle nuances** (encoded as adapter/setting data, not code branches):

| Country | Model | Issuance gate | Correction vehicle | Notes |
|---|---|---|---|---|
| France | Centralized exchange via PDP | No (post-audit lifecycle statuses) | Avoir (381) | Lifecycle statuses (deposited/rejected/refused by buyer) flow back through the PDP; buyer *refusal* maps to `Rejected` post-acceptance → corrective flow |
| Poland | Clearance (KSeF) | **Yes** | Faktura korygująca (381 referencing KSeF number) | KSeF number is the legal identifier; printed on PDF; platform-offline mode deferred to Phase 2 detail |
| Italy | Clearance (SDI) | **Yes** | Nota di credito (TD04) | SDI *scarto* (discard) within 5 days maps to `Rejected`; esito/acceptance maps to `Accepted` |
| Germany | Post-audit | No | Storno/credit (381) | Receive mandate live since 2025 (inbound priority); outbound XRechnung/EN 16931 core |
| Peppol network | Transport ack only | No | 381 | MLR/transport acks map to `Accepted` at network level |

### 4. Inbound — structured supplier invoices → draft purchase invoices

Avalara receives on Carbon's behalf (Peppol access point registration, KSeF inbound pull, SDI codice destinatario) and webhooks the payload. Inngest `e-invoice-inbound`:

1. `adapter.parseInbound()` → `SemanticInvoice`; store the original XML in Supabase Storage (legal original, GoBD/retention — GAP-D3).
2. Create `eInvoiceDocument` (direction `Inbound`, status `Accepted` — clearance already happened upstream).
3. **Supplier match** by VAT number against `supplierTax.vatNumber`/supplier registrations; no match → document parks in the inbound inbox for manual assignment (never auto-create suppliers).
4. Create a **draft `purchaseInvoice`** with header fields exact-from-XML and **line mapping**: match `supplierPart` numbers → item lines; unmatched lines land as G/L-only lines flagged for review. Totals from XML are authoritative; a mismatch between mapped lines and XML totals blocks release, not creation.
5. Review happens in the existing purchase-invoice draft UI (same surface the `documentExtraction` flow feeds — XML intake is a second, exact-precision source into the same funnel).

### 5. Legal series linkage and issuance gating

- `eInvoiceDocument` records `legalSeriesId` + `legalNumber` assigned by the gapless-numbering spec's series (per entity + country + doc type, #1038). For **KSeF**, the platform's own number is additionally stored in `clearanceId` and printed on the human PDF.
- **Issuance rule**: `eInvoiceCountrySetting.clearanceGatesIssuance` (true for PL/IT; false for FR post-audit-via-PDP and DE). When true, posting still writes GL + `taxLedger` (accounting recognition is Carbon's), but the invoice is held in a new `salesInvoice.issuedAt IS NULL` state: customer-facing delivery (email/PDF download by customer, portal) is blocked and the UI shows "Awaiting clearance." `Accepted` stamps `issuedAt` and releases delivery. When false, `issuedAt` stamps at posting and clearance runs in parallel.

### 6. Rollout phasing

| Phase | Market(s) | Why now | Ships |
|---|---|---|---|
| **1** | **France** (+ `internal-archive` everywhere) | Issue mandate **Sept 2026 — ~2 months**; largest EU exposure window | Semantic model + BR validation, Peppol BIS + Factur-X(CII) renderers, state machine, Avalara PDP submission, country settings, monitor UI, issuance non-gating |
| **2** | **Poland, Italy** | KSeF **already mandatory in 2026** (any PL entity is non-compliant today); SDI long-mandatory (blocks any IT customer) | FA(3) + FatturaPA renderers, clearance-gated issuance, KSeF-number stamping, rectification flows |
| **3** | **Germany + inbound everywhere** | DE receive mandate in force since 2025 (inbound is the urgent half); DE issue mandate 2027–28 | Inbound pipeline (§4), XRechnung outbound, Peppol network send for NL/BE/Nordics |
| 4 | Per demand | ViDA 2030 runway; clearance-model non-EU (MX CFDI, BR NF-e, IN IRP) via the same adapter seam | New renderers/adapters only — no framework changes |

### Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Build vs. buy split | Carbon owns semantic model + rendering + state machine; **Avalara owns transmission/clearance connectivity** (PDP, KSeF, SDI, Peppol AP) | RESOLVED (Brad): Avalara is the first-class partner. Becoming a registered PDP/Peppol AP/SDI intermediary ourselves is a multi-year certification program (CO-1 notes PDP registration as a *later* company milestone); owning the model + renderers keeps partner independence and archival fidelity |
| 2 | One semantic model, many renderers | EN 16931 business terms as the internal type; FatturaPA/FA(3) render from it too | SAP DRC / research consensus #8: adapter framework, not fifty adapters; ViDA converges on EN 16931 anyway |
| 3 | Clearance vs. accounting | GL/`taxLedger` post at posting; **legal issuance** is a separate gate (`issuedAt`) controlled per country | Accounting recognition and legal document existence are different facts; blocking posting on a government API would couple close to platform uptime |
| 4 | Corrections | Rectification documents only (credit memo 381 + reissue), `supersedesId` chain; pre-clearance rejections may resubmit | Legal requirement in every mandate country; matches posted-record immutability (SD-1) |
| 5 | Multi-tenancy (heuristic 1) | All new tables: `companyId`, composite PK `("id","companyId")`, `id()` defaults, audit columns | House convention |
| 6 | Service shape (heuristic 2) | `eInvoicing.service.ts` + `eInvoicing.models.ts` in `apps/erp/app/modules/invoicing/`; `(client, companyId, …) → {data, error}` | Invoicing-owned (sales + purchase invoices live there); one service file per module rule |
| 7 | RLS (heuristic 3) | Four standard policies; SELECT via `get_companies_with_employee_role()`, writes via `get_companies_with_employee_permission('invoicing_*')`; state transitions via service role from Inngest jobs, guarded by transition trigger | Matches `taxLedger` posture: user-facing reads, job-driven writes |
| 8 | Permission scoping (heuristic 4) | Country settings: `settings` + `invoicing_update`; monitor + resubmit: `invoicing_update`; inbound inbox: `invoicing_create` | Compliance config is settings-tier; day-to-day clearance ops are AR/AP clerks |
| 9 | Form pattern (heuristic 5) | `ValidatedForm` + zod (`eInvoiceCountrySettingValidator`); monitor uses the standard table pattern; rejection detail in a Drawer | House convention |
| 10 | Module layout (heuristic 6) | Framework code in `packages/ee/src/e-invoicing/` (`semantic/`, `formats/`, `adapters/`, `inbound/`); ERP glue in `modules/invoicing`; jobs in `@carbon/jobs` | ee is the integrations home (Xero precedent); no new package (ask-first rule) |
| 11 | Backward compatibility (heuristic 7) | No `eInvoiceCountrySetting` rows → zero behavior change (no jobs fire, `issuedAt` backfilled = `postingDate` for existing invoices, delivery never blocked); all new columns nullable | US-only companies and existing invoices are untouched |
| 12 | Pre-flight BR validation | Implement core BR-\* + country CIUS subset in-house even though Avalara validates | Rejection round-trips through a clearance platform are slow and opaque; field-level pre-flight errors at invoice edit time are the UX difference |
| 13 | Inbound record creation | Draft purchase invoice immediately, park only on supplier-match failure | XML is exact — unlike `documentExtraction` there is no confidence threshold; the draft UI is the review gate |

## Data Model Changes

```sql
CREATE TYPE "eInvoiceDirection" AS ENUM ('Outbound', 'Inbound');
CREATE TYPE "eInvoiceFormat" AS ENUM ('Peppol-BIS-3', 'Factur-X', 'XRechnung', 'FatturaPA', 'KSeF-FA3');
CREATE TYPE "eInvoiceStatus" AS ENUM ('Pending', 'Submitted', 'Accepted', 'Rejected', 'Corrected', 'Cancelled');
CREATE TYPE "eInvoiceDocumentType" AS ENUM ('Sales Invoice', 'Credit Memo', 'Purchase Invoice');

-- Per-company, per-country mandate configuration
CREATE TABLE "eInvoiceCountrySetting" (
    "id" TEXT NOT NULL DEFAULT id('eics'),
    "companyId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,                 -- ISO 3166-1 alpha-2
    "outboundEnabled" BOOLEAN NOT NULL DEFAULT false,
    "inboundEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultFormat" "eInvoiceFormat" NOT NULL,
    "adapter" TEXT NOT NULL DEFAULT 'avalara',   -- 'avalara' | 'internal-archive'
    "clearanceGatesIssuance" BOOLEAN NOT NULL DEFAULT false,  -- true: PL, IT
    "avalaraMandateId" TEXT,                     -- Avalara mandate identifier for routing
    "legalSeriesId" TEXT,                        -- default series (gapless-numbering spec #1038)
    "customFields" JSONB,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "eInvoiceCountrySetting_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "eInvoiceCountrySetting_companyId_fkey" FOREIGN KEY ("companyId")
        REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "eInvoiceCountrySetting_unique" UNIQUE ("companyId", "countryCode")
);

-- One row per legal document instance in the clearance lifecycle
CREATE TABLE "eInvoiceDocument" (
    "id" TEXT NOT NULL DEFAULT id('einv'),
    "companyId" TEXT NOT NULL,
    "direction" "eInvoiceDirection" NOT NULL,
    "documentType" "eInvoiceDocumentType" NOT NULL,
    "sourceDocumentId" TEXT,                     -- salesInvoice/memo id (outbound); purchaseInvoice id once created (inbound)
    "countryCode" TEXT NOT NULL,
    "format" "eInvoiceFormat" NOT NULL,
    "status" "eInvoiceStatus" NOT NULL DEFAULT 'Pending',
    "semanticModel" JSONB NOT NULL,              -- EN 16931 snapshot; immutable after Submitted
    "validationErrors" JSONB,                    -- pre-flight BR-*/CIUS failures
    "renderedPath" TEXT,                         -- Supabase Storage path of XML (+ hybrid PDF)
    "originalPath" TEXT,                         -- inbound: received XML original (retention)
    "legalSeriesId" TEXT,
    "legalNumber" TEXT,                          -- from gapless legal series (#1038)
    "clearanceId" TEXT,                          -- KSeF number / SDI id / PDP lifecycle id / Peppol message id
    "clearanceMetadata" JSONB,
    "rejectionReasons" JSONB,                    -- [{ code, message, field? }] surfaced verbatim
    "supersedesId" TEXT,                         -- correction chain (self-FK)
    "submittedAt" TIMESTAMP WITH TIME ZONE,
    "clearedAt" TIMESTAMP WITH TIME ZONE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "eInvoiceDocument_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "eInvoiceDocument_companyId_fkey" FOREIGN KEY ("companyId")
        REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "eInvoiceDocument_supersedes_fkey" FOREIGN KEY ("supersedesId", "companyId")
        REFERENCES "eInvoiceDocument"("id", "companyId")
);
CREATE INDEX "eInvoiceDocument_source_idx" ON "eInvoiceDocument" ("companyId", "sourceDocumentId");
CREATE INDEX "eInvoiceDocument_status_idx" ON "eInvoiceDocument" ("companyId", "status");

-- Transport attempt log (retry forensics; append-only)
CREATE TABLE "eInvoiceTransmission" (
    "id" TEXT NOT NULL DEFAULT id('eitx'),
    "companyId" TEXT NOT NULL,
    "eInvoiceDocumentId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "adapter" TEXT NOT NULL,
    "transportId" TEXT,                          -- Avalara submission id
    "httpStatus" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT "eInvoiceTransmission_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "eInvoiceTransmission_doc_fkey" FOREIGN KEY ("eInvoiceDocumentId", "companyId")
        REFERENCES "eInvoiceDocument"("id", "companyId") ON DELETE CASCADE
);

-- Issuance gate on the invoice itself. Distinct from the existing user-editable
-- "dateIssued" DATE (the business document date, BT-2): "issuedAt" is the
-- system-stamped legal-issuance instant, set by posting (non-gated countries)
-- or by clearance acceptance (gated countries). Never user-editable.
ALTER TABLE "salesInvoice" ADD COLUMN "issuedAt" TIMESTAMP WITH TIME ZONE;
-- Backfill: existing posted invoices are considered issued at posting
UPDATE "salesInvoice" SET "issuedAt" = "postingDate" WHERE "postingDate" IS NOT NULL;

-- RLS (all three tables): standard four policies
ALTER TABLE "eInvoiceDocument" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eInvoiceDocument_SELECT" ON "eInvoiceDocument" FOR SELECT USING (
    "companyId" = ANY (
        SELECT unnest(get_companies_with_employee_role())
    )
);
-- INSERT/UPDATE via get_companies_with_employee_permission('invoicing_update');
-- status transitions additionally guarded by a SECURITY DEFINER trigger:
-- semanticModel/renderedPath/legalNumber are frozen once status != 'Pending';
-- only forward transitions allowed (Pending→Submitted→Accepted|Rejected→Corrected; Pending→Cancelled).
```

## API / Service Changes

- **`packages/ee/src/e-invoicing/`** — `semantic/` (types + `mapSalesInvoice`, `mapCreditMemo`, `validate` with BR/CIUS rule tables), `formats/` (five renderers + XSD golden tests), `adapters/` (`types.ts`, `avalara.ts` consuming #1061's client, `internal-archive.ts`), `inbound/` (parser → `SemanticInvoice`, supplier/line matcher).
- **`modules/invoicing/eInvoicing.service.ts`** — `getEInvoiceCountrySettings`, `upsertEInvoiceCountrySetting`, `getEInvoiceDocuments` (monitor list), `getEInvoiceDocument`, `buildSemanticInvoice`, `submitEInvoice` (creates row + fires event), `resubmitEInvoice` (rejected-only; creates superseding row), `createPurchaseInvoiceFromInbound`.
- **Inngest** (`@carbon/jobs`): `e-invoice-submit` (build→validate→render→submit; Inngest retries on transport failure), `e-invoice-status` (webhook-driven transitions; stamps `issuedAt` on Accepted where gated; fires notification on Rejected), `e-invoice-reconcile` (hourly poll for stale `Submitted`), `e-invoice-inbound`. Rejections and inbound arrivals notify via `@carbon/notifications` to invoicing users (same channel pattern as existing document notifications).
- **Routes**: `api+/webhook.avalara-einvoicing.ts` (signature-verified, per #1061); `x+/settings+/e-invoicing.tsx` (country settings); `x+/invoicing+/e-invoice-monitor*` (list + drawer); inbound inbox under `x+/invoicing+/`.
- **Posting hook**: `post-sales-invoice` (edge function) gains a post-commit step — if an `eInvoiceCountrySetting` matches the invoice's tax country and `outboundEnabled`, fire `carbon/e-invoice.submit`; if `clearanceGatesIssuance`, leave `issuedAt` NULL, else stamp it. No setting → stamp `issuedAt`, done (today's behavior).
- **Delivery gate**: invoice email/customer-PDF actions check `issuedAt IS NOT NULL` when a gating setting exists for the country.

## UI Changes

- **Country settings page** (settings → E-Invoicing): per-country cards with mandate model, format, adapter, series link, enable toggles; warns when a `taxRegistration` exists for a mandate country with no setting (mirrors the tax spec's cross-warning pattern).
- **Sales invoice detail**: clearance status badge (Pending/Submitted/Accepted/Rejected + KSeF/SDI number), "Awaiting clearance" delivery lock state, rejection panel with field-level reasons and a "Fix & resubmit" action (pre-clearance) or "Create corrective credit memo" (post-clearance).
- **E-invoice monitor** (SAP DRC monitor pattern): filterable table of `eInvoiceDocument` across statuses/countries, bulk retry for transport failures, correction-chain drilldown.
- **Inbound inbox**: received documents pending supplier match; matched ones deep-link to their draft purchase invoice.
- **Pre-flight validation**: posting a mandate-country invoice with BR/CIUS failures shows the structured error list (block or warn per `clearanceGatesIssuance`).

## Acceptance Criteria

All Avalara interactions run against a **mock Avalara e-invoicing endpoint** (test harness from #1061) supporting scripted accept/reject/timeout per submission.

- [ ] Posting a sales invoice for a FR-registered customer with FR `eInvoiceCountrySetting` builds a `SemanticInvoice` whose BG-23 VAT breakdown matches the invoice's `taxLedger` component rows exactly (bases, rates, category codes) and whose BT-31 equals the company's FR `taxRegistration` number.
- [ ] The Factur-X (CII) and Peppol BIS 3.0 renderers produce XML that validates against the official XSDs in CI (golden-file tests, `pnpm --filter @carbon/ee test`).
- [ ] An invoice missing the buyer VAT number under a Reverse-Charge code fails pre-flight with rule id BR-AE-\* and a field path — no submission attempt is made, no `eInvoiceTransmission` row exists.
- [ ] Mock accept: document goes `Pending → Submitted → Accepted`, `clearanceId` stored, `issuedAt` stamped (gated country) and delivery unblocks; mock 503 twice then accept: three `eInvoiceTransmission` rows, final status `Accepted`, document never entered `Rejected`.
- [ ] Mock business rejection: status `Rejected`, reasons rendered in the invoice drawer; resubmit creates a new `eInvoiceDocument` with `supersedesId` set and the old row `Corrected`; the sales invoice row itself is byte-identical throughout (immutability trigger test).
- [ ] For a PL-gated invoice, GL and `taxLedger` post at posting time while customer email/PDF delivery returns a blocked state until Accepted; a non-mandate US invoice posts and delivers exactly as before this spec (regression test with zero settings rows).
- [ ] Attempting to UPDATE `semanticModel` or `legalNumber` on a `Submitted` document raises the trigger exception, including via service role.
- [ ] Inbound: posting a sample Peppol BIS invoice to the mock webhook creates an `Inbound` `eInvoiceDocument` with the original XML archived, matches the supplier by VAT number, and produces a draft `purchaseInvoice` whose line for a known `supplierPart` maps to the right item and whose totals equal the XML totals; an unknown-supplier document parks in the inbox and creates nothing.
- [ ] Credit memo for a cleared invoice renders type code 381 with the preceding invoice reference (BG-3) and follows the same clearance lifecycle.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| France deadline (~2 months) vs. build time | High | Phase 1 is deliberately thin: CII (no PDF/A-3 hybrid), Avalara does the PDP legwork; mandate applies to French *sellers* — confirm actual FR-entity customer count to calibrate (see OQ) |
| react-pdf cannot emit PDF/A-3 → no native Factur-X hybrid | Med | Transmit pure CII/UBL (legally sufficient via PDP); hybrid via `pdf-lib` embedding + veraPDF conformance check as fast-follow |
| Avalara mandate coverage gaps or contract scope (PDP, KSeF, SDI, Peppol AP) | High | Adapter seam keeps a direct-API or second-vendor escape hatch; verify per-mandate coverage before each market GA (OQ below) |
| BR-\*/CIUS rule set drifts with annual releases (XRechnung 3.x, FA(3)→FA(4)) | Med | Rules as versioned data tables + golden tests; Avalara remains authoritative backstop validator |
| Clearance outage blocks issuance in gated countries | Med | Posting/GL never blocks; monitor surfaces stuck documents; KSeF offline-mode handling per platform rules deferred to Phase 2 detail |
| Inbound line-matching quality on messy supplier catalogs | Low | Totals-authoritative design; unmatched lines are reviewable G/L lines, never silent drops |

## Open Questions

> HARD STOP: Do not proceed with implementation until unchecked items are answered.

- [x] Middleware partner vs. direct government APIs? — **Resolved (Brad): Avalara is the first-class clearance partner**; direct APIs stay possible behind `ClearanceAdapter`. Credentials/client per `.ai/specs/2026-07-04-avalara-integration-foundation.md` (#1061).
- [x] Customer footprint? — **Resolved (Brad): customers are all over Europe and the US** → France-first phasing by mandate date; `internal-archive` (render-only) for US companies from Phase 1.
- [x] Where do legal numbering series come from? — **Resolved**: the gapless-numbering spec (#1038) owns `legalSeries`; this spec only links and prints.
- [x] Commercial: does the Avalara contract (E-Invoicing & Live Reporting) cover FR PDP, PL KSeF, IT SDI transmission **and** inbound receipt (Peppol AP registration, SDI codice destinatario) for our customers' entities? Blocks GA per market, not the build. — **Answer (Brad, 2026-07-04, ambition heuristic — be ambitious and thorough; back out at /plan stage if needed):** Assume full coverage (FR PDP, PL KSeF, IT SDI transmission + inbound Peppol AP / SDI receipt) and build against Avalara's unified API. Verify the contract during planning; an uncovered market backs out that market's GA — the build is unaffected.
- [x] Do any current customers have a **French or Polish legal entity issuing B2B invoices** (vs. selling into FR/PL from elsewhere — which the mandates do not cover)? Determines whether Phase 1 is a hard September deadline or a strong-default roadmap. — **Answer (Brad, 2026-07-04, ambition heuristic — be ambitious and thorough; back out at /plan stage if needed):** Assume yes — treat France Sept 2026 as a hard deadline. Confirm at plan stage; if no FR/PL issuing entity exists, France slips to demand-driven with zero design change.
- [x] Italy: FatturaPA requires seller regime fiscale + full codice destinatario/PEC routing data we don't capture on `customer` today — confirm adding these as customer/registration fields (small schema add, Phase 2) rather than a generic `customFields` escape hatch. — **Answer (Brad, 2026-07-04, ambition heuristic — be ambitious and thorough; back out at /plan stage if needed):** Yes — real columns on customer/tax-registration in Phase 2, never customFields.

## Changelog

- 2026-07-04: Created. Scope per GAP-D2 with resolutions baked in (Avalara first-class, EU+US footprint, France-first phasing).
- 2026-07-04: Remaining open questions resolved under the program ambition heuristic (ambitious scope now; back-out valves at plan stage).
