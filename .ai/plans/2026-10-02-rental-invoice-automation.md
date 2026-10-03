# Rental Invoice Automation — implementation plan

> Shared layer (2026-10-02): the automation built here is source-agnostic (`invoiceAutomation`, `packages/jobs/src/invoicing/`, `recurring-billing`, "Recurring invoicing" digest) so AR contracts (`.ai/specs/2026-10-02-contracts.md`) reuse it. Scope is unchanged: rentals only, no Stripe mode.

**Spec:** .ai/specs/2026-10-02-rental-invoice-automation.md
**Research:** .ai/research/rental-invoice-automation.md
**Branch:** revenue-recognition-rentals-spec (rentals are not on `main` yet; this builds on them)

## Plan-level decisions (fold into the spec changelog at close-out)

These refine the spec where the code facts gathered for this plan disagreed with its assumptions.

1. **The automation sends email with `sendEmail` (`@carbon/lib/email.server`) directly, not `trigger("send-email")`.** The `carbon/send-email` job forces From to `DEFAULT_FROM`, maps `from` to `replyTo`, and has no sender-name field (`packages/jobs/src/inngest/functions/notifications/send-email.ts:46-54`). It also only queues, so a delivery error would never reach `sendError`. Calling `sendEmail` directly gives D13's From/Reply-To and a real error. The manual post route keeps `trigger("send-email")`, so its `sentAt` means "queued".
2. **`checkPartyContactRequirement` moves to `@carbon/lib`, not `@carbon/database` or `@carbon/ee`.** `@carbon/database` lacks `@carbon/logger` and has `@supabase/supabase-js` only as a devDep. `packages/ee` is commercially licensed, and moving AGPL logic there changes its license. `@carbon/lib` already depends on `@carbon/logger`, `@supabase/supabase-js` and `@carbon/database`, and both ERP and jobs depend on it. Its pure sibling `party-contact.ts` moves with it. The ERP files become re-exports, so the six existing callers don't change.
3. **The shared sales-invoice document loader lives in `@carbon/lib` (`./sales-invoice-document.server`), not `@carbon/documents`.** `@carbon/documents` has no supabase or files runtime deps and no loader precedent. `@carbon/lib` gains workspace deps on `@carbon/documents` and `@react-pdf/renderer` (same version as `packages/jobs`). This is not a cycle: `@carbon/documents` depends on `env`, `notifications`, `react` and `utils`, not `lib`.
4. **"Needs review" is a derived boolean on the `salesInvoices` view (`needsReview`) plus a sidebar link** `Receivables → Needs Review` (`?filter=needsReview:eq:true`). Saved views are per user (`tableView.createdBy`), and the generic filter syntax can't express the spec's OR.
5. **"Send" on a posted invoice with `sendError` is a new action route `x+/sales-invoice+/$invoiceId.send.tsx`.** It fires `carbon/invoice.automate` with `mode: "Post and Email"`. `automateSalesInvoice` skips posting an already-Submitted invoice, then emails it. There is no send-only path in `SalesInvoicePostModal` to reuse.
6. **The event carries an optional `mode`.** When absent, the function resolves the effective mode from the invoice's agreement (`salesInvoiceLine.rentalAgreementId` → `rentalAgreement.invoiceAutomation ?? companySettings.invoiceAutomation`).
7. **The split and hold decision is a pure function in its own file**, `packages/database/src/rental-invoice-plan.ts`, tested with vitest. The existing `shared/rental-billing.test.ts` runs under Deno only.
8. **Re-billing after a VOID is always held (user, 2026-10-02).** VOID returns a rental invoice's periods and charges to Pending (`post-sales-invoice/index.ts:1704-1715`). With automation on, the next morning's run would redraft and re-post — and email — the same amounts, since an Active agreement's rates are locked. VOID now stamps `voidedSalesInvoiceId` on each released row. The planner holds any rent invoice containing such a row with "Re-billing INV-…, which was voided"; charges are held anyway. The stamp is sticky: deleting the held draft (`releaseRentalInvoiceStamps`) leaves it, so the next draft is held again. A later VOID overwrites it. `Draft Only` agreements get no hold, since nothing is automated.
9. **Notifications reach an internal person with no setup (user, 2026-10-02: "a good default should be automatic invoices with notifications to the internal person").** The spec's D16 sent nothing when `invoiceNotificationGroup` was empty, so out of the box nobody heard about anything. Now every cron run sends each agreement's internal owner — `rentalAgreement.salesPersonId ?? createdBy` — one digest covering their agreements' invoices: posted, emailed, held, unsent. The settings group becomes **Also notify**: those people get the company-wide digest on top. An owner listed directly in the group (by user id) gets only the company digest, never both. The default mode stays `Post and Email`.

## Progress

- [x] Task 1: Baseline green
- [x] Task 2: Migration — enum, columns, views
- [x] Task 3: Apply migration, regenerate types, run DB gates
- [x] Task 4: Pure invoice planner + tests
- [x] Task 5: Generator drafts rent and charges invoices per the planner
- [x] Task 5b: VOID stamps the voided invoice on released periods and charges
- [x] Task 6: Move the party-contact check to `@carbon/lib`
- [x] Task 7: Shared sales-invoice document loader in `@carbon/lib`; PDF route uses it
- [x] Task 8: Event type + trigger map entry
- [x] Task 9: `automateSalesInvoice` + tests
- [x] Task 10: Inngest wiring — automate function, cron steps, digest
- [x] Task 11: `RecurringInvoicing` notification event
- [x] Task 12: Manual post route — shared PDF, storage path fix, sent stamps
- [x] Task 13: Settings models/services + Settings → Invoicing page (moving two cards)
- [x] Task 14: Agreement override — model, service, update route, properties field
- [x] Task 14b: Agreement shows invoicing is automatic; button becomes "Invoice Now"
- [x] Task 15: Generate Invoices / Sell to Customer fire automation
- [x] Task 16: Agreement cards show held invoices
- [x] Task 17: Invoice header badges + Send route
- [x] Task 18: Invoices list — needsReview column + Needs Review link
- [x] Task 19: MCP metadata, lint, i18n, scoped typechecks, tests
- [ ] Task 20: Docs — AGENTS.md, rules, spec changelog
- [ ] Task 21: Browser verification (`/test`)

## Dependencies

- Task 1 → Task 2 → Task 3. Every later task needs Task 3's types.
- Task 4 → Task 5. Task 5b needs only Task 3 (parallel-safe with 4–5).
- Tasks 6, 7 and 8 are independent of each other and of Tasks 4–5 (parallel-safe after Task 3).
- Task 9 needs Tasks 5, 6, 7 and 8. Task 10 needs Tasks 9 and 11. Task 11 is independent after Task 3.
- Task 12 needs Task 7.
- Tasks 13, 14, 14b, 16 and 18 are parallel-safe after Task 3 (disjoint files).
- Tasks 15 and 17 need Task 8.
- Tasks 19–21 run last, in order.

---

## Task 1: Baseline green

**Depends on:** none
**Files:** none

**Steps:**
1. `git status` must be clean. `git fetch origin && git merge origin/main` if `main` moved; resolve conflicts and stop if any touch `rental-billing.ts`, `$invoiceId.post.tsx` or `settings+/sales.tsx`.
2. Record a baseline of the scoped typechecks and tests below. Any pre-existing failure goes in the run log so later tasks compare against it, not against zero.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs --filter=@carbon/lib --filter=@carbon/database --filter=@carbon/documents
# Expected: all tasks successful (or the pre-existing failures recorded in step 2)
pnpm --filter @carbon/jobs test && pnpm --filter @carbon/database test && pnpm --filter @carbon/lib test
# Expected: all pass
```

**Out of scope:** fixing any pre-existing failure.

---

## Task 2: Migration — enum, columns, views

**Depends on:** 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_rental-invoice-automation.sql` (via `pnpm db:migrate:new rental-invoice-automation`)
- Copy from (precedent): `packages/database/supabase/migrations/20260923003525_rental-agreements.sql:319-347` (the `rentalAgreements` view), `packages/database/supabase/migrations/20260916143022_invoice-settlement-source-amount-fallback.sql:13-92` (the `salesInvoices` view)

**Steps:**
1. `pnpm db:migrate:new rental-invoice-automation`. The timestamp must be newer than `20261002061437`; if it isn't, STOP.
2. Write:
```sql
DO $$ BEGIN
  CREATE TYPE "invoiceAutomation" AS ENUM ('Draft Only', 'Post', 'Post and Email');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "invoiceAutomation" "invoiceAutomation" NOT NULL DEFAULT 'Post and Email',
  ADD COLUMN IF NOT EXISTS "invoiceNotificationGroup" TEXT[] NOT NULL DEFAULT '{}';

-- NULL = the company default
ALTER TABLE "rentalAgreement"
  ADD COLUMN IF NOT EXISTS "invoiceAutomation" "invoiceAutomation";

-- The last invoice this row was billed on that was VOIDED. Set by post-sales-invoice's
-- void step; the rental invoice planner holds a re-bill. No FK, like salesInvoiceLineId.
ALTER TABLE "rentalBillingPeriod"
  ADD COLUMN IF NOT EXISTS "voidedSalesInvoiceId" TEXT;
ALTER TABLE "rentalAgreementCharge"
  ADD COLUMN IF NOT EXISTS "voidedSalesInvoiceId" TEXT;

ALTER TABLE "salesInvoice"
  ADD COLUMN IF NOT EXISTS "automationHoldReason" TEXT,
  ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "sentTo" TEXT,
  ADD COLUMN IF NOT EXISTS "sendError" TEXT;
```
3. Recreate `rentalAgreements`. Copy `20260923003525_rental-agreements.sql:320-347` VERBATIM (its `DROP VIEW IF EXISTS` + `CREATE VIEW … WITH(SECURITY_INVOKER=true)` selecting `ra.*`), with one change: add `COALESCE(ra."invoiceAutomation", cs."invoiceAutomation") AS "effectiveInvoiceAutomation"` to the select list and `LEFT JOIN "companySettings" cs ON cs."id" = ra."companyId"` to the FROM. First `grep -rn '"rentalAgreements"' packages/database/supabase/migrations` and confirm no migration newer than `20260923003525` redefines it. If one does, copy THAT body instead.
4. Recreate `salesInvoices`. `grep -rln 'VIEW "salesInvoices"' packages/database/supabase/migrations | sort | tail -1` must be `20260916143022_invoice-settlement-source-amount-fallback.sql`; if not, copy the newest. Copy its full `CREATE OR REPLACE VIEW "salesInvoices"` statement and APPEND, after the last column (`si."status" AS "baseStatus"`):
```sql
  , si."automationHoldReason"
  , si."sentAt"
  , si."sentTo"
  , si."sendError"
  , (
      (si."status" = 'Draft' AND si."automationHoldReason" IS NOT NULL)
      OR (si."status" <> 'Draft' AND si."sendError" IS NOT NULL AND si."sentAt" IS NULL)
    ) AS "needsReview"
```
   `CREATE OR REPLACE` only allows appending columns at the end; do not reorder anything.
5. No RLS changes: these are new columns on existing tables (spec D21). No `TABLE_RENAMES` entry: nothing renamed or dropped.

**Verify:**
```bash
grep -c "invoiceAutomation" packages/database/supabase/migrations/*_rental-invoice-automation.sql
# Expected: >= 4
grep -n "000000_" <(ls packages/database/supabase/migrations | tail -1)
# Expected: no output
```

**Out of scope:** `CREATE POLICY` (forbidden in migrations); touching any other view.

---

## Task 3: Apply migration, regenerate types, run DB gates

**Depends on:** 2
**Files:** generated types only (`packages/database/src/types.ts`, swagger), plus `packages/jobs/manifests/schema.json` if the backup check regenerates it

**Steps:**
1. `pnpm db:migrate` (applies + regenerates types). If the local DB is unreachable, STOP and ask the user to start it. Never rebuild the DB.
2. `pnpm run generate:types` if `db:migrate` reported no regeneration.
3. `pnpm db:check:datasets` and `pnpm db:check:backups`.

**Verify:**
```bash
grep -c "invoiceAutomation" packages/database/src/types.ts
# Expected: >= 3 (enum + companySettings + rentalAgreement)
grep -n "needsReview\|effectiveInvoiceAutomation" packages/database/src/types.ts | head
# Expected: both names present
grep -c "voidedSalesInvoiceId" packages/database/src/types.ts
# Expected: >= 6 (Row/Insert/Update × 2 tables)
pnpm db:check:datasets
# Expected: all four datasets OK
pnpm db:check:backups
# Expected: compatible / exit 0
```

**Out of scope:** hand-editing `types.ts`.

---

## Task 4: Pure invoice planner + tests

**Depends on:** 3
**Files:**
- Create: `packages/database/src/rental-invoice-plan.ts`
- Create: `packages/database/src/rental-invoice-plan.test.ts`
- Modify: `packages/database/package.json` — add `"./rental-invoice-plan": "./src/rental-invoice-plan.ts"` to `exports` next to `./rental-billing`
- Copy from (precedent): `packages/database/src/inspection-verdict.ts` + its `.test.ts` (pure module + vitest shape)

**Steps:**
1. Start the file with its SPDX header (`pnpm --filter @carbon/checks license-headers` writes it; AGPL).
2. Implement:
```ts
import type { Database } from "./types";

export type InvoiceAutomation = Database["public"]["Enums"]["invoiceAutomation"];

export const RENTAL_HOLD_CHARGES = "Charges are reviewed before posting";
export const RENTAL_HOLD_EARLY_RETURN = "Includes an early-return credit";
export const RENTAL_SEND_NO_EMAIL = "The invoice contact has no email";
/** readableIds: distinct readable ids of the voided invoices, in first-seen order. */
export const rentalHoldRebill = (readableIds: string[]) =>
  `Re-billing ${readableIds.join(", ")}, which ${readableIds.length === 1 ? "was" : "were"} voided`;

export type PlannableLine<T> = {
  item: T; kind: "Rent" | "Charge" | "Purchase Option"; isAdjustment: boolean;
  /** Readable id of a voided invoice this row was previously billed on, else null. */
  voidedInvoiceReadableId: string | null;
};
export type PlannedInvoice<T> = { lines: T[]; holdReason: string | null; role: "combined" | "rent" | "charges" };

/** Splits one agreement's due lines into the invoices to draft.
 *  Draft Only → one combined invoice, no hold (today's behaviour).
 *  Otherwise → a rent invoice and a charges invoice (Charge + Purchase Option, always held).
 *  Rent hold precedence: re-bill of a voided invoice (rentalHoldRebill) > early-return adjustment.
 *  Empty invoices are omitted. */
export function planRentalInvoices<T>(mode: InvoiceAutomation, lines: PlannableLine<T>[]): PlannedInvoice<T>[]

/** The mode in force for an agreement. */
export function effectiveInvoiceAutomation(
  agreementMode: InvoiceAutomation | null, companyMode: InvoiceAutomation
): InvoiceAutomation
```
   Line order inside each invoice is the input order.
3. Tests (each a separate `it`):
   - Draft Only with rent + charge → 1 combined invoice, holdReason null, both lines.
   - Post with rent only → 1 rent invoice, holdReason null.
   - Post with rent + Charge + Purchase Option → rent (no hold) + charges (`RENTAL_HOLD_CHARGES`, 2 lines).
   - Post and Email with a rent row + an `isAdjustment` rent row → 1 rent invoice with `RENTAL_HOLD_EARLY_RETURN`.
   - Post with charges only → 1 charges invoice, held.
   - Post and Email with two rent rows carrying `voidedInvoiceReadableId` "INV-7" and one with null → rent invoice held with `rentalHoldRebill(["INV-7"])` ("Re-billing INV-7, which was voided").
   - Post with a re-billed rent row AND an adjustment row → the re-bill message wins.
   - Draft Only with a re-billed row → 1 combined invoice, holdReason null.
   - Empty input → `[]` in every mode.
   - `effectiveInvoiceAutomation(null, "Post")` is `"Post"`; `("Draft Only", "Post and Email")` is `"Draft Only"`.

**Verify:**
```bash
pnpm --filter @carbon/database test -- rental-invoice-plan
# Expected: 10 passed (or more), 0 failed
```

**Out of scope:** any DB access in this file.

---

## Task 5: Generator drafts rent and charges invoices per the planner

**Depends on:** 4
**Files:**
- Modify: `packages/database/src/rental-billing.ts`
- Modify: `apps/erp/app/modules/sales/sales.server.ts:386-391` (`generateRentalInvoicesNow` return type follows)
- Modify: `apps/erp/app/routes/x+/rental-agreement+/$id.invoice.tsx:48-84` (reads the new return shape)
- Modify: `packages/jobs/src/inngest/functions/scheduled/rental-billing.ts:57-68` (reads the new shape)

**Steps:**
1. Change the return type of `createRentalInvoicesForDuePeriods` to:
```ts
export type DraftedRentalInvoice = {
  invoiceId: string; rentalAgreementId: string;
  mode: InvoiceAutomation; holdReason: string | null;
};
Promise<{ invoices: DraftedRentalInvoice[]; invoiceIds: string[] }>  // invoiceIds = invoices.map(i => i.invoiceId), kept for callers
```
2. In `draftAgreementInvoice` (114-340): read the company mode once per agreement inside the transaction, with `selectFrom("companySettings").select("invoiceAutomation").where("id","=",args.companyId).executeTakeFirstOrThrow()` right after the agreement `forUpdate` read (121-128). Compute `mode = effectiveInvoiceAutomation(agreement.invoiceAutomation, company.invoiceAutomation)`.
3. Add `voidedSalesInvoiceId` to the period select (142-175) and the charge select (177-198). Read the readable ids in ONE query (`selectFrom("salesInvoice").select(["id","invoiceId"]).where("companyId","=",…).where("id","in",distinctIds)`, skipped when there are none; no per-row query). Build the `lines` array exactly as today (214-240), carrying each line's `kind`, the period's `isAdjustment` and `voidedInvoiceReadableId` (the readable id, else the raw id if the invoice row is gone). Call `planRentalInvoices(mode, lines.map(l => ({ item: l, kind: l.kind, isAdjustment: l.isAdjustment ?? false, voidedInvoiceReadableId: l.voidedInvoiceReadableId })))`.
4. Extract the existing per-invoice block (subtotal/tax 242-245, `getNextSequence` 247, invoice insert 252-275, shipment insert 277-286, line insert 288-307, period stamp 310-323, charge stamp 325-337) into `insertRentalInvoice(trx, args, agreement, lines, holdReason)`, returning the invoice id. Insert `automationHoldReason: holdReason` on the `salesInvoice` row. Call it once per planned invoice. The function now returns `DraftedRentalInvoice[]` (empty when nothing is due). The stamping is already scoped by `sil.invoiceId`, so it stays correct per invoice.
5. Update the three callers to the new shape (`invoiceIds` still exists, so `$id.invoice.tsx`'s counts keep working; the cron logs `invoices.length`).
6. If the extracted block reads any variable that differs between the two invoices beyond lines/holdReason (e.g. a header-level total computed before the split), STOP and report. Do not improvise header semantics.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/jobs --filter=erp
# Expected: no new errors vs Task 1 baseline
pnpm --filter @carbon/database test
# Expected: all pass
```

**Out of scope:** posting, emailing, events (Task 9/10); `rollBillingPeriodsForward`; the idempotency query at 52-102.

---

## Task 5b: VOID stamps the voided invoice on released periods and charges

**Depends on:** 3
**Files:**
- Modify: `packages/database/supabase/functions/post-sales-invoice/index.ts:1704-1715` (the void step's `rentalBillingPeriod` and `rentalAgreementCharge` updates)

**Steps:**
1. In both `.set({...})` calls of the void step, add `voidedSalesInvoiceId: invoiceId` (the `salesInvoice.id` already in scope in the void branch; it is the same `invoiceId` used at :1560). Change nothing else in the void step.
2. Update the comment above (`// Undo what posting a Rental line consumed…`) with one line: "…and remember the voided invoice, so the automated re-bill is held for review (spec 2026-10-02-rental-invoice-automation)."
3. If `invoiceId` is not in scope at :1704, or holds the readable id rather than `salesInvoice.id`, STOP and report.
4. The posting function has pre-existing `deno check` errors (see the revenue-recognition plan's execution notes). The gate is "no NEW errors": run the check at HEAD (`git stash`-free: copy the file to `/tmp` first) and after, then diff the normalized error lists.

**Verify:**
```bash
grep -c "voidedSalesInvoiceId: invoiceId" packages/database/supabase/functions/post-sales-invoice/index.ts
# Expected: 2
cd packages/database/supabase/functions && deno check post-sales-invoice/index.ts 2>&1 | grep -E "^(error|TS)" | sed -E 's/:[0-9]+:[0-9]+//' | sort > /tmp/after.txt; wc -l < /tmp/after.txt
# Expected: the same count (and identical content) as the HEAD run recorded in step 4
cd packages/database/supabase/functions && deno task test post-sales-invoice/rental-posting.test.ts
# Expected: all pass (unchanged)
```
Behaviour is proven end to end in Task 21 step 8.

**Out of scope:** any other change to the void step; clearing the stamp anywhere.

---

## Task 6: Move the party-contact check to `@carbon/lib`

**Depends on:** 3
**Files:**
- Create: `packages/lib/src/party-contact.ts` (moved from `apps/erp/app/modules/settings/party-contact.ts`, content unchanged)
- Create: `packages/lib/src/party-contact.server.ts` (moved from `apps/erp/app/modules/settings/party-contact.server.ts`; its `./party-contact` import stays relative)
- Create: `packages/lib/src/party-contact.test.ts` (moved from `apps/erp/app/modules/settings/party-contact.test.ts`; fix its import path)
- Modify: `packages/lib/package.json` — exports `"./party-contact": "./src/party-contact.ts"`, `"./party-contact.server": "./src/party-contact.server.ts"`
- Modify: `apps/erp/app/modules/settings/party-contact.ts` → `export * from "@carbon/lib/party-contact";`
- Modify: `apps/erp/app/modules/settings/party-contact.server.ts` → `export * from "@carbon/lib/party-contact.server";`
- Delete: `apps/erp/app/modules/settings/party-contact.test.ts`

**Steps:**
1. `git mv` each file to keep history, then recreate the two ERP files as one-line re-exports (with their SPDX header).
2. Every runtime import of the moved server file (`@carbon/database` types, `@carbon/logger`, `@supabase/supabase-js`) is already a `@carbon/lib` dependency. If the pure file imports anything that isn't, STOP.
3. Run the license-header fixer.

**Verify:**
```bash
pnpm --filter @carbon/lib test -- party-contact
# Expected: the moved tests pass (same count as before the move)
pnpm exec turbo run typecheck --filter=@carbon/lib --filter=erp
# Expected: no new errors
```

**Out of scope:** changing the six ERP callers; changing behaviour.

---

## Task 7: Shared sales-invoice document loader in `@carbon/lib`; PDF route uses it

**Depends on:** 3
**Files:**
- Create: `packages/lib/src/sales-invoice-document.server.tsx`
- Modify: `packages/lib/package.json` — export `"./sales-invoice-document.server": "./src/sales-invoice-document.server.tsx"`; add deps `"@carbon/documents": "workspace:*"` and `"@react-pdf/renderer"` (copy the exact version string from `packages/jobs/package.json`)
- Modify: `apps/erp/app/routes/file+/sales-invoice+/$id[.]pdf.tsx` — replace the reads (:61-205) with the loader
- Copy from (precedent): the current `$id[.]pdf.tsx:61-247`; thumbnails from `apps/erp/app/modules/shared/shared.service.ts:56` (`getBase64ImageFromSupabase`); logo URL rewrite from `getCompany` (`apps/erp/app/modules/settings/settings.service.ts:207`)

**Steps:**
1. Implement with a plain `SupabaseClient<Database>` (no `~/` imports):
```ts
export type SalesInvoiceDocument = {
  pdfProps: SalesInvoicePDFProps;          // from @carbon/documents/pdf
  email: Omit<SalesInvoiceEmailProps, "recipient" | "sender" | "locale">;  // from @carbon/documents/email
  invoiceReadableId: string;
  fileName: string;                        // `${company.name} - ${invoiceId}.pdf`
};
export async function loadSalesInvoiceDocument(args: {
  client: SupabaseClient<Database>; companyId: string; companyGroupId: string;
  invoiceId: string; locale: string; storageUrl: string;   // base for public logo URLs
}): Promise<SalesInvoiceDocument>                           // throws on a missing invoice/company/lines/locations/shipment/terms, as the route does
export async function renderSalesInvoicePdf(props: SalesInvoicePDFProps): Promise<Buffer>  // ensureFont + renderToStream, collected into a Buffer
```
   Replicate each read with the exact select listed in this plan's research (company `*` + logo rewrite to `${storageUrl}/storage/v1/object/public/public/<path>`; `companySettings *`; `companyAccountsReceivableBillingAddress *`; `documentTemplate` for `salesInvoice`; sections via `getBuiltInSection` + `documentSection.in(ids)`; `salesInvoices *`; `salesInvoiceLocations *`; `salesInvoiceShipment *`; `salesInvoiceLines * order sortOrder, createdAt`; `terms.salesTerms`; `salesOrder(id, salesOrderId).in(ids)`; active `paymentTerm(id,name)`; active `shippingMethod(id,name)`; `currencies * by code + companyGroupId`). Keep the route's semantics: `accountsReceivableBillingAddress` only when `companySettings.accountsReceivableAddress`; thumbnails only when `templateShowsThumbnails`, via `storage(client).company(companyId).download` → `data:<mime>;base64,…` (HEIC → jpeg transform, non-image → png), exactly as `getBase64ImageFromSupabase`.
2. In the PDF route, keep `requirePermissions({ view: "sales" })` and call `loadSalesInvoiceDocument({ client, companyId, companyGroupId, invoiceId: id, locale, storageUrl: SUPABASE_URL })` (`SUPABASE_URL` from `@carbon/auth`, as `getCompany` uses), then `renderSalesInvoicePdf`. The response headers are unchanged.
3. If adding `@carbon/documents` to `@carbon/lib` makes `pnpm install` report a cycle, or `@carbon/documents` turns out to depend on `@carbon/lib` transitively, STOP and report.
4. `pnpm install` to link the workspace deps.

**Verify:**
```bash
pnpm install && pnpm exec turbo run typecheck --filter=@carbon/lib --filter=erp
# Expected: no new errors
grep -n "getSalesInvoiceLines\|getBase64ImageFromSupabase" "apps/erp/app/routes/file+/sales-invoice+/\$id[.]pdf.tsx"
# Expected: no output (reads moved to the loader)
```
Manual: Task 21 opens an invoice PDF and compares it with one rendered before the change.

**Out of scope:** changing the PDF's content or layout; the quote/order PDF routes.

---

## Task 8: Event type + trigger map entry

**Depends on:** 3
**Files:**
- Modify: `packages/lib/src/events.ts` — add to `Events` (before its closing `};` at ~763)
- Modify: `packages/lib/src/trigger.ts:13-54` — add to `taskToEvent`

**Steps:**
1. Events:
```ts
  "carbon/invoice.automate": {
    data: {
      companyId: string;
      invoiceId: string;
      /** Absent = the agreement's effective mode. The Send route passes "Post and Email". */
      mode?: "Draft Only" | "Post" | "Post and Email";
    };
  };
```
2. `taskToEvent`: `"invoice-automate": "carbon/invoice.automate",`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/lib --filter=@carbon/jobs
# Expected: no new errors
```

**Out of scope:** registering the function (Task 10).

---

## Task 9: `automateSalesInvoice` + tests

**Depends on:** 5, 6, 7, 8
**Files:**
- Create: `packages/jobs/src/invoicing/automate-invoice.ts`
- Create: `packages/jobs/src/invoicing/automate-invoice.test.ts`
- Copy from (precedent): `packages/jobs/src/inngest/functions/integrations/ramp-sync-bill.ts:153-221` (claim/invoke/read-back) and `ramp-sync-bill.test.ts:11-58` (fake client fixture)

**Steps:**
1. Signature:
```ts
export type AutomationOutcome =
  | { outcome: "skipped"; reason: string }
  | { outcome: "held"; reason: string }
  | { outcome: "posted"; emailed: false; sendError: string | null }
  | { outcome: "posted"; emailed: true; sentTo: string };

export async function postSalesInvoiceUnattended(args: {
  client: SupabaseClient<Database>; companyId: string; invoiceId: string;
}): Promise<{ outcome: "skipped" | "held" | "posted"; reason?: string }>

export async function emailPostedInvoice(args: {
  client: SupabaseClient<Database>; companyId: string; companyGroupId: string; invoiceId: string;
}): Promise<{ emailed: boolean; sentTo?: string; sendError?: string }>

export async function resolveInvoiceAutomation(client, companyId, invoiceId): Promise<InvoiceAutomation | null>
// reads the invoice's rental agreement (first salesInvoiceLine.rentalAgreementId) → rentalAgreements.effectiveInvoiceAutomation; null when not a rental invoice
```
2. `postSalesInvoiceUnattended`, in order:
   1. Read `salesInvoice` (`status, automationHoldReason, customerId, invoiceCustomerId, invoiceCustomerContactId, invoiceCustomerLocationId, opportunityId`) scoped by `companyId`, `maybeSingle`. Missing → `skipped`. Already `Submitted` (or any posted status) → `posted` (idempotent retry). Not Draft → `skipped`. `automationHoldReason` set → `held` with that reason.
   2. `checkPartyContactRequirement(client, companyId, { kind: "customer", id: invoiceCustomerId ?? customerId })` from `@carbon/lib/party-contact.server`. Copy the argument shape from `$invoiceId.post.tsx:523-549`; if that route passes contact/location ids in a different shape, mirror it exactly. A non-null message → write `automationHoldReason` = message → `held`.
   3. `evaluateSalesRulesForSalesDocument({ client, companyId, userId: "system", documentType: "salesInvoice", documentId: invoiceId })` from `@carbon/ee/rules.server`, then `dedupeViolations`. Any violation → hold reason `Sales rule: ${messages.join("; ")}` → `held`. A thrown error → hold reason `Sales rule evaluation failed: <message>` → `held`. If importing `@carbon/ee/rules.server` fails to load in the vitest environment, mock it in the test with `vi.mock`; if it fails to TYPECHECK from `@carbon/jobs`, STOP and report.
   4. Claim: `update({ status: "Pending" }).eq("id").eq("companyId").eq("status","Draft").select("id").maybeSingle()`. No row → `skipped` ("no longer Draft").
   5. `client.functions.invoke("post-sales-invoice", { body: { invoiceId, userId: "system", companyId } })`, wrapped in try/catch to capture `postError`.
   6. Read status back. `Submitted` → `raiseMoment("invoicing.salesInvoicePosted", { outputs: { salesInvoice: { id: invoiceId }, postedBy: { id: "system" } }, companyId, actorId: null })` → `posted`. Otherwise: `update({ status: "Draft", automationHoldReason: postError ?? "Posting failed" }).eq("status","Pending")`, then also set the hold reason when the status is already Draft (the edge function reset it) → `held`.
3. `emailPostedInvoice`:
   1. Read `salesInvoice` (`sentAt, invoiceCustomerContactId, customerId, createdBy, opportunityId, invoiceId`). `sentAt` set → `{ emailed: false }` (idempotent).
   2. Contact email: `customerContact` → `contact(email, firstName, lastName)` by `invoiceCustomerContactId`. No email → `update({ sendError: RENTAL_SEND_NO_EMAIL })` → `{ emailed: false, sendError }`.
   3. `loadSalesInvoiceDocument({ … locale: "en-US", storageUrl: SUPABASE_INTERNAL_URL })` (`@carbon/env`, as `print-job/renderers.tsx:124`) and `renderSalesInvoicePdf`.
   4. Upload to `${companyId}/${opportunityId ? `opportunity/${opportunityId}` : `sales-invoice/${invoiceId}`}/${fileName}` with `storage(client).company(companyId).upload(path, buffer, { contentType: "application/pdf", upsert: true })`. Insert a `document` row with the same fields as ERP `upsertDocument`'s insert branch (`apps/erp/app/modules/documents/documents.service.ts:178`): `path, name, size (KB, rounded), sourceDocument: "Sales Invoice", sourceDocumentId, readGroups/writeGroups: [createdBy], createdBy: "system", companyId, type`. If `type` comes from a helper (`getDocumentType`) that isn't in a package jobs can import, STOP and report.
   5. Render `SalesInvoiceEmail` (`@carbon/documents/email`) with `renderAsync` (html + plain text, as `$invoiceId.post.tsx`), recipient = the contact, sender = `{ firstName: company.name, lastName: "", email: replyTo }`.
   6. Reply-To = `companySettings.accountsReceivableEmail`, else the agreement owner's `user.email` (the invoice's `rentalAgreementId` → `rentalAgreement.salesPersonId ?? createdBy` → `user.email`). From = `` `"${company.name}" <${address}>` `` where `address` is the `<…>` part of `DEFAULT_FROM` (or all of it when there are no brackets). CC = `customer.defaultCc` if non-empty, else `companySettings.defaultCustomerCc`, plus the receivables email when set, de-duplicated. Subject: `` `Invoice ${invoiceId} from ${company.name}` ``. Attachment: `{ filename: fileName, content: buffer.toString("base64") }`. Confirm against `email.server.ts:121-125` that `content` is expected base64; if it expects raw, adapt.
   7. `sendEmail(...)` from `@carbon/lib/email.server`. Error → `update({ sendError: error.message })`. Success → `update({ sentAt: now, sentTo: [to, ...cc].join(", "), sendError: null })`. Use the timestamp helper the codebase uses (`datetime.timestamp()` from `@carbon/utils`, as `updateRentalAgreement`); no JS `Date`.
4. Tests (fake client in the style of `ramp-sync-bill.test.ts`; `vi.mock` `@carbon/ee/rules.server`, `@carbon/lib/party-contact.server`, `@carbon/lib/sales-invoice-document.server`, `@carbon/lib/email.server`, `@carbon/lib/workflows`):
   - Draft, no rules, invoke → Submitted ⇒ `posted`, the moment is raised once.
   - Already Submitted ⇒ `posted`, invoke not called.
   - `automationHoldReason` set ⇒ `held`, invoke not called.
   - A sales-rule warning ⇒ `held` with "Sales rule:" prefix, the status stays Draft.
   - Contact requirement message ⇒ `held`.
   - Claim loses the race (status already Pending) ⇒ `skipped`, invoke not called.
   - Invoke throws, status left Pending ⇒ status reset to Draft, hold reason = the thrown message.
   - Invoke error, edge function reset to Draft ⇒ `held` with its message.
   - Email: `sentAt` set ⇒ `sendEmail` not called.
   - Email: contact without email ⇒ `sendError` = `RENTAL_SEND_NO_EMAIL`, no send.
   - Email: success ⇒ `sentAt` stamped, From contains the company name, Reply-To = receivables email.
   - Email: `sendEmail` returns an error ⇒ `sendError` stamped, `sentAt` null.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- automate-invoice
# Expected: 12 passed, 0 failed
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: no new errors
```

**Out of scope:** the Inngest function (Task 10); any change to `post-sales-invoice`.

---

## Task 10: Inngest wiring — automate function, cron steps, digest

**Depends on:** 9, 11
**Files:**
- Create: `packages/jobs/src/inngest/functions/tasks/invoice-automate.ts`
- Modify: `packages/jobs/src/inngest/functions/tasks/index.ts` — export it
- Modify: `packages/jobs/src/inngest/index.ts` — import (~81-103) and add to the `// Tasks` section of the `functions` array (~130-151)
- Rename: `packages/jobs/src/inngest/functions/scheduled/rental-billing.ts` → `scheduled/recurring-billing.ts` (`git mv`; function id and export `recurring-billing` / `recurringBillingFunction`; update the import and `functions` array in `packages/jobs/src/inngest/index.ts` and any test or doc naming it). One daily job drafts every recurring source — rental agreements now, contracts later (`.ai/specs/2026-10-02-contracts.md`, U4)
- Create: `packages/jobs/src/invoicing/digest.ts` + `digest.test.ts`
- Copy from (precedent): `functions/tasks/post-transaction.ts:8-11` (event function), `company-import.ts:50` (concurrency), `scheduled/schedule-inputs-changed.ts:374-384` (digest `step.sendEvent`)

**Steps:**
1. The task function:
```ts
export const invoiceAutomateFunction = inngest.createFunction(
  { id: "invoice-automate", retries: 2, concurrency: { key: "event.data.invoiceId", limit: 1 } },
  { event: "carbon/invoice.automate" },
  async ({ event, step }) => { … }
);
```
   Body: `mode = event.data.mode ?? (await step.run("resolve-mode", () => resolveInvoiceAutomation(...)))`. Null or `Draft Only` → return. `step.run("post", () => postSalesInvoiceUnattended(...))`. If posted and `mode === "Post and Email"`: `step.run("email", () => emailPostedInvoice(...))`. `companyGroupId` is read from `company.companyGroupId` inside the email step.
2. The cron (`scheduled/recurring-billing.ts`, renamed above): per company, keep the draft step (it now returns `invoices`). Then, for each invoice with `mode !== "Draft Only"` and `holdReason === null`, run `step.run(\`post-${invoiceId}\`)` and, when posted and `Post and Email`, `step.run(\`email-${invoiceId}\`)`, calling the same two functions. Collect `{ posted, emailed, held: invoiceIds[], unsent: invoiceIds[] }`. Pre-held invoices (from the planner) count as held. Replace the comment at :56 with: "Drafts, then posts and emails per the agreement's invoice automation (spec 2026-10-02-rental-invoice-automation)."
3. Digests (plan-level decision 9). Track every result per invoice as `{ invoiceId, rentalAgreementId, outcome }`, the planner's pre-held invoices included. After a company's invoices, if anything was posted, emailed or held:
   1. Read owners in ONE query: `selectFrom("rentalAgreement").select(["id","salesPersonId","createdBy"]).where("companyId","=",companyId).where("id","in",agreementIds)`. Owner = `salesPersonId ?? createdBy`. Skip `"system"` and any id with no `userToCompany` row for the company (one `.in()` read).
   2. Read `companySettings.invoiceNotificationGroup` (`groupIds`).
   3. For each owner NOT present in `groupIds`: `step.sendEvent(\`notify-recurring-invoicing-${companyId}-${ownerId}\`, { name: "carbon/notify", data: { event: NotificationEvent.RecurringInvoicing, companyId, documentIds, recipient: { type: "user", userId: ownerId }, body } })`. `body` and `documentIds` are computed over that owner's invoices only.
   4. If `groupIds` is non-empty: one company-wide event with `recipient: { type: "group", groupIds }` over all invoices.
   5. `body = \`${posted} posted, ${emailed} emailed, ${needReview} need review\``. `documentIds` = held + unsent ids; when that's empty, use the posted ids (`notify` throws NonRetriable when an event has neither content nor documentIds).
   6. Put the grouping in a pure helper `buildRecurringInvoicingDigests(results, owners, groupIds)` in `packages/jobs/src/invoicing/digest.ts`, with a vitest file covering: two owners get separate digests over their own invoices; an owner listed in `groupIds` gets no owner digest; an empty group sends only owner digests; nothing to report → no digests.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=erp
# Expected: no new errors
grep -n "invoiceAutomateFunction" packages/jobs/src/inngest/index.ts
# Expected: one import + one array entry
pnpm --filter @carbon/jobs test -- digest
# Expected: 4 passed, 0 failed
```

**Out of scope:** changing the cron schedule or retries.

---

## Task 11: `RecurringInvoicing` notification event

**Depends on:** 3
**Files:**
- Modify: `packages/notifications/src/index.ts` — enum (11-60): `RecurringInvoicing = "recurring-invoicing"`; `getNotificationTopic` (Sales group, ~180-184); `getNotificationEmailHeading` ("Recurring invoicing summary"); `getNotificationEmailCtaLabel` ("Review invoices")
- Modify: `packages/jobs/src/inngest/functions/notifications/content.ts` — `buildEventContent` case
- Modify: `packages/jobs/src/inngest/functions/notifications/notify.ts:47-195` — `defaultDestinations[RecurringInvoicing] = [InApp, Email]` (copy the array literal used by another Sales event)
- Modify: `apps/erp/app/components/Layout/Topbar/Notifications.tsx:267-539` — `GenericNotification` case
- Modify: `apps/erp/app/routes/api+/link.ts:18-111` — `resolve()` case → `${path.to.invoicingSales}?filter=needsReview:eq:true`
- Copy from (precedent): the `IntegrationSync` case (payload-carried text) in `content.ts:1358-1363`, and its `Notifications.tsx` case

**Steps:**
1. `buildEventContent`: description `Recurring invoicing: ${payload.body}`, no per-document reads.
2. `Notifications.tsx`: title "Recurring invoicing", description = the notification's body, link to the Needs Review filter. Mirror how the IntegrationSync case reads its payload text. If that case does not exist or reads a different field, STOP and report which payload field carries `body`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/notifications --filter=@carbon/jobs --filter=erp
# Expected: no new errors
grep -rn "RecurringInvoicing" packages/notifications/src/index.ts packages/jobs/src/inngest/functions/notifications apps/erp/app/components/Layout/Topbar/Notifications.tsx apps/erp/app/routes/api+/link.ts | wc -l
# Expected: >= 7
```

**Out of scope:** email preview fixtures (none exist for payload-carried events); new notification topics.

---

## Task 12: Manual post route — shared PDF, storage path fix, sent stamps

**Depends on:** 7
**Files:**
- Modify: `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.post.tsx`

**Steps:**
1. Replace the `pdfLoader(...)` call and `arrayBuffer` (:777-799) with `loadSalesInvoiceDocument({ client: serviceRole, companyId, companyGroupId, invoiceId, locale: locales?.[0] ?? "en-US", storageUrl: SUPABASE_URL })` + `renderSalesInvoicePdf`. Get `companyGroupId` from `requirePermissions`; if it isn't returned there, read it the way `$id[.]pdf.tsx` does.
2. :802 path → `` `${companyId}/${opportunityId ? `opportunity/${opportunityId}` : `sales-invoice/${invoiceId}`}/${fileName}` ``. Leave the Stripe helper's guard (:85) alone.
3. Email branch (:962-980): right after `trigger("send-email", …)` succeeds, `serviceRole.from("salesInvoice").update({ sentAt: datetime.timestamp(), sentTo: [contactEmail, ...(cc ?? [])].join(", "), sendError: null }).eq("id", invoiceId).eq("companyId", companyId)`. In the catch at :980: `update({ sendError: "Failed to send email" })`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no new errors
grep -n "opportunity/\${salesInvoice.data.opportunityId}" "apps/erp/app/routes/x+/sales-invoice+/\$invoiceId.post.tsx"
# Expected: no output
```

**Out of scope:** the Stripe branch; the sales-rule/contact checks; the modal.

---

## Task 13: Settings models/services + Settings → Invoicing page (moving two cards)

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — `invoiceAutomations` const + `invoiceAutomationValidator` (precedent `kanbanOutputTypes` :33 / `kanbanOutputValidator` :243-245); `rentalInvoiceNotificationValidator` (precedent `rfqReadyValidator` :347-351)
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — `updateInvoiceAutomationSetting(client, companyId, mode)` and `updateRentalInvoiceNotificationSetting(client, companyId, group)` (precedent `updateRfqReadySetting` :1395-1405, both `/** @mcp update */`)
- Create: `apps/erp/app/routes/x+/settings+/invoicing.tsx`
- Modify: `apps/erp/app/routes/x+/settings+/sales.tsx` — remove the moved intents, cards and state
- Modify: `apps/erp/app/utils/path.ts` — `invoicingSettings: \`${x}/settings/invoicing\`` after `invoicingSales` (~1346)
- Modify: `apps/erp/app/modules/settings/ui/useSettingsSubmodules.tsx` — Modules group entry between Inventory (~109) and Items (~115): `{ name: t\`Invoicing\`, to: path.to.invoicingSettings, role: "employee", icon: <LuFileText /> }`
- Copy from (precedent): `routes/x+/settings+/sales.tsx` (page shell :377-384, cards), `routes/x+/settings+/inventory.tsx:235-275` (enum Select card)

**Steps:**
1. `invoiceAutomations = ["Draft Only", "Post", "Post and Email"] as const` with a comment that it mirrors the DB enum. `invoiceAutomationValidator = z.object({ invoiceAutomation: z.enum(invoiceAutomations) })`.
2. `invoicing.tsx`: loader `requirePermissions({ view: "settings" })` + `getCompanySettings` + `getAccountsReceivableBillingAddress` (same redirect as sales.tsx:78-85). Action `requirePermissions({ update: "settings" })` + `switch (intent)` with:
   - `invoiceAutomation` → `updateInvoiceAutomationSetting`
   - `receivablesEmail` → `accountsReceivableEmailValidator` + `updateAccountsReceivableEmail` (both exist, unused)
   - `rentalInvoiceNotifications` → `updateRentalInvoiceNotificationSetting`
   - `emails`, `accountsReceivableAddressToggle`, `accountsReceivableBillingAddress` → moved verbatim from sales.tsx (:265-290, :117-130, :240-263)
3. JSX, in order:
   - "Recurring Invoices" card (enum Select; labels `Draft only` / `Post` / `Post and email`; description from spec UI Changes)
   - "Receivables Email" card (`Input name="accountsReceivableEmail"`)
   - "Notifications" card: description "Each agreement's salesperson (or its creator) gets a daily summary of their rental invoices." plus `Users name="invoiceNotificationGroup" type="employee"` labelled "Also notify", with helper text "Gets the summary for every agreement"
   - then the moved Emails card (sales.tsx:390-431, fixing its spinner check to `intent === "emails"`)
   - the Centralized Billing Address card plus nested form (:480-580) with its state/handlers (:299-374).
4. Delete those three intents, the two cards, their state, the AR-address loader read and now-unused imports from `sales.tsx`. The "Require a Customer Contact and Location" card (:432-479) STAYS in sales.tsx.
5. All strings in `<Trans>`/`t`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no new errors
grep -n "defaultCustomerCc\|accountsReceivableBillingAddress" "apps/erp/app/routes/x+/settings+/sales.tsx"
# Expected: no output
```

**Out of scope:** moving any other card; the AP address/email.

---

## Task 14: Agreement override — model, service, update route, properties field

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — `invoiceAutomations` const next to `rentalBillingCycles` (:1376); `rentalAgreementInvoiceAutomationValidator = z.object({ invoiceAutomation: z.enum(invoiceAutomations).nullable() })`
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — `updateRentalAgreementInvoiceAutomation` after `updateRentalAgreement` (:8690-8729)
- Modify: `apps/erp/app/routes/x+/rental-agreement+/update.tsx` — `intent === "invoiceAutomation"` branch BEFORE the `isTermField` check (:66-78)
- Modify: `apps/erp/app/routes/x+/rental-agreement+/$id.tsx` — loader adds `contactEmail` (customerContact → contact(email)) to the `Promise.all` at :63-73 and returns it
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementProperties.tsx` — Invoicing Select
- Copy from (precedent): the billingCycle field `RentalAgreementProperties.tsx:299-314`; `rentalRefusal` `sales.service.ts:8680`

**Steps:**
1. The service:
```ts
/** @mcp update */
export async function updateRentalAgreementInvoiceAutomation(
  client: SupabaseClient<Database>,
  args: { id: string; companyId: string; invoiceAutomation: InvoiceAutomation | null; updatedBy: string }
)
```
   It reads the agreement (`status, customerContactId`) under `companyId`. Not Draft/Active → `rentalRefusal("RENTAL_AGREEMENT_CLOSED", "Invoicing can only be changed on a Draft or Active agreement")`. `invoiceAutomation === "Post and Email"` and the contact's `contact.email` is empty → `rentalRefusal("RENTAL_INVOICE_EMAIL_NO_CONTACT", "Add a contact with an email to send invoices")`. Otherwise `update(sanitize({ invoiceAutomation, updatedBy, updatedAt: datetime.timestamp() })).eq("id").eq("companyId")`.
2. `update.tsx`: when `formData.get("intent") === "invoiceAutomation"`, validate `{ invoiceAutomation: value === "" ? null : value }` with the new validator, call the service, and return `{ error, data }` in the route's existing shape. Same `requirePermissions({ update: "sales" })`.
3. Properties: a `Select` named `invoiceAutomation`, label "Invoicing", options `[{ value: "", label: \`Company default (${companyLabel})\` }, ...modes]`, where `companyLabel` comes from `useSettings().invoiceAutomation`. "Post and email" is `disabled` when `!contactEmail`, with helper text "Add a contact with an email to send invoices". If `Select` options don't support `disabled`, filter the option out and show the helper text instead. The field is read-only unless `["Draft","Active"].includes(agreement.status) && permissions.can("update","sales")`. `onChange` submits FormData `{ id, intent: "invoiceAutomation", value }` to `path.to.rentalAgreementUpdate` via the panel's `fetcher`. Under the field, when `agreement.effectiveInvoiceAutomation === "Post and Email" && !contactEmail`, show the note "Invoices will be posted but not emailed — the contact has no email".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no new errors
grep -n "updateRentalAgreementInvoiceAutomation" apps/erp/app/modules/sales/sales.service.ts "apps/erp/app/routes/x+/rental-agreement+/update.tsx"
# Expected: definition + one call
```

**Out of scope:** `updateRentalAgreement` and its Draft guard; `TERM_FIELDS`.

---

## Task 14b: Agreement shows invoicing is automatic; button becomes "Invoice Now"

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementHeader.tsx` — the header button (:186-195) and the `invoice` confirm copy (:116-121)
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementSummary.tsx` — under the "Next Due:" row (:142-153)
- Copy from (precedent): the "Next Due:" `HStack` itself (`text-sm text-muted-foreground`) and `DateTime` usage at :147-148

**Steps:**
1. Header button: label `<Trans>Invoice Now</Trans>`, `variant="secondary"` always. Drop the `allPeriodsBilled ? … : "primary"` switch, since a primary button reads as a chore. If `allPeriodsBilled` is then unused, remove it. Keep the icon, the `isActive` gate and `canUpdate`.
2. Confirm copy: title `Invoice ${readableId} now`; text "Invoices are created automatically every day for whatever is due. Use this to bill what's due right away — for example after adding a charge. Invoices then follow this agreement's invoicing setting."; confirmText `Invoice Now`.
3. Summary: below the Next Due row, one muted line (`text-xs text-muted-foreground`) derived from `rentalAgreement.status`, `rentalAgreement.nextDueOn` and `rentalAgreement.effectiveInvoiceAutomation` (view column from Task 2). Put the choice in a small pure function at the bottom of the file, `invoicingScheduleText(status, nextDueOn, mode)`, returning a Lingui message:
   - Draft → "Invoices are created automatically once the agreement is active."
   - Active, `nextDueOn` set → `Post and Email`: "Next invoice {date} is created automatically, then posted and emailed." `Post`: "…, then posted." `Draft Only`: "…, and left as a draft for review." `{date}` is rendered with `<DateTime value={nextDueOn} variant="date" />` (compose with `<Trans>` placeholders, as other Rentals components do).
   - Active, no `nextDueOn` → "Nothing is due. Invoices are created automatically when a period comes due."
   - Closed / Cancelled → render nothing.
4. All strings via Lingui. No JS `Date`: `nextDueOn` is a `YYYY-MM-DD` string passed straight to `DateTime`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no new errors
grep -n "\"primary\"" apps/erp/app/modules/sales/ui/Rentals/RentalAgreementHeader.tsx
# Expected: no match on the Invoice Now button (other buttons may still be primary)
```

**Out of scope:** the generate route's behaviour (Task 15); the properties panel (Task 14).

---

## Task 15: Generate Invoices / Sell to Customer fire automation

**Depends on:** 5, 8
**Files:**
- Modify: `apps/erp/app/routes/x+/rental-agreement+/$id.invoice.tsx`
- Modify: `apps/erp/app/routes/x+/rental-agreement+/$id.$lineId.sell.tsx:148-178`
- Copy from (precedent): `batchTrigger` in `packages/lib/src/trigger.ts`; ERP `trigger` import `apps/erp/app/routes/api+/webhook.ramp.$companyId.ts:114`

**Steps:**
1. After generating, `const toAutomate = invoices.filter(i => i.mode !== "Draft Only" && !i.holdReason)`. If non-empty, `await batchTrigger("invoice-automate", toAutomate.map(i => ({ payload: { companyId, invoiceId: i.invoiceId } })))` (import from `@carbon/jobs`, as `trigger` is; if `batchTrigger` isn't re-exported there, loop `trigger`).
2. Flash in `$id.invoice.tsx`: when `toAutomate.length > 0`, "Generated N invoice(s); posting M automatically". Otherwise keep today's message. Sell to Customer only produces a held charges invoice under automation, so its flash is unchanged and nothing is triggered unless `toAutomate` is non-empty.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no new errors
```

**Out of scope:** posting synchronously in the route.

---

## Task 16: Agreement cards show held invoices

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/routes/x+/rental-agreement+/$id.tsx:77-91,138-146` — select `salesInvoice(id, invoiceId, status, automationHoldReason)`
- Modify: `apps/erp/app/modules/sales/ui/Rentals/types.ts` — `RentalInvoiceLinks` value gains `status: string | null; automationHoldReason: string | null`
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalBillingPeriods.tsx:139-147` and `RentalAgreementCharges.tsx:139-146`
- Copy from (precedent): the adjustment `<Badge variant="orange">` at `RentalBillingPeriods.tsx:119-123`

**Steps:**
1. In both Invoice cells, after the hyperlink: when `status === "Draft" && automationHoldReason`, render `<Badge variant="orange">` with the text "Held" and a tooltip/title of the reason. Use whatever tooltip wrapper the Rentals UI already uses; if none, put the reason in the badge's `title`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no new errors
```

**Out of scope:** a new invoices list on the agreement.

---

## Task 17: Invoice header badges + Send route

**Depends on:** 8
**Files:**
- Modify: `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceHeader.tsx` (status area :320-332)
- Create: `apps/erp/app/routes/x+/sales-invoice+/$invoiceId.send.tsx`
- Modify: `apps/erp/app/utils/path.ts` — `salesInvoiceSend: (id: string) => generatePath(\`${x}/sales-invoice/${id}/send\`)` next to `salesInvoicePost` (match its exact style)
- Copy from (precedent): `PurchaseInvoiceHeader.tsx:333-337` (`<Status color="red">`); an action-only route such as `x+/rental-agreement+/$id.invoice.tsx`

**Steps:**
1. Header, after `<SalesInvoiceStatus>`:
   - `status === "Draft" && automationHoldReason` → `<Status color="orange" title={reason}>Held</Status>`.
   - Posted with `sentAt` → `<Status color="green">Emailed</Status>` with title `` `To ${sentTo} on ${formatDate(sentAt)}` `` (`formatDate` from `@carbon/utils`).
   - Posted with `sendError && !sentAt` → `<Status color="red" title={sendError}>Not sent</Status>` plus a "Send" button (`Button variant="secondary"`, `LuSend` icon) that submits a fetcher POST to `path.to.salesInvoiceSend(id)`, disabled without `permissions.can("update","invoicing")`.
2. Route: `requirePermissions({ update: "invoicing" })`; re-read the invoice under `companyId` (404 on miss). Refuse unless it is posted and `sentAt` is null. `trigger("invoice-automate", { companyId, invoiceId, mode: "Post and Email" })`. Redirect back with flash "Sending invoice".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no new errors
```

**Out of scope:** the post modal; Stripe sending.

---

## Task 18: Invoices list — needsReview column + Needs Review link

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts:72-73` — append `needsReview, automationHoldReason, sendError, sentAt` to `SALES_INVOICES_LIST_COLUMNS`
- Modify: `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoicesTable.tsx` — a hidden-by-default boolean `needsReview` column with `meta.filter: { type: "static", options: [{ value: "true", label: t\`Yes\` }, { value: "false", label: t\`No\` }] }` (precedent: the status column :126-145)
- Modify: `apps/erp/app/modules/invoicing/ui/useInvoicingSubmodules.tsx:89-95` — under Accounts Receivable, after Sales Invoices: `{ name: t\`Needs Review\`, to: \`${path.to.invoicingSales}?filter=needsReview:eq:true\`, icon: <LuTriangleAlert /> }` (match the sibling entries' fields)

**Steps:**
1. Find how the table declares a column hidden by default (`defaultColumnVisibility` or similar). If no such mechanism exists, show the column.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no new errors
```

**Out of scope:** system-wide saved views.

---

## Task 19: MCP metadata, lint, i18n, scoped typechecks, tests

**Depends on:** 4–18 (including 5b)
**Files:** generated MCP metadata, `.po` catalogs

**Steps:**
1. `pnpm run generate:mcp` (new `@mcp update` services: `updateRentalAgreementInvoiceAutomation`, `updateInvoiceAutomationSetting`, `updateRentalInvoiceNotificationSetting`).
2. `pnpm --filter @carbon/checks license-headers` (new files).
3. `pnpm run lint`.
4. `/translate` for the new Lingui strings.
5. The scoped typechecks and tests below.

**Verify:**
```bash
pnpm run lint
# Expected: no errors
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs --filter=@carbon/lib --filter=@carbon/database --filter=@carbon/notifications
# Expected: no errors beyond the Task 1 baseline
pnpm --filter @carbon/database test && pnpm --filter @carbon/jobs test && pnpm --filter @carbon/lib test
# Expected: all pass
pnpm --filter @carbon/checks lint
# Expected: no new findings (spdx-license-header, no-db-client-in-service, no-raw-rounding)
```

**Out of scope:** whole-repo typecheck.

---

## Task 20: Docs — AGENTS.md, rules, spec changelog

**Depends on:** 19
**Files:**
- Modify: `apps/erp/app/modules/sales/AGENTS.md` — Rentals "Invoice generation" bullet (:140): drafts AND automates (mode, split, holds, the automate event, the Send route); remove "Only drafts — posting stays human." Add to the `rentalBillingPeriod` / `rentalAgreementCharge` table rows: `voidedSalesInvoiceId`, set by VOID, makes the re-bill a held draft, sticky across a deleted draft.
- Modify: `apps/erp/app/modules/settings/AGENTS.md` — the Invoicing settings page and its cards
- Modify: `apps/erp/app/modules/invoicing/AGENTS.md` — `automationHoldReason`/`sentAt`/`sentTo`/`sendError`, `needsReview`, the send route, the storage path for invoices without an opportunity
- Modify: `.ai/specs/2026-10-02-rental-invoice-automation.md` — fold in this plan's "Plan-level decisions"; Changelog line; status `in-progress`

**Verify:**
```bash
grep -n "posting stays human" apps/erp/app/modules/sales/AGENTS.md
# Expected: no output
```

**Out of scope:** moving the spec to `implemented/` (needs the user's OK).

---

## Task 21: Browser verification (`/test`)

**Depends on:** 20
**Files:** playbook under `.ai/playbooks/` if `/test` writes one

**Steps:**
Use `/test` (needs `crbn up`; ask the user before starting it). Then:
1. Settings → Invoicing shows five cards. Saving each persists (reload). Settings → Sales no longer shows Emails or Centralized Billing Address.
2. On an Active agreement whose contact has an email, with a due period: set Invoicing to "Post and email", click Generate Invoices, and wait for the Inngest run. The invoice becomes Submitted with an "Emailed" badge, and the email arrives (local SMTP catcher) with From "<Company>" and Reply-To = the receivables email.
3. Add a damage charge and generate. A second Draft invoice shows "Held", and the agreement's Charges card shows "Held".
4. Clear the contact's email. The "Post and email" option is disabled and the note shows when the company default is Post and email. Generate: the invoice is Submitted with "Not sent". Click Send after restoring the email: it becomes "Emailed".
5. Receivables → Needs Review lists the held and unsent invoices.
6. Open a rental invoice PDF (`file/sales-invoice/<id>.pdf`) and a non-rental invoice PDF. Both render as before.
7. With NO notification group set, run the cron via the Inngest dev UI ("Invoke" `recurring-billing`). The agreement's salesperson (or creator) gets one "Recurring invoicing" notification, in the topbar and by email. Then add a different user to "Also notify" and re-run with a new due period: that user also gets one.
8. Void the posted rent invoice from step 2 (⋯ → Void). The agreement's Billing Periods card shows the period Pending again. Click Invoice (Generate Invoices): the new rent invoice is Draft and "Held" with "Re-billing INV-…, which was voided", and nothing is posted or emailed. Delete that draft and generate again: still held.
9. On an Active agreement the header shows a secondary "Invoice Now" button, and the summary reads "Next invoice <date> is created automatically, then posted and emailed." Switch the agreement to Draft only: the line says "…left as a draft for review."

**Verify:** every step above passes; screenshots saved under `.context/`.

**Out of scope:** Stripe sending.
