# McMaster-Carr Punchout — execution run log

**Plan:** `.ai/plans/2026-08-20-mcmaster-carr-punchout.md`
**Branch:** `cxml-punchout-integration`
**Date:** 2026-08-20

## Static gates (all green)

- `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee --filter=@carbon/jobs` → 3 successful
- `pnpm --filter @carbon/ee test` → 580 passed (24 new: cXML parse/build across all 7 fixtures + resolver matrix)
- `pnpm --filter @carbon/jobs test` → 476 passed
- `pnpm run lint` → all lint tasks pass (69 pre-existing warnings, none in new files)

## Browser / functional verification (local stack, mock supplier endpoint)

Integration installed for company `Carbon Development` via the vault RPC
(supplier SpaceGrade Fasteners, env Test, mock URLs, both secrets `mcmaster`,
default expense account "Indirect Materials & Services"). supplierPart `3201T16`
cross-referenced to item RW-010.

## Spec Acceptance Criteria

- [x] **Punchout → 3-line draft PO.** Round trip (start → mock shop → checkout →
      return → consume) created draft PO000005: line 1 Part (item RW-010, part
      3201T16, aux 8310486455458, qty 2, $0.90); lines 2–3 G/L Account lines
      against the configured expense account; every line stored its
      `supplierPartAuxiliaryId`. Verified in DB and in the PO UI.
- [x] **Cancel = empty POOM.** Mock "Cancel" (no ItemIn) → session `Cancelled`,
      no PO. Idempotent redelivery: a duplicate confirmation (same payloadID)
      returned cXML 200 and changed nothing (dedup index).
- [x] **Return endpoint cookie-less + rejects.** Public POST accepted (200 HTML
      close page); unknown session → 404; mismatched BuyerCookie/empty → error;
      expiry compared via `parseAbsolute`. (curl + page-context fetch.)
- [x] **Finalize "Send via cXML" → Sent.** notification=cXML triggered
      punchout-send-po; outbound `Purchase Order` document went Pending → Sent
      against the mock 200 order endpoint. ItemOut aux-id byte-for-byte covered by
      the build unit test.
- [x] **Confirmation applies.** Posting the sample ConfirmationRequest (orderID →
      PO000005) set `supplierReference` = 4122618, all line `promisedDate` =
      2018-07-13, `receiptPromisedDate` = earliest; document `Posted`. `$629.52`
      parses to 629.52 (unit test).
- [x] **ASN.** Sample ShipNoticeRequest stored tracking `1Z602878787878787878`
      on `purchaseOrderDelivery`; document `Posted`.
- [x] **Invoice → draft purchase invoice.** Sample invoice staged `Needs Review`;
      "Create invoice" produced draft AP000002 (status Draft — never auto-posted),
      line matched to the PO as Part, qty 2, $127.02, tax $15.88, taxPercent
      0.06251 (= 15.88 / 254.04). Credit memo (negative qty/amounts) stages as a
      `Credit Memo` (parse unit test: qty −2, due −269.92).
- [x] **Wrong inbound secret → cXML 401, no staged doc; writes scoped to the
      URL's companyId.** Verified by curl (correct `mcmaster` → code 200; wrong →
      code 401).
- [x] **typecheck / lint / unit tests pass.**

## Deviations from plan (all noted in commits)

1. `fast-xml-parser` added via `catalog:` (5.3.1) rather than a literal `^5.7.2`
   — follows the repo's catalog convention; same v5 API.
2. Task 8's Inngest job writes cXML documents via direct service-role queries
   rather than the app's `insertCxmlDocument`/`updateCxmlDocumentStatus` — a
   package cannot import app module services (`packages/jobs` → `~/modules/*` is
   forbidden). Same layering the paperless-parts job uses.
3. Added `getPunchoutSessionById` (Task 6 file) for the public return route,
   which has no companyId.
4. Added `supplierPartAuxiliaryId` to `purchaseOrderLineValidator` so the resolved
   aux id persists through `upsertPurchaseOrderLine`.
5. **Bug found in e2e:** the start route and mock derived the origin from
   `new URL(request.url).origin`, which is the internal proxied host
   (`http://127.0.0.1`). Fixed to `getAppUrl()` (ERP_URL) so the BrowserFormPost
   return URL McMaster receives is the public origin.

## Not covered (gated)

- Live McMaster endpoints — blocked on onboarding (spec open question C); all
  verification used the seven sample documents + the dev mock endpoint.
</content>
