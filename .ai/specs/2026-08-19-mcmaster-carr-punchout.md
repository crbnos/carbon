# McMaster-Carr Punchout Integration (cXML)

> Status: in-progress — approved by Brad 2026-08-20 ("yes, looks good"); onboarding question C is a live-testing gate only
> Author: Claude (autonomous session)
> Date: 2026-08-19
> Research: `.ai/research/mcmaster-punchout.md`
> Sample documents (from McMaster's eProcurement team): POSR, POOM, PO (OrderRequest), Order Confirmation, ASN, Invoice, Credit Memo — attached in the originating conversation; canonical copies should land in `packages/ee/src/punchout/__fixtures__/` during implementation.

## TLDR

Add a McMaster-Carr integration built on cXML Level 1 punchout plus cXML documents.
A buyer clicks "Shop McMaster-Carr" in Purchasing, shops on mcmaster.com in a new
window with account pricing, and checks out; the cart returns as a **draft purchase
order** (Carbon's requisition equivalent) with lines resolved against `supplierPart`
cross-references. Finalizing the PO transmits a cXML `OrderRequest` to McMaster
server-to-server. McMaster then POSTs order confirmations (promised dates), ship
notices (tracking numbers), and invoices/credit memos back to a Carbon webhook; these
are staged in a reviewable document queue that updates the PO and creates draft
purchase invoices. The cXML core is supplier-neutral (`packages/ee/src/punchout/`)
so a second punchout supplier (Grainger, Fastenal, Digi-Key) later is config, not
code. No mid-market MES/ERP competitor (Fulcrum, ProShop, Genius, Odoo) has native
punchout — this is a differentiator.

## Problem Statement

Shops buy MRO hardware from McMaster-Carr constantly. Today that means shopping on
mcmaster.com, then re-keying every line into a Carbon PO (part number, description,
price, UOM), emailing a PDF PO or ordering outside the system entirely, and later
re-keying the invoice. McMaster's primary integration offering (per their
eProcurement team) is a Level 1 punchout catalog in cXML/OCI plus cXML
PO/confirmation/ASN/invoice documents. Carbon has no punchout support and no
buy-side electronic document exchange: `finalizePurchaseOrder` can only email a PDF
(`purchaseOrderFinalizeValidator` notification = `"Email" | "None"`), confirmations
are hand-typed into `promisedDate`/`supplierReference`, and supplier invoices arrive
as PDFs through AI extraction.

## Proposed Solution

### Architecture overview

```
packages/ee/src/punchout/            # supplier-neutral cXML core (browser-safe types + .server split)
├── types.ts                         # canonical payloads Carbon owns: PunchoutCart{Line}, CxmlIdentity,
│                                    #   ConfirmationPayload, ShipNoticePayload, CxmlInvoicePayload
├── cxml/build.server.ts             # buildPunchOutSetupRequest, buildOrderRequest, buildCxmlResponse
├── cxml/parse.server.ts             # parsePunchOutSetupResponse, parsePunchOutOrderMessage,
│                                    #   parseConfirmationRequest, parseShipNoticeRequest,
│                                    #   parseInvoiceDetailRequest (+ credit memo), money/date coercion
├── cxml/__fixtures__/               # McMaster's sample documents as test fixtures
└── mcmaster-carr/config.tsx         # defineIntegration definition (registered in packages/ee/src/index.ts)
```

Protocol flow (grounded in the cXML User's Guide + McMaster samples):

1. **Start session** (authenticated route action): create a `punchoutSession` row
   with a random `buyerCookie`, server-POST a `PunchOutSetupRequest
   operation="create"` (From/Sender NetworkID + SharedSecret, `BrowserFormPost` =
   our public return URL containing the session id) to the configured punchout URL,
   parse the `StartPage` URL out of the response, return it to the client, which
   opens it in a **new window** (never an iframe — X-Frame-Options + third-party
   cookie blocking).
2. **Cart return** (public route, cookie-less): McMaster's checkout browser-POSTs
   `cxml-urlencoded` (or `cxml-base64` — checked first per spec) to the return URL.
   Validate the session token + echoed `BuyerCookie`, store the canonical cart on
   the session (`Returned`), respond with a minimal HTML page that `postMessage`s
   the opener and closes itself. An **empty cart means the user cancelled** →
   session `Cancelled`. Duplicate posts to a consumed/returned session are ignored
   (idempotent).
3. **Consume cart** (authenticated, back in the ERP tab): the waiting UI sees the
   session flip to `Returned` (poll loader), then an action resolves lines and
   creates/updates the **draft PO** with the real user as `createdBy`, marks the
   session `Consumed`, and navigates to the PO.
4. **Send PO**: on finalize, a new "Send via cXML" notification option triggers an
   Inngest job that builds `OrderRequest` (each `ItemOut` echoes the line's
   `supplierPartId` + `supplierPartAuxiliaryId` **byte-for-byte**), POSTs to the
   configured order URL (test or production per `environment`), parses the
   synchronous cXML `Response`, and records an outbound `cxmlDocument` as
   `Sent`/`Failed`.
5. **Inbound documents**: McMaster POSTs ConfirmationRequest / ShipNoticeRequest /
   InvoiceDetailRequest to `api+/webhook.mcmaster-carr.$companyId`. The route
   verifies the `Sender` SharedSecret (timing-safe compare against the vaulted
   inbound secret), stages a `cxmlDocument`, applies safe updates automatically
   (confirmation dates, tracking numbers), holds invoices for review, and replies
   with a cXML `Response` (200 on success, non-2xx envelope on failure).

### Line resolution (cart → PO lines)

Follows the AI-extraction precedent (`apps/erp/app/routes/x+/purchase-invoice+/new.tsx`
+ `resolveItemIdFromExtractedText`), specialized for punchout:

1. Look up `supplierPart` by `(supplierId, supplierPartId = ItemIn/SupplierPartID)`.
   Match → item line (`itemId`, purchase UOM + `conversionFactor` from the
   cross-reference).
2. No match → **G/L Account line** against the integration's configured default
   expense account (`accountId`, resolved by id per the control-account lesson —
   never by number), with the cart description; `supplierPartId` still stored on
   the line so the OrderRequest and future cross-referencing work.
3. Every line stores: `supplierPartId` (existing line column — the supplier's part
   number string), new `supplierPartAuxiliaryId` (opaque, hidden from users),
   `supplierUnitPrice` from the cart (authoritative account pricing; internal
   scale, no rounding beyond `round()` defaults), quantity, and UOM mapped from
   UN/CEFACT codes (`EA`→`EA`, etc.) against the company's `unitOfMeasure` codes —
   unmapped codes fall back to `EA` and add an issue to the PO line's staged
   document so the buyer sees it.
4. Cart-level `Total`, tax, and shipping are **estimates** (per cXML spec) — they
   are not written to the tax pair or shipping columns; real amounts come from the
   invoice.

### Inbound document behavior

| Document | Automatic effect | Held for review |
|---|---|---|
| Order Confirmation | `purchaseOrder.supplierReference` ← McMaster order number (`OrderReference@orderID`); line `promisedDate` ← `ConfirmationStatus@deliveryDate`; `purchaseOrderDelivery.receiptPromisedDate` ← earliest delivery date | Nothing — recorded as `Posted` in the queue |
| Ship Notice | `purchaseOrderDelivery.trackingNumber` ← `ShipmentIdentifier` (last-wins; all shipments remain visible in the queue) | Receipt creation stays manual (existing `receiptFromPurchaseOrder` flow) |
| Invoice / Credit Memo | Nothing | Staged `Needs Review`; one-click **Create invoice** action builds a draft purchase invoice from the payload (lines matched by PO line number), which then flows through the normal review + `post-purchase-invoice` path. Never auto-posted. |

PO correlation: outbound `OrderRequest@orderID` carries the readable
`purchaseOrder.purchaseOrderId`; inbound documents reference it via
`OrderReference@orderID` (confirmations may instead carry McMaster's own order
number — fall back to `supplierReference` match, then flag an issue). Duplicate
inbound documents dedupe on `(integrationId, direction, documentType, payloadId)`.
Money values are parsed defensively — McMaster's own confirmation sample contains
`<Money currency="USD">$629.52</Money>`.

### Integration definition (`mcmaster-carr`)

Category "Purchasing"; closest template `packages/ee/src/paperless-parts/config.tsx`
(non-OAuth, secrets, setup instructions). Settings (all per-company; McMaster issues
everything privately during onboarding — nothing hardcoded except defaults):

| Setting | Type | Notes |
|---|---|---|
| `supplierId` | supplier picker | which Carbon supplier is McMaster-Carr |
| `environment` | options: Test / Production | selects order URL + `deploymentMode` |
| `punchoutUrl` | text | POSR endpoint from onboarding packet |
| `orderUrlTest` / `orderUrlProduction` | text | distinct PO-posting URLs (Procurify: "do not use the punchout URL as the PO URL") |
| `fromIdentity` / `fromDomain` | text | buyer identity, typically `NetworkID` |
| `toIdentity` / `toDomain` | text | defaults `006931349` / `DUNS` |
| `sharedSecret` | secret | outbound credential (POSR + OrderRequest) |
| `inboundSharedSecret` | secret | verifies McMaster→Carbon posts |
| `defaultExpenseAccountId` | account picker | G/L fallback for unmatched cart lines |

`SECRET_KEYS["mcmaster-carr"] = ["sharedSecret", "inboundSharedSecret"]` in
`packages/ee/src/integrations/secrets.ts` (Vault-encrypted per the current-main
pattern — NOT the EDI branch's plain-metadata read). `SetupInstructions` shows the
webhook URL + BrowserFormPost origin and tells the admin to email
eProcurement@mcmaster.com with their account number (~30-day onboarding).

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where the cart lands | New **draft PO**; append-to-existing when initiated from a draft PO of the mapped supplier | Every native implementation (Ariba, Coupa, D365, Workday, NetSuite) returns carts to a requisition, never a live order; Carbon's requisition equivalent is the Draft PO |
| Requisition module | Not built | Out of scope; Draft PO + existing approval flow (`Needs Approval`) already model it |
| Supplier-neutral vs McMaster-only | Neutral cXML core in `packages/ee/src/punchout/`, single `mcmaster-carr` integration registered in v1 | Second supplier becomes a config.tsx + seed row; protocol code is identical |
| Unmatched cart lines | G/L Account line + configured default account | D365/Coupa model (description lines, category-anchored); avoids polluting the item master; `supplierPart` match promotes lines to real items over time |
| Punchout prices | Written as-is to `supplierUnitPrice`, editable | Cart prices are account pricing (authoritative per industry practice), but Carbon stays source of truth for what's on the PO |
| Cart tax/shipping | Ignored (not written) | cXML spec: optional estimates; invoice carries real amounts |
| Outbound PO transport | Async Inngest job after finalize; failure never blocks finalize | Matches email-send pattern; `Failed` status visible in document queue with retry action |
| Invoice handling | Staged review queue → draft purchase invoice; never auto-post | EDI-branch `Needs Review` pattern; three-way-match risk too high for v1 auto-post |
| ASN handling | Tracking number + dates only; no auto receipt | Receipts drive inventory + GL; manual `receiptFromPurchaseOrder` keeps control |
| Edit/inspect re-punchout | Out of scope v1 (create-only); delete lines and re-shop | Oracle Fusion ships inspect-only, D365 create-only; McMaster likely supports edit but it's not needed for v1 |
| OCI format / Level 2 index | Out of scope v1 | cXML Level 1 is McMaster's primary form; Level 2 needs supplier index files |
| XML library | `fast-xml-parser` (direct dep of `@carbon/ee`) | Already in the lockfile transitively (v5.7.2); no DOM dependency; works in Node routes and jobs |
| Popup vs iframe | `window.open` new window | X-Frame-Options + Safari/Chrome third-party-cookie blocking break iframes (industry consensus) |
| Return-endpoint auth | Unauthenticated route, no cookies read/set; unguessable single-use session id in path + BuyerCookie echo check + expiry | Chrome SameSite killed cookie-based returns; matches existing public `webhook.*` / `share+/*` route precedent |
| Multi-tenancy (heuristic 1) | Both new tables: `companyId`, composite PK `("id","companyId")`, `id('pnch')`/`id('cxml')` defaults, audit columns | House convention |
| Service shape (heuristic 2) | All new functions in `purchasing.service.ts` / `purchasing.models.ts` (no new scattered files), `client` first, `{data, error}` | Module service/models rule |
| RLS (heuristic 3) | Simple-name policies (`"SELECT"` etc.) with `::text[]` casts, per current pattern | RLS conventions memory |
| Permissions (heuristic 4) | Session start/consume: `purchasing_create`; queue release/reject/resend: `purchasing_update`; integration config: `settings_update`; webhook + return routes: public → verified by secret/token, then service-role | Existing module scopes; no new permission family (lessons.md) |
| Forms (heuristic 5) | Integration form is generic (from `settings` array); queue actions are `ValidatedForm` + `validator()` | Framework gives it for free |
| Module layout (heuristic 6) | UI under `apps/erp/app/modules/purchasing/ui/Punchout/`; routes under `x+/purchasing+/` and `api+/` | ERP module layout |
| Backward compatibility (heuristic 7) | `purchaseOrderFinalizeValidator` notification enum gains `"cXML"`; additive, default unchanged | Existing callers unaffected |
| Date handling | cXML timestamps parsed via `@internationalized/date` (`parseAbsolute`), stored as ISO strings; no JS `Date` arithmetic | date-handling rule |

## Data Model Changes

One migration (idempotent guards on every DDL; randomized HHMMSS timestamp).

```sql
-- 1. Integration seed (FK target for companyIntegration)
INSERT INTO "integration" ("id", "jsonschema")
VALUES ('mcmaster-carr', '{}'::json)
ON CONFLICT ("id") DO NOTHING;

-- 2. Punchout session
CREATE TYPE "punchoutSessionStatus" AS ENUM ('Pending', 'Returned', 'Consumed', 'Cancelled', 'Expired');

CREATE TABLE "punchoutSession" (
    "id" TEXT NOT NULL DEFAULT id('pnch'),
    "companyId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,                 -- 'mcmaster-carr'
    "supplierId" TEXT NOT NULL,
    "buyerCookie" TEXT NOT NULL,                   -- random, unique; correlation only, never auth
    "status" "punchoutSessionStatus" NOT NULL DEFAULT 'Pending',
    "purchaseOrderId" TEXT,                        -- append target, then the created/updated PO
    "cart" JSONB,                                  -- canonical PunchoutCart from the POOM
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, -- now() + 2 hours
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "punchoutSession_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "punchoutSession_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "punchoutSession_supplierId_fkey" FOREIGN KEY ("supplierId", "companyId")
      REFERENCES "supplier"("id", "companyId")
);
CREATE UNIQUE INDEX "punchoutSession_buyerCookie_idx" ON "punchoutSession" ("buyerCookie");
CREATE INDEX "punchoutSession_companyId_idx" ON "punchoutSession" ("companyId");
-- RLS: standard simple-name policies scoped to purchasing_view/create/update.

-- 3. cXML document queue (mirrors the EDI branch's ediDocument, supplier-neutral)
CREATE TYPE "cxmlDocumentType" AS ENUM
  ('Purchase Order', 'Order Confirmation', 'Ship Notice', 'Invoice', 'Credit Memo');
CREATE TYPE "cxmlDocumentDirection" AS ENUM ('Inbound', 'Outbound');
CREATE TYPE "cxmlDocumentStatus" AS ENUM
  ('Received', 'Needs Review', 'Posted', 'Rejected',   -- inbound lifecycle
   'Pending', 'Sent', 'Failed');                       -- outbound lifecycle

CREATE TABLE "cxmlDocument" (
    "id" TEXT NOT NULL DEFAULT id('cxml'),
    "companyId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "direction" "cxmlDocumentDirection" NOT NULL,
    "documentType" "cxmlDocumentType" NOT NULL,
    "status" "cxmlDocumentStatus" NOT NULL,
    "payloadId" TEXT NOT NULL,                     -- cXML envelope payloadID (dedup)
    "externalId" TEXT,                             -- confirmID / shipmentID / invoiceID / supplier order no.
    "payload" JSONB NOT NULL,                      -- canonical parsed payload, immutable
    "issues" JSONB NOT NULL DEFAULT '[]',
    "purchaseOrderId" TEXT,                        -- correlated PO
    "sourceDocument" TEXT,                         -- e.g. 'Purchase Invoice' once released
    "sourceDocumentId" TEXT,
    "sourceDocumentReadableId" TEXT,
    "releasedBy" TEXT REFERENCES "user"("id"),
    "releasedAt" TIMESTAMP WITH TIME ZONE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),  -- 'system' for inbound
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "cxmlDocument_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "cxmlDocument_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "cxmlDocument_dedup_idx"
  ON "cxmlDocument" ("companyId", "integrationId", "direction", "documentType", "payloadId");
CREATE INDEX "cxmlDocument_companyId_status_idx" ON "cxmlDocument" ("companyId", "status");

-- 4. Opaque supplier cookie on PO lines (⚠ Ask-First: production-critical table; see Open Questions)
ALTER TABLE "purchaseOrderLine" ADD COLUMN IF NOT EXISTS "supplierPartAuxiliaryId" TEXT;
-- The purchaseOrderLines view must be dropped and recreated (fork from the NEWEST
-- definition per lessons.md; SELECT pl.* already flows the new column through).
```

`pnpm run generate:types` after the migration, before any typecheck.

## API / Service Changes

Service functions (all in `apps/erp/app/modules/purchasing/purchasing.service.ts`,
validators in `purchasing.models.ts`):

- `createPunchoutSession`, `getPunchoutSession`, `updatePunchoutSessionCart`,
  `expirePunchoutSession` — session lifecycle.
- `consumePunchoutCart` — line resolution + draft-PO create/append (wraps
  `insertPurchaseOrder`/line upserts; deletes the PO if line insert fails, per the
  EDI-branch release pattern).
- `getCxmlDocuments` / `getCxmlDocument` / `rejectCxmlDocument` /
  `releaseCxmlInvoice` (creates the draft purchase invoice via the invoicing
  service) — queue operations.
- `applyCxmlConfirmation` / `applyCxmlShipNotice` — the automatic PO updates.

Routes:

| Route | Auth | Purpose |
|---|---|---|
| `api+/integrations.punchout.start.ts` (action) | `purchasing_create` | Create session, POST POSR, return `{ startPageUrl, sessionId }` |
| `api+/punchout.$sessionId.return.ts` (action, `runtime: "nodejs"`) | Public; session token + BuyerCookie + expiry checks; no cookies | Receive the POOM browser form-post; store cart; HTML response that `postMessage`s + closes |
| `api+/integrations.punchout.$sessionId.status.ts` (loader) | `purchasing_view` | Poll session status from the waiting UI |
| `api+/integrations.punchout.$sessionId.consume.ts` (action) | `purchasing_create` | Resolve cart → draft PO; redirect to the PO |
| `api+/webhook.mcmaster-carr.$companyId.ts` (action, `runtime: "nodejs"`) | Public; vaulted `inboundSharedSecret` (timing-safe) | Receive OC/ASN/Invoice; stage + apply; reply cXML `Response` |
| `x+/purchasing+/cxml.tsx` + `cxml.$id.tsx` | `purchasing_view`/`purchasing_update` | Document queue list + Drawer detail (release/reject/resend) |

Jobs (`packages/jobs/src/inngest/functions/integrations/punchout.ts`):

- `punchout-send-po` (retries 3): stage outbound `cxmlDocument` (`Pending`), build
  `OrderRequest` from the finalized PO + lines, POST to the environment's order
  URL, parse the synchronous `Response`, set `Sent`/`Failed`. Triggered from the
  finalize route when notification = `"cXML"`; manual resend from the queue drawer.

Finalize change: `purchaseOrderFinalizeValidator` notification enum gains `"cXML"`;
`PurchaseOrderFinalizeModal` offers it (pre-selected) when
`useIntegrations().has("mcmaster-carr")` and the PO's supplier matches the
configured `supplierId`.

## UI Changes

- **Purchasing → Orders list**: "New from McMaster-Carr" button (gated on
  integration + `purchasing_create`) → opens the punchout window + a waiting modal
  ("Shopping on McMaster-Carr… bring the cart back by checking out"); on session
  `Returned`, consume + navigate to the new draft PO. On `Cancelled`, close quietly.
- **Draft PO header** (supplier = configured McMaster supplier): "Add from
  McMaster-Carr catalog" — same flow with `purchaseOrderId` on the session; lines
  append.
- **Finalize modal**: "Send via cXML" option with the same summary treatment as
  Email.
- **Purchasing → Documents (cXML)** submodule: queue table (type, direction,
  status, supplier, PO link, external id, age) + Drawer detail showing parsed
  payload, issues, and actions (Create invoice / Reject / Resend). Live updates via
  the existing debounced-realtime pattern, mounted only while non-terminal rows
  exist.
- **PO detail**: no new surfaces — confirmation and tracking data land in existing
  fields (`supplierReference`, `promisedDate`, `receiptPromisedDate`,
  `trackingNumber`).
- MES: N/A (purchasing is ERP-only).

## Acceptance Criteria

- [ ] With the integration installed (test credentials + a mock punchout endpoint),
      clicking "New from McMaster-Carr" opens the supplier window; checking out a
      3-line cart produces a draft PO with 3 lines: matched lines carry `itemId` +
      supplier part number + cart price; unmatched lines are G/L Account lines
      against the configured account; each line stores its
      `supplierPartAuxiliaryId`.
- [ ] Cancelling on the supplier site (empty POOM) closes the flow with no PO
      created; re-posting the same POOM a second time changes nothing (idempotent).
- [ ] The return endpoint accepts the POST with third-party cookies blocked
      (verified with a cookie-less client) and rejects: unknown session id, expired
      session, mismatched BuyerCookie.
- [ ] Finalizing the PO with "Send via cXML" produces an outbound `cxmlDocument`
      that goes `Pending → Sent` against a mock order endpoint returning a 200
      cXML Response, with `ItemOut` lines echoing SupplierPartID and
      SupplierPartAuxiliaryID byte-for-byte (fixture-diff test); a 4xx/5xx or
      cXML error Response yields `Failed` with the response text in `issues`, and
      the queue offers Resend.
- [ ] POSTing McMaster's sample ConfirmationRequest to the webhook updates
      `supplierReference` and line `promisedDate`s and records a `Posted` inbound
      document; the `$629.52` money format parses correctly.
- [ ] POSTing the sample ASN stores the UPS tracking number on
      `purchaseOrderDelivery` and stages the document.
- [ ] POSTing the sample Invoice stages a `Needs Review` document; "Create invoice"
      produces a draft purchase invoice whose lines, tax, and totals match the
      sample (settlement amounts at currency decimals); the sample Credit Memo
      (negative quantities) produces a credit. Neither is auto-posted.
- [ ] A wrong `inboundSharedSecret` gets a cXML 401-class Response and no staged
      document; all webhook writes are scoped to the URL's `companyId`.
- [ ] `pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp`, lint, and
      the new parse/build unit tests (against all seven fixtures) pass.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| No real McMaster credentials until onboarding (~30 days, NDA'd endpoints) | High | Build against the seven sample documents + a small mock supplier server for dev/e2e; all URLs/identities are config; ship behind integration install |
| Cancellation window is minutes (McMaster ships same/next day); cancelling the Carbon PO does not cancel the order | Med | Document prominently in SetupInstructions + a warning on the finalize modal's cXML option |
| PO send fails silently after finalize (buyer believes it's ordered) | Med | `Failed` status in the queue + assignment notification; document queue link on the PO |
| Public return endpoint abuse (forged carts) | Med | Unguessable single-use session id + BuyerCookie echo + 2-hour expiry + idempotent consume; sessions are inert until an authenticated user consumes them |
| UOM codes outside the company's `unitOfMeasure` list | Low | Fallback to EA + line issue surfaced at consume time |
| Multiple ASNs per PO overwrite `trackingNumber` (single column) | Low | Last-wins on the PO field; every ASN stays visible in the queue; revisit if partial shipments become a pain point |
| Payment model change on punchout enablement (credit card → AP billing) | Low | Called out in SetupInstructions; business decision with the McMaster rep |

## Open Questions

> All implementation-blocking questions are resolved. Checked items marked
> **Autonomous** were resolved by codebase precedent → research consensus →
> recommendation; Brad approved the spec as a whole on 2026-08-20.

- [x] **A. Add `supplierPartAuxiliaryId` (nullable TEXT) to `purchaseOrderLine`?**
      — **Answer (Brad, 2026-08-20):** yes. The aux ID rides the line to be echoed
      on the OrderRequest; requires the `purchaseOrderLines` view drop/recreate
      (fork newest definition).
- [x] **B. Confirm the two `@carbon/ee` Ask-First changes** (register
      `mcmaster-carr` in the `integrations` array; add `fast-xml-parser` as a
      direct dependency, already in the lockfile transitively) — **Answer (Brad,
      2026-08-20):** yes to both.
- [ ] **C. Which McMaster account/payment mode do we onboard with?** Punchout
      enablement changes payment options (credit card vs AP billing) and only the
      account holder can email eProcurement@mcmaster.com to start the ~30-day
      setup. **Gates live testing only, not implementation** — build and verify
      against the seven sample documents + a mock supplier endpoint.
- [x] Where does the cart land? — **Autonomous:** new draft PO (or append when
      started from a draft PO of the mapped supplier). Universal industry shape is
      cart → requisition; Carbon's requisition is the draft PO. Never a finalized
      order.
- [x] Unmatched cart lines? — **Autonomous:** G/L Account fallback with a
      configured default expense account; no auto-created items in v1 (D365/Coupa
      precedent; avoids item-master pollution; `supplierPart` rows promote lines
      to items over time).
- [x] Invoice automation level? — **Autonomous:** staged review + one-click draft
      invoice creation; never auto-post (EDI-branch `Needs Review` precedent,
      three-way-match risk).
- [x] ASN → receipt automation? — **Autonomous:** tracking/dates only; receipts
      stay manual (receipts post inventory + GL; too consequential for v1).
- [x] McMaster-only or generic punchout? — **Autonomous:** supplier-neutral cXML
      core, single `mcmaster-carr` integration registered in v1.
- [x] OCI, Level 2 index, edit/inspect re-punchout? — **Autonomous:** all out of
      scope v1 (create-only Level 1 cXML; matches D365/Oracle v1 cuts).
- [x] Does a failed cXML send block finalize? — **Autonomous:** no; async job with
      visible `Failed` state + resend (mirrors email-send behavior).
- [x] Where do inbound documents surface? — **Autonomous:** new supplier-neutral
      cXML document queue under Purchasing (mirrors the EDI branch's sales-side
      queue), not a McMaster-specific page.

## Changelog

- 2026-08-19: Created in autonomous mode. Research at
  `.ai/research/mcmaster-punchout.md` (four-track: ERP UX survey, cXML protocol,
  McMaster specifics, pitfalls). Eight decisions resolved autonomously (marked
  above); three Ask-First questions held for Brad: the `purchaseOrderLine` column,
  the `@carbon/ee` registry + dependency additions, and the McMaster
  account/payment onboarding path.
- 2026-08-20: Brad approved the spec and the Ask-First items A and B. Question C
  (McMaster onboarding/payment mode) remains open as a live-testing gate only.
  Status → in-progress; proceeding to `/plan`.
