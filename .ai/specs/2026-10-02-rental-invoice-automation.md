# Rental Invoice Automation — post and email recurring rental invoices

> Status: draft
> Author: barbinbrad (with Claude)
> Date: 2026-10-02
> Research: `.ai/research/rental-invoice-automation.md`
> Amends: `.ai/specs/2026-09-22-revenue-recognition-and-rentals.md` Decision 10 ("propose-only Draft invoices") — reversed for rentals, see D1
> Shared layer (2026-10-02): this automation is the source-agnostic **recurring-invoicing layer** — one mode list (`invoiceAutomation`), one company default + per-document override, one pipeline in `packages/jobs/src/invoicing/` (`automateSalesInvoice`), one daily `recurring-billing` job and one "Recurring invoicing" digest. Rental agreements are its first source; AR contracts (`.ai/specs/2026-10-02-contracts.md`) plug in as the second and add the `Post and Send via Stripe` mode. Names were generalized before any code existed; behaviour for rentals is unchanged. Decisions: `.ai/runs/2026-10-02-grill-subscriptions.md` (U1–U4, G4b, G7).

## TLDR

The daily `rental-billing` job drafts one invoice per rental agreement, and then someone has to open, post and email each one by hand, every billing cycle, for every agreement. This spec adds an **invoice automation** setting with three modes: `Draft Only`, `Post` and `Post and Email`. It is set company-wide on a new **Settings → Invoicing** page, defaults to `Post and Email`, and can be overridden per agreement. Rent invoices are posted (and emailed) in the same run that drafts them.

Anything that needs a human eye is left in Draft with a reason:
- hand-entered charges, split onto their own Draft invoice so the rent is never delayed;
- early-return credits;
- sales-rule violations;
- a missing required contact;
- posting failures such as a locked period.

An invoice whose contact has no email is posted and flagged, not sent. A daily notification tells each agreement's internal owner (salesperson, else creator) what was posted, emailed and held, with no setup; an optional "Also notify" group gets the company-wide summary. A voided invoice's re-bill is always held for review.

## Problem Statement

`packages/jobs/src/inngest/functions/scheduled/rental-billing.ts:56` says it plainly: "Posting stays a human action in the ERP; this only drafts invoices."

- A fleet of 40 agreements on calendar-month billing produces 40 Draft invoices on the 1st. Each one needs a person to open it, press Post, choose Email and confirm.
- The invoices are fully determined by the agreement's terms, so the human adds nothing on the normal path. The research found that every peer system lets that path run unattended: NetSuite bill runs, Business Central's Subscription Billing, Odoo, Xero "Approve for sending", QuickBooks "Scheduled" and Stripe `auto_advance`.
- Hidden bug on today's manual path: posting a rental invoice with Send Via = Email uploads the PDF to `${companyId}/opportunity/null/…`. Rental invoices have `opportunityId: null`, and the email branch of `$invoiceId.post.tsx:802` doesn't guard for it; only the Stripe branch does (`:85`). This spec fixes it as a side effect (D12).

## Proposed Solution

### Flow

```
recurring-billing cron (05:00 UTC, per company step; renamed from `rental-billing`)
  └─ createRentalInvoicesForDuePeriods            (packages/database/src/rental-billing.ts)
       ├─ effective mode = agreement.invoiceAutomation ?? companySettings.invoiceAutomation
       ├─ Draft Only  → one Draft invoice per agreement (today's behaviour, unchanged)
       └─ Post / Post and Email →
            ├─ RENT invoice:    every due rent period (incl. early-return adjustments)
            │                   held when it re-bills a voided invoice's rows (D26) or carries an early-return adjustment
            └─ CHARGES invoice: every due charge (Charge + Purchase Option), always Draft,
                                automationHoldReason = "charges are reviewed before posting"
       returns [{ invoiceId, rentalAgreementId, mode, holdReason }]
  └─ per unheld invoice: step.run("automate-<invoiceId>") → automateSalesInvoice()
  └─ notify → one digest per agreement owner (salesPersonId ?? createdBy) + one company-wide digest to the "Also notify" group

automateSalesInvoice(invoiceId, mode)          (packages/jobs/src/invoicing/automate-invoice.ts)
  1. re-read invoice; skip unless status = Draft and automationHoldReason IS NULL
  2. contact requirement (checkPartyContactRequirement, moved to a package)  → hold on fail
  3. evaluateSalesRulesForSalesDocument("salesInvoice") — ANY violation           → hold
  4. claim: UPDATE status = 'Pending' WHERE status = 'Draft'   (0 rows → someone else has it; stop)
  5. invoke post-sales-invoice (service role, userId "system"); read status back
       not Submitted → reset Pending→Draft, hold with the function's error message
  6. raiseMoment("invoicing.salesInvoicePosted")
  7. mode = Post and Email:
       skip if sentAt IS NOT NULL
       contact email missing → sendError = "The invoice contact has no email" (stays posted)
       else render PDF + email → stamp sentAt / sentTo; on failure stamp sendError
```

"Generate Invoices" (`$id.invoice.tsx`) and "Sell to Customer" (`$id.$lineId.sell.tsx`) call the same generator. They then send `carbon/rental-invoice.automate` events for the invoices it returns. A small event-triggered Inngest function runs the same `automateSalesInvoice`. So pressing the button behaves exactly like the cron, minus the digest.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Reverse "propose-only" for rentals | Yes, rentals only | The user asked for it (2026-10-02). Rental invoices are fully determined by the agreement's terms; the close-automation posture still governs every other proposal job |
| D2 | Modes | `Draft Only` / `Post` / `Post and Email`, a new enum `invoiceAutomation` | The three levels every peer system offers (research). `Post` without email serves customers billed through a portal or EDI |
| D3 | Where it is set | Company default (`companySettings.invoiceAutomation`, NOT NULL DEFAULT `'Post and Email'`) plus a nullable per-agreement override (`rentalAgreement.invoiceAutomation`, NULL = company default) | User decision. Follows the flat-default-plus-override shape `.ai/lessons.md` prescribes (`customer.defaultCc` → `companySettings.defaultCustomerCc`). No customer level (user decision) |
| D4 | Default | `Post and Email` | User decision. Rentals are not on `main`, so no existing company changes behaviour on deploy |
| D5 | `Post and Email` needs an email | The agreement override can only be SET to `Post and Email` when the agreement's contact has an email (the service refuses it; the UI disables it). At run time, a missing email degrades to post + `sendError`, never a skipped post | User decision. Checked at both ends because a contact's email can be removed after the setting is chosen, and a company default can't be validated per agreement |
| D6 | Review window | None. Posted in the same run that drafts | User decision. So there is no "will post on" date, and no "an edit makes it manual" rule |
| D7 | Charges | When automating, charges (kind `Charge` and `Purchase Option`) go on their OWN Draft invoice, held as "charges are reviewed before posting". Rent periods go on the rent invoice, which posts | User decision. A single charge must not delay the rent. Mirrors NetSuite's Ready/Hold billing stage and Point of Rental's contract hold. `Draft Only` agreements keep today's single combined invoice, since nothing is automated |
| D8 | Holds (left in Draft) | (a) charges invoice; (b) rent invoice carrying an early-return adjustment row; (c) a sales-rule violation of any severity, warnings included; (d) the company requires a customer contact and location and the invoice lacks one; (e) any posting failure (locked or closed period, missing account default, …), with the edge function's message | User decision (holds a–e; first invoice NOT held). The job can't acknowledge a warning, so a warning holds |
| D9 | First invoice | Not held | User decision. The terms were just reviewed at activation |
| D10 | Where automation runs | Inline in the `recurring-billing` cron (renamed from `rental-billing`, U4), one `step.run` per invoice; plus an event-triggered function for the two ERP buttons. Both call one `automateSalesInvoice` | Steps give per-invoice isolation and memoized retries (one failure never stops the run). Sharing one function keeps the button and the cron identical |
| D11 | Double-post protection | A conditional claim `Draft → Pending` before invoking (the `ramp-sync-bill.ts:179-215` pattern); the step re-reads status first, so a retried step after a successful post skips straight to email | `post-sales-invoice` never checks the invoice is Draft. The button event and the cron can race for the same invoice |
| D12 | PDF and email in a job | Extract the sales-invoice PDF data loading into a shared server loader in `@carbon/documents` (takes a supabase client). The ERP PDF route, the manual post route and the job all use it. Storage path is `${companyId}/sales-invoice/${invoiceId}/<file>` when the invoice has no opportunity, `opportunity/<id>/…` otherwise | The route loader needs a session (`requirePermissions` `view: sales`), so a job can't call it. Jobs already render `@carbon/documents` PDFs (`tasks/print-job/renderers.tsx`). Also fixes the `opportunity/null` bug on the manual path |
| D13 | Sender | From: `"<Company name>" <DEFAULT_FROM address>`. Reply-To: `companySettings.accountsReceivableEmail`, else the agreement's owner (`salesPersonId ?? createdBy`) email. To: the invoice contact. CC: `customer.defaultCc` ?? `companySettings.defaultCustomerCc`, plus the receivables email | User decision. Our SMTP can't send AS the customer's domain without SPF/DKIM, so we send from our domain under the company's name and route replies to receivables |
| D14 | Sent tracking | New `salesInvoice.sentAt`, `sentTo`, `sendError`. The manual post modal's Email path stamps them too | Needed for idempotency (never email twice on retry), for the "Needs review" filter, and so a person can see an invoice went out. Stamping on the manual path keeps one meaning for the columns |
| D15 | Hold reason storage | `salesInvoice.automationHoldReason TEXT` (a human-readable message) | Read-only display data; the reasons are open-ended (edge-function errors), so an enum would lose the message. Only meaningful while Draft. Kept after a manual post as history and ignored by the filter |
| D16 | Notification | A new digest event `NotificationEvent.RecurringInvoicing` (documentIds-shaped), at most once per recipient per cron run when anything was posted, emailed or held. **By default each agreement's internal owner (`salesPersonId ?? createdBy`) gets a digest of their agreements' invoices; no setup needed.** `companySettings.invoiceNotificationGroup` (`text[]`, users/groups) is "Also notify": those people get the company-wide digest, and an owner listed in it gets only that one. Delivered in-app and by email | User decisions (daily notification; "a good default should be automatic invoices with notifications to the internal person"). The button path sends none; the person who pressed it is looking at the result |
| D17 | Settings page | A new `x+/settings+/invoicing.tsx`, with a nav entry in `useSettingsSubmodules`. Cards: **Recurring Invoices** (default mode), **Receivables Email** (`accountsReceivableEmail`, which has no UI today), **Notifications** (`invoiceNotificationGroup`), plus **Emails** (default customer CC) and **Centralized Billing Address** MOVED from `settings+/sales.tsx` with their intents and actions | User decision (new page; move the invoice-related cards) |
| D18 | Agreement override editable when | Draft and Active (not Closed / Cancelled), through a dedicated service `updateRentalAgreementInvoiceAutomation` and a dedicated `intent` in `x+/rental-agreement+/update.tsx` that bypasses the Draft-only terms guard | It is an operational preference, not a lease term, and touches no accounting. `updateRentalAgreement` stays Draft-only (it is an MCP tool with its own guard) |
| D19 | Multi-tenancy (heuristic 1) | No new tables. New columns sit on `companySettings` / `rentalAgreement` / `salesInvoice`, all already company-scoped | — |
| D20 | Service shape (heuristic 2) | `updateRentalAgreementInvoiceAutomation(client, …)` returns `{data, error}` and refuses with a PostgrestError-shaped `RENTAL_INVOICE_EMAIL_NO_CONTACT`, like the other `RENTAL_*` codes | Matches the rental service conventions in sales AGENTS |
| D21 | RLS (heuristic 3) | Unchanged. The new columns inherit their tables' policies; the job writes with the service role | — |
| D22 | Permissions (heuristic 4) | Settings → Invoicing: `view: settings` to load, `update: settings` to save (as `settings+/sales.tsx`). The agreement override: `update: sales` | Same scopes as the pages the cards move from |
| D23 | Forms (heuristic 5) | Settings cards are `ValidatedForm` + fetcher intents like `settings+/sales.tsx`. The agreement field saves through the properties-panel pattern | Existing patterns |
| D24 | Module layout (heuristic 6) | Validators in `settings.models.ts` / `sales.models.ts`, services in `settings.service.ts` / `sales.service.ts`. The automation itself lives in `packages/jobs/src/invoicing/` (not an ERP module) | One service/models file per module |
| D25 | Backward compatibility (heuristic 7) | `updateRentalAgreement` (MCP) unchanged. The new service becomes an MCP tool (regenerate the MCP metadata). `checkPartyContactRequirement` moves from `apps/erp/app/modules/settings/party-contact.server.ts` to a package the job can import (`@carbon/database` or `@carbon/ee/rules.server`, to be settled in /plan), and the ERP re-imports it | Nothing frozen is touched |
| D26 | Re-billing after a VOID | VOID stamps `voidedSalesInvoiceId` on the periods and charges it releases; when automating, a rent invoice re-billing any such row is held with "Re-billing INV-…, which was voided". The stamp survives a deleted draft and is overwritten by a later VOID | User decision. Otherwise the next morning's run re-posts and re-emails the same amounts nobody decided to re-bill (an Active agreement's rates are locked) |

## Data Model Changes

One migration (`pnpm db:migrate:new rental-invoice-automation`):

```sql
CREATE TYPE "invoiceAutomation" AS ENUM ('Draft Only', 'Post', 'Post and Email');

ALTER TABLE "companySettings"
  ADD COLUMN "invoiceAutomation" "invoiceAutomation" NOT NULL DEFAULT 'Post and Email',
  ADD COLUMN "invoiceNotificationGroup" TEXT[] NOT NULL DEFAULT '{}';

-- NULL = use the company default
ALTER TABLE "rentalAgreement"
  ADD COLUMN "invoiceAutomation" "invoiceAutomation";

ALTER TABLE "rentalBillingPeriod" ADD COLUMN "voidedSalesInvoiceId" TEXT;
ALTER TABLE "rentalAgreementCharge" ADD COLUMN "voidedSalesInvoiceId" TEXT;

ALTER TABLE "salesInvoice"
  ADD COLUMN "automationHoldReason" TEXT,
  ADD COLUMN "sentAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN "sentTo" TEXT,
  ADD COLUMN "sendError" TEXT;
```

- The `rentalAgreements` view is recreated so it exposes `invoiceAutomation` and the effective mode (`COALESCE(ra."invoiceAutomation", cs."invoiceAutomation")`). Fork the body from its LATEST definition (lesson: backdated view forks).
- `salesInvoices` is recreated only if the list's "Needs review" filter needs a derived column. Prefer filtering on the base columns.
- `accountsReceivableEmail` already exists (`20260304112615`). No change.
- After migrating: `pnpm run generate:types`; `pnpm db:check:datasets` (the satellite dataset seeds rental agreements); `pnpm db:check:backups`.

## API / Service Changes

**`packages/database/src/rental-billing.ts`**
- `createRentalInvoicesForDuePeriods` reads the effective mode per agreement (one join to `companySettings`). When the mode is not `Draft Only` it drafts up to two invoices: rent and charges. It returns `{ invoices: { invoiceId, rentalAgreementId, mode, holdReason }[] }`; keep `invoiceIds` for existing callers or migrate them.
- Rent invoices with an `isAdjustment` row are stamped with the early-return hold.
- Stamping and idempotency are unchanged: periods and charges are stamped in the same transaction.

**`packages/jobs/src/invoicing/automate-invoice.ts`** (new)
- `automateSalesInvoice({ client, db, companyId, invoiceId, mode })` returns `{ outcome: "posted" | "emailed" | "held" | "skipped", reason? }`. The flow is above.
- The hold-reason strings are constants exported from one module, so the UI and tests share them.

**`packages/jobs/src/inngest/functions/scheduled/rental-billing.ts`**
- After the draft step: one `step.run` per unheld invoice, then a `notify` step.

**`packages/jobs/src/inngest/functions/tasks/invoice-automate.ts`** (new)
- Event `carbon/rental-invoice.automate` with `{ companyId, invoiceId }`. Concurrency key `event.data.invoiceId`, limit 1.
- Register it in `packages/jobs/src/inngest/index.ts` and add the event to the client schema.

**`@carbon/documents`**
- A server-side sales-invoice loader, `loadSalesInvoiceDocument(client, companyId, invoiceId)`, returning the `SalesInvoicePDF` props and the `SalesInvoiceEmail` props.
- `routes/file+/sales-invoice+/$id[.]pdf.tsx` and `$invoiceId.post.tsx` switch to it.

**`$invoiceId.post.tsx`**
- Uses the shared loader and the opportunity-or-invoice storage path (D12).
- Stamps `sentAt` / `sentTo` / `sendError` on the Email path.

**`apps/erp/app/modules/sales`**
- `updateRentalAgreementInvoiceAutomation(client, { id, companyId, invoiceAutomation, updatedBy })` (`/** @mcp update */`). Allowed on Draft and Active. Refuses `Post and Email` when the agreement's contact has no email.
- Add `invoiceAutomation` to the validators.

**`apps/erp/app/modules/settings`**
- Validators and services for `invoiceAutomation`, `invoiceNotificationGroup` and `accountsReceivableEmail`. `updateAccountsReceivableEmail` already exists, at `settings.service.ts:1361`.

**`$id.invoice.tsx` / `$id.$lineId.sell.tsx`**
- After generating, send one `carbon/rental-invoice.automate` event per unheld invoice. The flash says "Invoices generated and being posted" when any were sent.

**`@carbon/notifications`**
- `NotificationEvent.RecurringInvoicing` plus its text: "Recurring invoicing: N posted, M emailed, K need review".

## UI Changes

**Settings → Invoicing (new page)**
- **Recurring Invoices** card: a select (Draft only / Post / Post and email) with the description "What happens to rental invoices when they're created each day. Invoices with charges, early-return credits or rule violations always wait for review."
- **Receivables Email**: an email input. Description: "Replies to emailed invoices go here, and it's copied on each one."
- **Notifications**: a users/groups picker, "Who gets the daily rental invoicing summary".
- **Emails** and **Centralized Billing Address**: moved verbatim from Sales settings.

**Rental agreement properties panel**
- A new **Invoicing** select: "Company default (<mode>)" / Draft only / Post / Post and email.
- Post and email is disabled with the hint "Add a contact with an email to send invoices" when the contact has no email.
- When the effective mode is Post and email and the contact has no email: an inline note, "Invoices will be posted but not emailed — the contact has no email".
- Editable while Draft or Active.

**Rental agreement header and summary**
- The header's "Invoice" button becomes a secondary **Invoice Now**. Its dialog explains that invoices are created automatically every day, and the button is for billing right away, e.g. after adding a charge.
- Under "Next Due" the summary states the schedule: "Next invoice <date> is created automatically, then posted and emailed" (or "…then posted" / "…and left as a draft for review"). A Draft agreement reads "Invoices are created automatically once the agreement is active."

**Rental agreement details**
- The invoices list and Billing Periods card show a held invoice's reason, e.g. "Held: charges are reviewed before posting".

**Sales invoice header**
- A Draft invoice with `automationHoldReason` shows a warning badge with the reason.
- A posted invoice shows "Emailed to x@y on <date>", or the `sendError` with a "Send" action that opens the existing post/send modal's email path.

**Sales invoices list**
- A **Needs review** saved filter: Draft with a hold reason, or posted with `sendError` and no `sentAt`.

Follow the `carbon-design` skill for badge and filter conventions. Wrap all strings in Lingui and run `/translate`.

## Acceptance Criteria

- [ ] With the company default `Post and Email`, an Active Calendar-Month agreement whose contact has an email and one due rent period produces, after the cron runs: one sales invoice in `Submitted`, a posted journal, `sentAt` set, and an email to the contact. The email is from "<Company> <no-reply@…>" with Reply-To = the receivables email and the PDF attached at `${companyId}/sales-invoice/<id>/…`.
- [ ] The same agreement set to `Draft Only` produces one Draft invoice holding rent and charges together (today's behaviour), and nothing is posted.
- [ ] With a due rent period and a hand-entered damage charge on a `Post` agreement, the cron produces two invoices: rent `Submitted`, charges `Draft` with the hold "charges are reviewed before posting".
- [ ] A rent invoice carrying an early-return adjustment row stays Draft with the early-return hold.
- [ ] A sales rule that warns on the customer leaves the invoice Draft with the rule's message as the hold reason.
- [ ] With the current accounting period Locked, the invoice ends `Draft` (not `Pending`) and its hold reason is the posting function's message.
- [ ] On a `Post and Email` company default where the contact has no email, the invoice is `Submitted`, `sentAt` is NULL and `sendError` = "The invoice contact has no email". It appears under **Needs review**.
- [ ] Setting an agreement's override to `Post and Email` when its contact has no email is refused (UI disabled; the service returns `RENTAL_INVOICE_EMAIL_NO_CONTACT`).
- [ ] Re-running the cron step for an invoice that is already `Submitted` with `sentAt` set posts and emails nothing. Pressing Generate Invoices while the cron automates the same agreement produces exactly one posted invoice (the claim test).
- [ ] With no notification group configured, an agreement's salesperson (or creator, when none) receives exactly one "Recurring invoicing" notification (in-app and email) per cron run that posted, emailed or held one of their invoices. A user added to "Also notify" additionally receives the company-wide digest, and never two digests for the same run.
- [ ] An Active agreement's header shows a secondary "Invoice Now" button, and its summary states when the next invoice is created and what happens to it, matching the effective mode.
- [ ] Voiding a posted rent invoice and then generating again produces a Draft rent invoice held as "Re-billing INV-…, which was voided"; nothing is posted or emailed. Deleting that draft and generating again holds it again.
- [ ] Posting a non-rental invoice manually with Send Via = Email stamps `sentAt`. A rental invoice posted manually with Email stores its PDF under `sales-invoice/<id>/`, not `opportunity/null/`.
- [ ] Settings → Invoicing shows the five cards. Settings → Sales no longer shows Emails or Centralized Billing Address, and their saves still work from the new page.
- [ ] Unit tests: the generator's split/hold decisions (pure helper) and `automateSalesInvoice`'s outcome per hold case (vitest, mocked clients).

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| An email is sent but the `sentAt` stamp fails, so an Inngest retry sends it twice | Med | Stamp `sentAt` in the same step immediately after `sendEmail` resolves. Give the email step `retries: 0` on the send itself and record `sendError` on any throw, so a human re-sends rather than the job |
| An invoice is stuck in `Pending` when the `invoke` call itself fails (network), since the edge function's own catch never ran | Med | `automateSalesInvoice` resets `Pending → Draft` (conditional on `Pending`) on any non-Submitted outcome before recording the hold |
| Posting an invoice nobody looked at with a wrong rate or tax | Med | Rates and tax were set on the agreement at activation. Charges and credits are held. `Draft Only` exists per agreement. VOID is available |
| `Post and Email` is the default, so a company's first rental invoice goes to a customer automatically | Low | Rentals are new and unreleased. The settings card and the agreement field both state the effective mode before activation |
| Rental lines' provider sync (Xero/QBO/Rillet) is unverified (parent spec risk) | Med | Unchanged by this spec; automation only makes posting more frequent. Track it under the parent spec's open follow-up |
| Moving `checkPartyContactRequirement` to a package widens its import graph | Low | It only reads `companySettings`; /plan picks the package |
| Moving two Sales settings cards breaks muscle memory and links | Low | Settings search and nav cover it. Mention it in the changelog entry |

## Open Questions

> All resolved with the user on 2026-10-02 before this spec was written.

- [x] Can rental invoices be posted and sent automatically? — **Answer:** Yes. Research in `.ai/research/rental-invoice-automation.md`; posting reuses the `ramp-sync-bill` claim-and-invoke pattern, emailing needs the PDF loader extracted.
- [x] At what level is it configured? — **Answer:** A company-wide setting on an Invoicing settings page, overridden per agreement. No customer level.
- [x] Default mode? — **Answer:** `Post and Email`, selectable on an agreement only when its contact has an email.
- [x] Which invoices are held for review? — **Answer:** Charges (on their own invoice), early-return credits, purchase-option lines (they're charges), sales-rule errors AND warnings, a missing required contact, and locked/closed periods or any posting failure.
- [x] What if the contact has no email? — **Answer:** Post anyway, flag it (`sendError`), don't send. Record `sentAt` when sent. Send under the company's receivables email.
- [x] Review window before posting? — **Answer:** None; post immediately in the same run.
- [x] Where does the company setting live? — **Answer:** A new Settings → Invoicing page.
- [x] Who is the email from? — **Answer:** Carbon's default sender under the company name, Reply-To the receivables email (fallback: the agreement creator; refined 2026-10-02 to the owner, `salesPersonId ?? createdBy`), receivables CC'd.
- [x] How are charges handled? — **Answer:** On a separate Draft invoice for review; the rent posts on its own.
- [x] Hold the agreement's first invoice? — **Answer:** No.
- [x] How do people learn what happened? — **Answer:** Badges, a Needs review filter, AND a daily notification (recipients: a notification group on the Invoicing page, per the existing `*NotificationGroup` pattern).
- [x] Should Invoicing also take over the invoice cards from Sales settings? — **Answer:** Yes. Move Emails (default CC) and Centralized Billing Address.
- [x] Phase posting and emailing separately? — **Answer:** No; ship together.
- [x] What happens when a rental invoice is voided? — **Answer:** The re-bill is always a held draft (D26).
- [x] Who is notified by default? — **Answer:** Each agreement's internal owner (salesperson, else creator), with no setup; the settings group is "Also notify" (D16).

## Changelog

- 2026-10-02 (later): The agreement says invoicing is automatic (summary schedule line, "Invoice Now" button). D16 notifies each agreement's owner by default (the group becomes "Also notify"); D26 holds re-bills after a VOID. Both were user decisions made while planning.
- 2026-10-02: Created. Questions resolved with the user before writing. Reverses Decision 10 of `2026-09-22-revenue-recognition-and-rentals.md` for rentals.
