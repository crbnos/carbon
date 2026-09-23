# Credit Allocation UX — Apply Credits Where the Work Happens

> Status: draft
> Author: Brad Barbin + Claude
> Date: 2026-09-23
> Sibling specs: `.ai/specs/2026-09-23-memo-external-gl-representation.md` (credit documents
> reach the external GL), `.ai/specs/2026-09-23-reimbursements-first-class.md`.
> Builds on: `.ai/specs/implemented/memo-refactor-plan.md` (the `memo` table and the
> reducer/increaser model), `.ai/specs/implemented/2026-09-16-...` AR/AP payments work.
> Related rules: `.claude/rules/accounting-sync-handlers.md`.

> **Open questions in this spec were resolved AUTONOMOUSLY** (codebase precedent →
> recommendation) because the spec was requested as part of a batch. Each is marked
> **Autonomous** in Open Questions and awaits veto.

## TLDR

Carbon's settlement *engine* is good and deliberately centralised — `invoiceSettlement` models
cash, credits, discounts, write-offs and FX; `PaymentApplyTable` and `AvailableCreditsTable`
are real, tested components; `MemoApplicationsPanel` and `InvoicePaymentsPanel` show both
directions. What's missing is **task-oriented entry points**. Today, applying a credit means
creating a **$0 payment** — an accountant thinks *"apply this credit to that invoice"*, not
*"create a zero-dollar receipt."* This spec adds **Apply** actions on the credit memo and on
the invoice, adds **unapply**, and hides the zero-payment artifact — while keeping exactly one
settlement engine underneath. Nothing is rebuilt.

## Problem Statement

### What already works (do not rebuild)

- `invoiceSettlement` — source `paymentId` XOR `memoId`; target `targetSalesInvoiceId` XOR
  `targetPurchaseInvoiceId` XOR `targetMemoId`; carries `appliedAmount`, `discountAmount`,
  `writeOffAmount`, `fxGainLossAmount`, both exchange rates and `appliedDate`.
- `PaymentApplyTable` / `AvailableCreditsTable` — the settlement composer, with a substantial
  test file (`PaymentApplyTable.test.tsx`) covering FX and credit rows.
- `MemoApplicationsPanel` — *"Where this credit/debit memo's balance went."*
- `InvoicePaymentsPanel` — everything applied to an invoice, cash and credits together.
- `getMemoApplications()` and the settlement readers in `invoicing.service.ts`.

The centralisation is intentional and documented in `x+/credits+/$memoId.tsx`: *"Applying it to
invoices happens on the payment/receipt screen (alongside cash), so the settlement UI lives in
one place."* That principle is correct and this spec keeps it.

### The gaps

1. **Applying a credit requires a conceptual detour.** `getApplyCreditHref` builds *"a $0
   receipt/payment for the party, so the settlement composer opens with no cash and the party's
   posted credits ready to apply."* The mechanism is sound; exposing it is the problem. Xero,
   QBO and Rillet all let a user apply a credit **from the credit** or **from the invoice**.
2. **No Apply action on the credit memo.** `x+/credits+/$memoId.tsx` renders the memo and a
   read-only "Applied To" panel. The obvious next action — *apply this* — isn't there.
3. **No Apply action on the invoice.** An invoice with an open balance and available party
   credits offers no way to consume them in place.
4. **No unapply.** Nothing in the routes or service exposes removing or editing a settlement;
   correcting a mis-application means voiding the payment that carried it.
5. **Zero-dollar payments clutter the payments list** — each credit application leaves a $0
   row that reads as a real receipt.

## Proposed Solution

**One settlement engine, better doors.** Every new entry point composes the same
`invoiceSettlement` rows through the same validators; none introduces a second settlement path.

### 1. Apply from the credit memo

An **Apply** action on a Posted memo with a remaining balance opens the settlement composer
scoped to that memo: the target list is the party's open items — open invoices **plus
opposite-direction open memos** (the reducer/increaser rule from `memo-refactor-plan.md`) —
with amount inputs, a running remaining balance, and validation that the total never exceeds
the memo's remaining amount.

### 2. Apply from the invoice

An **Apply credit** action on an invoice with an open balance opens the same composer scoped
the other way: the party's posted, unexhausted credits listed with amount inputs, capped at the
invoice's open balance.

### 3. Unapply

An application row in `MemoApplicationsPanel` / `InvoicePaymentsPanel` gains a **Remove**
action that reverses that single settlement and restores both balances, without voiding the
payment that carried it. Guard rails: refuse when the period is closed, and refuse when the
settlement has been pushed to an external provider that cannot unapply it (Rillet's AP
applications have no documented DELETE — see the credit-documents spec).

### 4. Hide the zero-payment artifact

A payment created solely to carry credit applications (`totalAmount = 0`, no bank account) is
flagged `isCreditApplication` and **excluded from the payments list by default**, surfacing
instead as the application itself. The row still exists — it is the settlement's carrier and
its audit trail — it just stops masquerading as a receipt.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Settlement engine | **Unchanged** — one engine, new entry points | The centralisation is deliberate and documented; forking a second settlement path is how the two drift. |
| Zero-payment carrier | **Kept**, flagged and hidden from the payments list | Rewriting the carrier would touch posting, FX and void handling for no accounting gain. Hiding it fixes the actual complaint. |
| Apply from memo | Composer scoped to the memo; targets = open invoices + opposite-direction open memos | Matches the reducer/increaser model already in the schema (`targetMemoId` exists precisely for this). |
| Apply from invoice | Same composer, inverse scope | Parity with every external provider; no new engine. |
| Unapply | Per-settlement Remove, not payment-void | Voiding a payment to fix one line is disproportionate and loses the other applications on it. |
| Unapply guard rails | Refuse on closed period; refuse when the external representation cannot unapply | Prevents Carbon and the provider silently diverging — Rillet publishes no DELETE for AP applications. |
| Auto-apply | **Out of scope v1** | QBO's `AutoApplyCredit` shows the hazard: credits moving without an explicit user action is exactly what makes Carbon and the provider disagree. Revisit only with an explicit, auditable opt-in. |
| Permission scoping (heuristic 4) | `invoicing_update` for apply/unapply; `invoicing_view` for the panels | Matches the existing payment routes. |
| Form pattern (heuristic 5) | `ValidatedForm` + zod validator + route action, reusing `invoiceSettlementValidator` | Carbon convention; the validator already exists. |
| UI precedent (heuristic 6) | Clone `PaymentApplyTable` / `AvailableCreditsTable` and the Drawer detail pattern | Per the copy-precedent convention — do not design new table/consumer UI from concepts. |
| Data model | **No schema change** except one boolean on `payment` (`isCreditApplication`) | `invoiceSettlement` already models everything else. |
| Backward compatibility (heuristic 7) | Additive nullable/defaulted boolean; existing $0 payments unflagged and still visible | No existing row changes meaning. |
| Multi-tenancy / RLS (heuristics 1, 3) | N/A — no new tables | Existing `payment` / `invoiceSettlement` RLS covers it. |

## API / Service Changes

- `invoicing.service.ts` — `getApplicableTargetsForMemo(client, companyId, memoId)`,
  `getAvailableCreditsForInvoice(...)`, `applyMemo(...)`, `removeSettlement(...)`. No new
  service files (module convention).
- Routes: `x+/credits+/$memoId.apply.tsx`, an apply action on the invoice detail route, and
  `x+/invoicing+/settlements.$id.remove.tsx`.
- `payment` gains `isCreditApplication BOOLEAN NOT NULL DEFAULT false`; the payments list
  filters it out by default with a "Show credit applications" toggle.

## UI Changes

- **Apply** button on a Posted memo with a remaining balance → composer drawer.
- **Apply credit** button on an open invoice → composer drawer.
- **Remove** on each row of `MemoApplicationsPanel` and `InvoicePaymentsPanel`.
- Remaining-balance indicator on the memo detail header.
- Payments list excludes `isCreditApplication` rows by default.

## Acceptance Criteria

- [ ] A Posted customer credit memo of 500 shows **Apply**; applying 300 to one open invoice
      and 200 to another leaves a remaining balance of 0, creates two `invoiceSettlement` rows,
      and both invoice balances drop by the applied amounts.
- [ ] The composer refuses a total exceeding the memo's remaining balance, and refuses a
      per-row amount exceeding that target's open balance.
- [ ] Applying a **reducer** memo offers both open invoices **and** opposite-direction open
      memos as targets (proving the `targetMemoId` path is reachable from the UI).
- [ ] An invoice with an open balance and an available party credit shows **Apply credit**, and
      applying it produces the same settlement rows as applying from the memo side.
- [ ] **Remove** on a single application reverses only that settlement — the other applications
      on the same carrier payment are untouched, and both balances are restored.
- [ ] Remove is refused with a clear message when the posting period is closed.
- [ ] A payment created purely to carry credit applications does **not** appear in the payments
      list by default, and does appear with the toggle on.
- [ ] Pre-existing $0 payments (created before this change) remain visible and unchanged.
- [ ] `pnpm run generate:types` after the migration, then
      `pnpm exec turbo run typecheck --filter=erp` and `pnpm run test` are green.
- [ ] Browser-verified end to end with `/test` (apply from memo, apply from invoice, remove) —
      UI changes are not done until visually verified.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| A second settlement path creeps in alongside the composer | High | Every entry point must call the same service functions and `invoiceSettlementValidator`; reviewed as an explicit acceptance criterion. |
| Unapply diverges from the external provider | Med | Guard rail: refuse when the pushed representation cannot unapply (Rillet publishes no DELETE for AP applications); otherwise push the reversal through the credit-documents spec's application sync. |
| Hiding $0 payments hides real ones | Med | Only rows explicitly flagged `isCreditApplication` at creation are hidden; the flag defaults false, so nothing historical disappears. |
| Closed-period corrections | Med | Refuse rather than silently re-date; consistent with the posting sync's `periodLockPolicy`. |
| FX on cross-currency application | Med | Reuse the existing composer logic, which `PaymentApplyTable.test.tsx` already covers; add a regression test for the memo-initiated path. |

## Open Questions

> Resolved **autonomously** (batch request); each awaits veto.

- [x] **Rebuild the settlement UI, or add entry points?** — **Autonomous:** Add entry points.
      The engine and composer are sound and tested; the documented "settlement UI lives in one
      place" principle is kept.
- [x] **Keep the $0-payment carrier?** — **Autonomous:** Keep it, flag it, hide it from the
      payments list. Rewriting the carrier would touch posting, FX and void handling for no
      accounting gain.
- [x] **Unapply: per-settlement, or void the payment?** — **Autonomous:** Per-settlement
      Remove; voiding a payment to fix one line loses the other applications it carried.
- [x] **Auto-apply credits?** — **Autonomous:** Out of scope v1. QBO's `AutoApplyCredit` is the
      cautionary case — credits moving without explicit action is what makes Carbon and the
      provider silently disagree.
- [x] **Does applying from the invoice need a separate engine?** — **Autonomous:** No; same
      composer, inverse scope.

## Changelog

- 2026-09-23: Created. Scoped after auditing the existing allocation surface — the engine,
  composer and panels already exist and are tested, so this spec targets the gaps (entry
  points, unapply, zero-payment noise) rather than proposing a rebuild. Open questions
  resolved autonomously as part of a batch request; awaiting veto.
