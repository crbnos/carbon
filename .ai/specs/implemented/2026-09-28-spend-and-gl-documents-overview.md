# Spend management and GL documents — what actually shipped

> Status: implemented, PR [#1740](https://github.com/crbnos/carbon/pull/1740)
> Date: 2026-09-28 · Branch: `rillet-ramp-accounting-provider`
> 94 commits, 7 migrations, ~423 files.

This is the hindsight read of a branch that was designed as five specs and nine
plans. It exists because the individual documents were written **forward** — each
one reasoning about work not yet done — and none of them tells you what the branch
became. Read this first; the specs and plans below are the detail, and several of
them describe decisions that were later reversed.

## The one-sentence version

Carbon's spend and accounting integrations became **role-aware** (each integration
declares what it is, at most one active per role), and three new document types —
**reimbursements**, **credit memos** and **supplier credits** — became native
things Carbon pushes to an external GL, with Ramp able to run in **push-only** mode
where another system holds the accounting seat.

## What shipped, in dependency order

Each slice's plan is now in `.ai/plans/implemented/`. The order is the build order,
and it is also the order a reader should follow — slice 2 is unintelligible before
slice 1.

| # | Slice | Plan | What it actually does |
|---|---|---|---|
| 0 | **Charges rename** | `2026-09-22-rename-card-transactions-to-charges.md` | `cardTransaction` → `charge` everywhere: table, types, routes, UI, seed data, dataset wipe guard. Pure rename, done first so nothing below inherits the old name. |
| 1 | **Counterpart ladder + master-data sweep** | `2026-09-23-master-data-counterpart-sweep.md` | One shared counterpart-resolution ladder replacing per-provider duplicate matching, plus a sweep so a create that failed is retried instead of lost forever. |
| 2 | **Provider roles + topology** | `2026-09-23-provider-roles-topology.md` | Every integration declares `providerRole` (`accounting` \| `spend`); the database refuses a second active integration per role; a company's topology resolves once; ledger-family delegation is enforced by type at the decision point. |
| 3 | **Spend outbound on the event engine** | `2026-09-23-spend-outbound-event-engine.md` | Ramp's outbound pushes move off their own cursor sweep and onto the shared event engine. |
| 4 | **Push-only spend mode** | `2026-09-23-spend-push-only-mode.md` | Carbon pushes purchase orders and draft bills while a peer provider owns Ramp's accounting seat. Uncoded by design — coding is slice 5, which did not ship. |
| — | **Credit memos & supplier credits** | `2026-09-23-memo-external-gl-representation.md` | New `creditMemo` / `supplierCredit` posting families and entity types, per-party family resolution, syncers for Rillet, Xero and QBO, settings selectors. |
| — | **Reimbursements** | `2026-09-23-reimbursements-first-class.md` | Schema, `post-reimbursement` edge function, full ERP lifecycle (list, detail, edit, post, void, pay), settlement against an employee payment, Ramp importing one as Draft. |
| — | **Self-review fix batch** | `2026-09-28-self-review-must-fixes.md` | The 34 findings a strict self-review raised across the above, plus the three it raised that did not survive inspection and were rejected with written reasoning. |

Seven migrations, in apply order:

```
20260922195151  rename-card-transactions-to-charges
20260923231244  reimbursements-first-class
20260924133915  integration-provider-role          ← carries the one-active-per-role guard
20260927002910  require-party-contact
20260927200103  rename-vendor-credit-to-supplier-credit
20260928013415  charge-reimbursement-authz
20260928023448  party-contact-require-location
```

## Decisions a reader will otherwise re-litigate

- **A reimbursement is its own document, not an Employee-supplier bill.** The
  cheaper modelling was rejected; the reasoning is in that spec and in
  `.claude/rules/`.
- **`vendorCredit` was renamed `supplierCredit` mid-branch** (`20260927200103`).
  Any spec text below that says `vendorCredit` predates that rename.
- **Memo families resolve by PARTY, not by direction.** A supplier memo in the
  Credit direction is a supplier credit, not an AR document. Direction-based
  resolution was built first and was wrong.
- **AR/AP invoice lines stopped referencing Carbon items.** Each line carries a
  synthetic per-revenue-account product, or is account-coded, replaying the account
  its posted journal used — so the parts catalog is no longer mirrored into the
  provider. This makes the journal replay load-bearing for correctness, which is why
  its failure mode (below) mattered so much.
- **`DATE` columns decode as `YYYY-MM-DD` strings in both Postgres drivers.** They
  were being parsed into a JS `Date` at local midnight while `KyselyDatabase`
  declares `string`. Typecheck cannot see that gap and it shipped as a bug twice.
- **Ramp is pinned to the sandbox** (`RAMP_ENVIRONMENT = "sandbox"`).

## Designed but NOT built — and where it lives

These stayed out deliberately. They are **not** in `implemented/`, and the reason
each one stopped is worth reading before picking it up.

| Document | Why it did not ship |
|---|---|
| `.ai/specs/2026-09-23-editable-imported-spend-documents.md` | Designed, not built. Needs a `chargeLineDimension` / `reimbursementLineDimension` child table per document type. Its dimension-precedence rules were tightened during review (generic rows win per `dimensionId`; a column is a fallback only where no row exists; the line editor promotes columns into rows on first edit) — the third rule is load-bearing, because without it a cleared dimension silently comes back from the column. |
| `.ai/plans/2026-09-23-editable-imported-charges.md` | The charge half of the above. Blocked on the same migration. |
| `.ai/plans/2026-09-23-delegated-coding-grir.md` | **Gated on live sandbox verification**, not on code. Two of its five questions decide whether the coding half can exist at all — whether Ramp silently drops an unrecognised option, and whether a non-provider app can read `/accounting/field-options`. Do not build a best-effort version. |
| `.ai/specs/2026-09-23-credit-allocation-ux.md` | Status: draft. Its open questions were resolved autonomously and still await a veto. |

## What is verified, and what is not

Verified: `@carbon/ee` 1869, `@carbon/jobs` 785, `erp` 1516, `@carbon/checks` 175
unit tests; scoped typechecks; Biome. The Ramp push-only path was exercised against
the sandbox — see `.ai/runs/2026-09-26-ramp-push-only-verification.md`. The
reimbursement UI has a browser playbook at `.ai/playbooks/reimbursements.md`.

**Not** verified, and stated in the PR: QuickBooks credit memos and vendor credits
have never been exercised against a live QBO company (noted in
`quickbooks-online/provider.ts`) and should not be enabled for a customer until they
have. `20260924133915` changed late in the branch, so it needs re-applying before
`db:check:datasets` / `db:check:backups` mean anything — both read the live schema.

## The review history, because it explains the shape of the diff

Three passes, ~25 accepted fixes. The ones worth knowing about, because each was
**silently wrong rather than failing**:

- A Fixed Asset invoice line pushed as **sales revenue** — a $5,000 machine showed
  as $5,000 of revenue in the customer's ledger of record.
- **Credit memos and supplier credits never reconciled** — plumbed end to end
  except for the `switch` arm that decides.
- A **foreign credit applied at the wrong amount** (base where document was meant)
  and, separately, at QBO's own rate rather than Carbon's, because the application
  carried no `CurrencyRef`.
- **One bad invoice parked up to 19 healthy ones, permanently.** The batch push
  marks every id in the claimed group with one document's error, and nothing
  automatic brings the others back. This branch widened it: before, only a shipping
  posting could reach that throw.
- **A void memo journal never reached the provider** — the party was resolved from
  `memo.journalId`, and voiding a memo inserts a NEW journal.
- **Master-data push stalled rather than advancing** — the page query has no
  `ORDER BY`, so a failing page came back identical and the loop broke, reporting
  "complete" with most records never attempted.
- **A Ramp draft bill could become permanently unpushable** — create-once, and the
  mapping was written only after the whole batch.

## Lesson: do not split a PR whose later half fixes its earlier half

This branch was briefly split into a stack (#1748 → #1740) to get each half under
CodeRabbit's 300-file review limit, then recombined. The split worked for file
count and the review it unlocked found real bugs. It cost more than it should have,
because the reviewer only ever sees the lower half: **6 of 16 findings in one round,
and 3 of 7 in another, were defects the upper half had already fixed**, and fixing
them again in the lower half produced two implementations of the same fix that had
to be reconciled by hand.

If a large PR needs splitting again: cut so that the fix commits land in the
**lower** half, or accept that findings against the lower half must be triaged
against the upper one before any of them are worked.
