# Research: McMaster-Carr Punchout (cXML Level 1) — Buyer-Side Integration

Date: 2026-08-19. Compiled from four parallel research passes (ERP UX survey, cXML
protocol, McMaster specifics, item handling + pitfalls) plus McMaster's sample cXML
documents (POSR, POOM, PO, OC, ASN, Invoice, Credit Memo) shared by their
eProcurement team.

## Executive summary

- Every native buyer-side implementation (Ariba, Coupa, D365 F&O, Workday, NetSuite
  SuiteProcurement) anchors punchout to a **requisition/purchase-request**, never a
  finalized PO. The cart returns as requisition lines that flow through normal
  approval → PO. Carbon has no requisition; its **Draft purchase order** is the
  equivalent stage.
- Punchout cart **prices are authoritative** (they reflect account pricing); tax and
  shipping in the cart are estimates at best — real amounts arrive on the invoice.
- The cart return (`PunchOutOrderMessage`) is a **cookie-less cross-site browser form
  POST** (`cxml-urlencoded` field) to a URL we supply in the setup request. It must
  not rely on session cookies (Chrome SameSite); correlation is via an opaque
  one-time token (BuyerCookie / return-URL token). Open the supplier site in a
  **new window/tab, never an iframe** (X-Frame-Options + third-party cookies).
- `SupplierPartAuxiliaryID` is an opaque supplier cookie on each cart line; it must
  be stored and **echoed byte-for-byte** in the outbound cXML `OrderRequest`.
- McMaster publishes **no public endpoints**. Onboarding (email
  eProcurement@mcmaster.com with the buyer's account number, ~30 days) yields: a
  punchout setup URL, separate **test and production PO-posting URLs**, From/Sender
  NetworkID + credential domain, and a SharedSecret. Their DUNS is 006931349
  (corroborated). Punchout enablement can change the buyer's payment model
  (coordinate credit card vs AP billing with the rep).
- McMaster sends order confirmations, ASNs, and invoices/credit memos as cXML
  (ConfirmationRequest / ShipNoticeRequest / InvoiceDetailRequest) POSTed to a
  buyer-hosted URL, authenticated by SharedSecret in the `Sender` credential.
- McMaster ships same/next day (98% from stock) — the cancellation window after PO
  transmission is effectively minutes; cancelling in the ERP does not cancel the
  order at McMaster.

## Protocol (cXML.org User's Guide + DTD, verified)

1. **POSR (buyer → supplier, server-to-server HTTPS POST, text/xml)**:
   `PunchOutSetupRequest operation="create|edit|inspect"` with `BuyerCookie`
   (required, unique per session, correlation-only — never auth),
   `BrowserFormPost/URL` (where the cart comes back), optional `Contact`/
   `Extrinsic` (user identity), `ShipTo`, deprecated-but-tolerated
   `SupplierSetup/URL`. Response: `PunchOutSetupResponse/StartPage/URL` — a unique,
   short-lived session URL (suppliers typically expire it in ~5 minutes) to open in
   the user's browser.
2. **POOM (supplier → buyer, browser form POST)**: hidden field `cxml-base64` or
   `cxml-urlencoded` (check base64 first per the spec). Contains `BuyerCookie`
   (must match an open session), `PunchOutOrderMessageHeader operationAllowed=
   "create|inspect|edit"` (gates any later cart-edit button), `Total`, and `ItemIn`
   lines: `SupplierPartID` (required), `SupplierPartAuxiliaryID` (opaque, may be
   escaped XML; Ariba caps at 255 chars — treat as blob), `UnitPrice/Money`,
   `Description`, `UnitOfMeasure` (UN/CEFACT: EA, PK, PR…), `Classification
   domain="UNSPSC"`, optional Manufacturer fields/LeadTime. **An empty POOM means
   the user cancelled** — delete any previously returned punchout lines.
3. **OrderRequest (buyer → supplier, server-to-server)**: same credential scheme;
   each `ItemOut` echoes `SupplierPartID` + `SupplierPartAuxiliaryID` verbatim.
   Supplier answers synchronously with a cXML `Response/Status` (200-class =
   accepted). McMaster's sample includes ShipTo (with `DeliverTo`), BillTo,
   Shipping description, Tax, Contact role="user" with email, and Comments.
4. **Inbound documents** (supplier → buyer URL, server-to-server POST,
   SharedSecret in Sender):
   - `ConfirmationRequest` — header `type="accept"`, `confirmID`, McMaster's own
     order number in `OrderReference@orderID`, per-line `ConfirmationStatus` with
     `shipmentDate`/`deliveryDate`. Note the sample's Total is `$629.52` (dollar
     sign inside Money) — parse defensively.
   - `ShipNoticeRequest` — `shipmentID`, ship/delivery dates, `CarrierIdentifier`
     (e.g. UPS) + `ShipmentIdentifier` (tracking number), per-line quantities (UOM
     may differ from EA, e.g. PK).
   - `InvoiceDetailRequest` — `purpose="standard"` or `"lineLevelCreditMemo"`
     (negative quantities/amounts), invoiceID, payment terms (Net 30 / 2%10),
     line references back to PO line numbers, summary with tax/shipping/gross/
     net/due amounts.
5. **Level 1 vs Level 2**: Level 1 = store-level entry link only (what McMaster
   calls their primary form). Level 2 adds a supplier-provided index file
   (`IndexItemPunchout`) so items are searchable in the buyer app and deep-link
   via `SelectedItem`. McMaster's own site JS shows `punchOutMode == "edit"|"view"`
   branches, so edit/inspect likely works — but create-only is the safe v1 (Oracle
   Fusion ships inspect-only; D365 ships create-only).

## How other ERPs surface it (UX)

- **D365 F&O**: vendor tiles ("external catalogs") on the requisition item picker;
  cart lines land as requisition lines anchored to a procurement category (no item
  master record needed); returned prices treated as a quote with a configurable
  expiration in days.
- **Coupa/Ariba/Workday**: punchout supplier tile/link inside shopping/requisition
  creation; cart → requisition → approval → PO.
- **NetSuite SuiteProcurement**: punchout from purchase-request creation; maps
  trading-partner item categories to non-inventory item categories (GL expense
  account each).
- **Oracle Fusion 25A**: opt-in supplier-part → master-item resolution ("Trading
  Partner Relationship"); falls back to description-only lines. Punchout PO unit
  prices are not editable unless a per-catalog "allow price override" is set.
- **Mid-market MES/ERP (Fulcrum, ProShop, Genius) and Odoo: no native punchout at
  all** — this is a differentiator for Carbon.

## Item-handling patterns for unknown parts

Three models across the market: (1) description-only lines, no item record (D365,
Coupa — most common); (2) supplier-part cross-reference into the item master when a
match exists, fallback to description lines (Oracle Fusion); (3) generic non-stock
placeholder item per category (NetSuite). UOM handling is a standard failure mode:
Coupa rejects carts whose UOM isn't enabled; Jaggaer/Oracle keep explicit UOM
mapping tables.

## Pitfalls checklist

- StartPage URLs expire fast (~5 min) — POST the POSR only when the user clicks,
  then open the window immediately.
- Return endpoint: no cookies read or set; one-time token in the URL path;
  re-entry into the authenticated app happens after the POST is stored (redirect
  to an authenticated route keyed by the token).
- Duplicate POOM posts for the same BuyerCookie must be idempotent (consume the
  session on first post).
- Currency must match an enabled currency; UOM must map to Carbon UOM codes.
- Prior direct mcmaster.com browser sessions can break the punchout (cookie
  collision — UCSB documents "clear McMaster cookies" as the fix); a fresh
  window per session mitigates.
- Cancelling the ERP document does not cancel the McMaster order; they ship
  same/next day.

## Recommendations for Carbon

1. Cart lands as a **Draft purchase order** (Carbon's requisition equivalent) —
   never auto-finalized. Punchout prices prefill `supplierUnitPrice`; tax/shipping
   estimates go to notes, not the tax pair.
2. Resolve `SupplierPartID` against `supplierPart` (per-supplier cross-reference);
   unmatched lines follow the AI-extraction precedent (Comment/G-L lines or
   prompt-to-create-item), mirroring `resolveItemIdFromExtractedText`.
3. Store `SupplierPartAuxiliaryID` opaquely per line for the outbound OrderRequest.
4. Build generic cXML punchout infrastructure (`packages/ee/src/punchout/` or
   similar) with McMaster as the first configured supplier — every value
   (punchout URL, PO URL, identities, shared secret, deployment mode) is
   per-company config, since McMaster issues them privately.
5. Inbound OC/ASN/Invoice endpoints are buyer-hosted URLs verified by SharedSecret;
   stage inbound documents for review (EDI-branch `ediDocument` pattern) rather
   than auto-posting invoices in v1.

## Sources

Protocol: cXML User's Guide 1.1 (xml.cxml.org/schemas/cXML/1.1.010/cXMLUsersGuide.pdf),
cXML 1.2.066 DTD, punchoutcommerce.com POSR/POOM/OrderRequest guides,
SAP Help (cXML Solutions: PunchOutOrderMessage, Level 2 PunchOut, URL vs SelectedItem).
ERPs: docs.coupa.com (punchout catalogs, punchout ordering, sample POSR),
learn.microsoft.com (D365 set-up/use external catalogs for punchout),
doc.workday.com (Set Up Supplier Punchout), docs.oracle.com (NetSuite SuiteProcurement,
Fusion punchout catalogs + 25A master-item feature), tradecentric.com (Level 2),
instapunchout.com (Odoo), odoo.com forum, fulcrumpro.com.
McMaster: mcmaster.com/eprocurement + /punchout + /help/punchout-catalog,
success.procurify.com McMaster-Carr punchout overview (credential field list,
distinct punchout vs PO URLs, 30-day setup, payment-model note),
help.precoro.com McMaster KB (account number → credentials; cancellation caveat),
ramp.com, purchase.umd.edu, finance.gatech.edu, esmsolutions.com,
bfs.ucsb.edu (cookie-collision FAQ), nsnlookup.com/cage/39428 (DUNS 006931349).
Pitfalls: punchoutcommerce.com Chrome-80 remediation + edit/inspect guides,
punchout-gateway.com troubleshooting, docs.developers.optimizely.com (iframe
limitations), Coupa "punchout failed to return a cart".
