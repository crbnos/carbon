# Document Approvals: Manual Journal Entries, Payments, Purchase Invoices, Memos

> Status: in-progress (all open questions resolved pre-writing, per the updated spec-writing flow)
> Author: Claude (with Brad Barbin)
> Date: 2026-07-04
> Research: `.ai/research/public-company-compliance.md` (§Pattern 4: SAP parked→posted JE verification, NetSuite approval routing, AS 2401 self-approval testing)
> Parent: `.ai/specs/2026-07-03-public-company-readiness.md` (finding MW-2) · `.ai/plans/2026-07-03-public-company-readiness-roadmap.md` (Phase 0 Spec B — pulled forward, starts now)

## TLDR

Extend the existing approval engine (`approvalRule`/`approvalRequest`, built for purchase orders) to four financial documents — **manual journal entries, payments, purchase invoices, and credit/debit memos** — with amount-tiered rules, a `Pending Approval` status on each document, and the PO wiring pattern replicated: post-intent creates the request and parks the document, approvers act from the document page (notified in-app/email/Slack), approve posts the document, reject returns it to Draft, the requester can withdraw. **Self-approval becomes impossible system-wide** (including the existing PO hole): `canApproveRequest` rejects the requester, gated by a `companySettings.enforceNoSelfApproval` flag that defaults on and is audit-logged + flagged as a standing exception when disabled. The dead `escalationDays` config comes alive as a daily reminder job. The spec also ships the two SoD surfaces the readiness audit requires: a **user access report** (per-user effective permissions per company, exportable, for quarterly access reviews) and a **SoD conflict report** (seeded conflict matrix over `userPermission` + rule membership, including "no JE rule configured" and "self-approval enforcement disabled" as reportable exceptions). Reversals and voids are deliberately not gated in v1 — they are audit-logged and fire notifications to the rule's approvers. This closes readiness finding MW-2 (the first control a SOX readiness firm tests) using machinery that already exists.

## Problem Statement

Manual journals go `Draft → Posted` with no approval step; payments and purchase invoices post on a single permission check; memos post unreviewed (the classic receivables write-off fraud vector). The one approval engine that exists covers only `purchaseOrder`/`qualityDocument`/`supplier` — and permits self-approval: `canApproveRequest` (`apps/erp/app/modules/shared/shared.service.ts:149-200`) checks rule/group membership only; `requestedBy` is not even in its input type. Auditors test exactly this first (AS 2401: submitter vs approver credentials, time-gap analytics). Specific holes found in fieldwork:

- `postJournalEntry` (`accounting.service.ts:1896-1959`) posts any balanced Draft — reachable from two routes AND the MCP API (`accounting_postJournalEntry` in `api+/mcp+/lib/direct-executor.ts`), so a route-level gate would be bypassable; the gate must live in the service.
- `post-purchase-invoice`'s post branch has **no status guard at all** (`post-purchase-invoice/index.ts:403` — fetch and post unconditionally); the Draft→Pending→Open dance is entirely route-managed.
- `post-payment` is the only poster with in-transaction status re-assertion (`index.ts:425-437`) — the pattern the others need.
- `salesOrderStatus` has carried a dead `'Needs Approval'` value since 2024 that nothing writes.
- `escalationDays` (`20260119191608:58`) has no consumer — dead config with a commented-out form field.

## Resolved Questions (answered before writing, 2026-07-04)

- [x] **Reversals/voids gated?** — **No, not in v1.** Forward postings only. `reverseJournalEntry`, payment/memo void, and invoice void stay one-step but are audit-logged and fire an `ApprovalRequested`-family notification ("Posted document reversed/voided") to the matched rule's approvers. Gate can be added later if auditors push. (NetSuite default.)
- [x] **Memos in scope?** — **Yes, fourth document type.** Same engine, same pattern as payments; closes the credit-memo write-off vector in the same release.
- [x] **Seeded default rules?** — **No — opt-in per company** (today's PO behavior: no rule ⇒ no approval). The SoD report flags companies with no journal-entry rule; the accounting-activation cutover checklist (readiness roadmap §Cutover) requires rules to be configured.
- [x] **Escalation?** — **Daily reminder in v1.** Inngest cron re-notifies approvers of requests pending longer than the rule's `escalationDays` and CCs `defaultApproverId`; the commented-out form field returns.
- [x] *(inherited from the readiness spec)* Self-approval blocked server-side for **all** approval document types including existing POs; `companySettings.enforceNoSelfApproval` defaults on; disabling it is audit-logged and appears in the SoD report.

## Proposed Solution

### Document lifecycles (PO pattern replicated)

| Document | Today | With a matching enabled rule | Amount evaluated (base currency) |
|---|---|---|---|
| Manual JE | Draft → Posted | Draft → **Pending Approval** → Posted (approve) / Draft (reject/withdraw) | `journalEntries.totalDebits` (balanced ⇒ == credits; `journalLine.amount` is already base) |
| Payment | Draft → Posted → Voided | Draft → **Pending Approval** → Posted / Draft | payment total converted to base via the shared FX helper (never hardcode the operator — convention set by the FX-normalization spec) |
| Purchase invoice | Draft → (route-transient Pending) → Open | Draft → **Pending Approval** → Pending → Open / Draft | `purchaseInvoices.totalAmount` view column (already base; includes tax + shipping) |
| Memo | Draft → Posted → Voided | Draft → **Pending Approval** → Posted / Draft | memo amount converted to base via the same helper |

Mechanics, per document:

1. **Post intent** (existing post routes/actions; for JEs also the service entry point so the MCP path is covered): call `isApprovalRequired(type, companyId, baseAmount)`. If no enabled rule matches → post exactly as today (opt-in resolution). If one matches and the latest request for the document is not Approved → set status `Pending Approval`, `createApprovalRequest` (amount = base amount snapshot), notify approvers via the existing `ApprovalRequested` event, flash "submitted for approval". PO precedent: `$orderId.finalize.tsx:123-177`.
2. **Approve** → `approveRequest` (existing Kysely transaction) gains cases for the four types. JE: re-validate balance + period gate inside the transaction, then `status='Posted'`, `postedAt/By`, `approvedBy` — guarded `WHERE status = 'Pending Approval'` (throw → rollback if changed, the PO guard pattern). Payment/memo: transition is **handled by the edge function** — the route invokes `post-payment`/`post-memo` after `approveRequest` marks the request Approved; the edge functions' status guards learn to accept `'Pending Approval'` **only when the latest request for the document is Approved** (checked inside the FOR-UPDATE transaction — no flip-to-Draft race). Purchase invoice: route runs today's posting dance from `Pending Approval` under the same approved-request check, and `post-purchase-invoice` finally gains a real status guard (accept only Draft, route-transient Pending, or approved Pending Approval).
3. **Reject** → request Rejected with `decisionNotes`; document returns to `Draft` (guarded transition). Requester notified (`ApprovalRejected`).
4. **Withdraw** → requester-only (`canCancelRequest`); request Cancelled; document returns to Draft.
5. **Locked while pending**: documents in `Pending Approval` are not editable — JE: the existing `journal` UPDATE RLS policy allows only Draft/Posted, so the new status is edit-locked by construction (approve path runs service-role Kysely); payment/invoice/memo: extend the app-side Draft-only guards (`isPaymentLocked`, `isPurchaseInvoiceLocked`, memo equivalent) to treat `Pending Approval` as locked. Edits require withdraw-to-Draft first.
6. **Approver identity on the record**: `journal.preparedBy` (stamped = the posting requester), `journal.approvedBy`, `journal.approvalRequestId` — the columns the readiness JE export needs. Payments/invoices/memos carry identity via `approvalRequest` (`requestedBy`/`decisionBy`), joined by the export.

### No-self-approval (all document types, including POs)

- `ApprovalRequestForApproveCheck` gains `requestedBy`; `canApproveRequest` and `canApproveRequestInWindow` return `false` when `userId === requestedBy` and `companySettings.enforceNoSelfApproval` is true. This closes the existing PO hole in the same change.
- `enforceNoSelfApproval BOOLEAN NOT NULL DEFAULT true` on `companySettings`. Turning it off: settings permission required, audit-logged, and surfaced permanently in the SoD report as a standing exception. (Deadlock note for tiny teams: the requester sees "awaiting another approver" — the escape is a second approver on the rule or disabling the flag, both visible to auditors.)
- `getPendingApprovalsForApprover` gains the same exclusion (it currently doesn't exclude own requests; `getApprovalsForUser` already does).

### Escalation reminder

Daily Inngest cron: for each Pending request whose rule has `escalationDays` and `requestedAt < now − escalationDays`, re-fire `ApprovalRequested` to the tier's approvers + `defaultApproverId`, at most once per day per request (stamp `lastRemindedAt` on the request). Un-comment the `escalationDays` field in `ApprovalRuleForm`.

### Reversals & voids (not gated — resolved)

`reverseJournalEntry`, payment/memo void, invoice void keep their current one-step flows, with two additions: the action is audit-logged (this rides Phase 0 Spec A's audit coverage; until then, the existing notification is the trail) and a notification is sent to the matched rule's approvers ("JE-2026-07-0042 was reversed by …"). Revisit gating post-v1 if audit feedback demands it.

### Rules UI & engine hygiene

- `approvalDocumentTypesWithAmounts` += the four new types; the settings page gains four cards (JE / Payment / Purchase Invoice / Memo), amount-tiered like the PO card.
- Duplicate-floor validation: `upsertApprovalRule` rejects a second enabled rule with the same `(documentType, lowerBoundAmount)`; partial unique index backs it.
- Notifications: `notify.ts` gains descriptions for the four types; `api+/link.ts` gains their deep links.
- Pending-approvals visibility: the accounting dashboard and invoicing dashboard gain the same "assigned to me" widget the purchasing dashboard has (`getPendingApprovalsForApprover`), covering JEs and payments/invoices/memos respectively.

### SoD & access-review reports (readiness Spec B scope)

Two new settings-area reports, both CSV-exportable via the standard table export:

1. **User access report** (`x+/settings+/access-report`): per user × company, effective permissions expanded from `userPermission` JSONB (module × action × company, `"0"` wildcard resolved), employee type, active status, last sign-in; grouped by user. This is the quarterly access-review artifact (the most common ITGC deficiency is stale access).
2. **SoD conflict report** (`x+/settings+/sod-report`): evaluates a seeded conflict matrix and lists users/companies in violation, plus standing exceptions:
   - JE create/update (`accounting_update`) + JE approver (rule membership) — flagged when self-approval enforcement is off; informational otherwise (the runtime block is the mitigating control).
   - Supplier create (`purchasing_create`) + payment approver.
   - Rule configuration (`settings_update`) + approver membership on any rule (can grant themselves approval authority).
   - `settings_update` (sequence editing) + `accounting_update` (posting).
   - Company has **no enabled journal-entry rule** (per the opt-in resolution — visibility instead of seeding).
   - `enforceNoSelfApproval = false`.
   The matrix lives in code (a typed constant), not a table — v1 is detective reporting per the readiness resolution; a configurable matrix comes with preventive enforcement later.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Engine | Extend `approvalRule`/`approvalRequest` — no new engine | Roadmap resolution; tiers/groups/notifications/decision audit already exist; per-document ad-hoc approvals are the anti-pattern |
| 2 | Gate placement — JE | Inside `postJournalEntry` (service), not the route | MCP API calls the service directly (`direct-executor.ts`); a route gate is bypassable. Covers both routes + MCP with one check |
| 3 | Gate placement — payment/memo | Route sets `Pending Approval`; edge function accepts that status only with an Approved request, verified inside the existing FOR UPDATE transaction | Avoids a flip-to-Draft TOCTOU; reuses `post-payment`'s proven re-assertion pattern (`index.ts:421-437`) |
| 4 | Gate placement — purchase invoice | Route gate + a real status guard added to `post-purchase-invoice`'s post branch | The post branch currently has no status guard at all — fixing that is MW-1-adjacent hardening this spec gets for free |
| 5 | New statuses | `ALTER TYPE ... ADD VALUE 'Pending Approval'` on `journalEntryStatus`, `paymentStatus`, `memoStatus`, `purchaseInvoiceStatus` | Additive, precedent `20260119191608:5` (PO) and `20260630093809:182-184`; `purchaseInvoices` view's status CASE gains the passthrough; `status-colors.ts` already maps a yellow "Needs Approval" — add "Pending Approval" alongside |
| 6 | Naming | `'Pending Approval'` (not PO's `'Needs Approval'`) | PI enum already uses `'Pending'` for the route-transient posting state; "Pending Approval" avoids collision and reads correctly in the derived-status views. The dead `salesOrderStatus 'Needs Approval'` value is left untouched (Postgres enums can't drop values; SO approvals are out of scope) |
| 7 | Amount basis | Base currency, snapshot on the request at creation (existing `amount` column) | Rules are company-wide; mixed-currency documents must tier consistently; FX helper shared with posting so the convention tracks the FX-normalization spec |
| 8 | Self-approval | Blocked in `canApproveRequest` core, `enforceNoSelfApproval` default on, disable = audited standing exception | Readiness resolution; fixes POs too; AS 2401 test #1 |
| 9 | Reversals/voids | Not gated; audit-logged + approver notification | Resolved 2026-07-04 (recommendation accepted) |
| 10 | Memos | In scope, mirroring payments | Resolved 2026-07-04 |
| 11 | Rule seeding | None — opt-in; SoD report + cutover checklist provide the visibility | Resolved 2026-07-04 |
| 12 | Escalation | Daily reminder job + `lastRemindedAt`; no tier-jumping | Resolved 2026-07-04; makes dead config real without redesigning authority |
| 13 | SoD matrix | Typed constant in code, detective-only v1 | Readiness resolution (detective); configurable matrix ships with preventive enforcement if/when demanded |
| 14 | Multi-tenancy (H1) | No new business tables; new columns on existing composite-PK tables; `approvalRequest.lastRemindedAt` added | Engine tables already follow the convention |
| 15 | Service shape (H2) | All engine changes in `shared.service.ts`; JE gate in `accounting.service.ts`; reports in `users`/`settings` service per module ownership; `(client, ...) → {data, error}` | House convention; no new service files |
| 16 | RLS (H3) | `approvalRequest` keeps zero policies (service-role only, app-level auth) — unchanged, documented; new statuses covered by existing policies (JE edit-lock falls out of the Draft/Posted-only UPDATE policy) | Matches current engine posture; Phase 0 Spec A adds the audit coverage |
| 17 | Permissions (H4) | Decision actions ride the documents' existing route permissions (`update: accounting` / `update: invoicing`) + `canApproveRequest`; reports require `view: users` (access) / `view: settings` (SoD); rules stay `settings_*` | Exact PO precedent |
| 18 | Forms (H5) | `ValidatedForm` + zod: approval decision validators mirror `purchaseOrderApprovalValidator`; rule form reused | House convention |
| 19 | Module layout (H6) | No new module; UI additions in existing `ui/` folders per module | House convention |
| 20 | Backward compat (H7) | No rule configured ⇒ byte-identical behavior everywhere; new enum values additive; `enforceNoSelfApproval` default true changes PO behavior only for requester-approvers (the hole being closed is the point) | Release note for the PO self-approval change |

## Data Model Changes

One idempotent migration (`pnpm db:migrate:new document-approvals`, randomized HHMMSS — enum ADD VALUEs guarded and, per Postgres rules, positioned so new values aren't used in the same transaction; follow the `20260630093809:182-184` pattern), then `pnpm run generate:types`:

```sql
-- New approval document types
ALTER TYPE "approvalDocumentType" ADD VALUE IF NOT EXISTS 'journalEntry';
ALTER TYPE "approvalDocumentType" ADD VALUE IF NOT EXISTS 'payment';
ALTER TYPE "approvalDocumentType" ADD VALUE IF NOT EXISTS 'purchaseInvoice';
ALTER TYPE "approvalDocumentType" ADD VALUE IF NOT EXISTS 'memo';

-- New document statuses
ALTER TYPE "journalEntryStatus"    ADD VALUE IF NOT EXISTS 'Pending Approval';
ALTER TYPE "paymentStatus"         ADD VALUE IF NOT EXISTS 'Pending Approval';
ALTER TYPE "memoStatus"            ADD VALUE IF NOT EXISTS 'Pending Approval';
ALTER TYPE "purchaseInvoiceStatus" ADD VALUE IF NOT EXISTS 'Pending Approval';

-- Approver identity for the JE export (readiness MW-1/MW-2)
ALTER TABLE "journal"
  ADD COLUMN IF NOT EXISTS "preparedBy" TEXT REFERENCES "user"("id"),
  ADD COLUMN IF NOT EXISTS "approvedBy" TEXT REFERENCES "user"("id"),
  ADD COLUMN IF NOT EXISTS "approvalRequestId" TEXT;

-- Self-approval enforcement + escalation reminder bookkeeping
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "enforceNoSelfApproval" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "approvalRequest"
  ADD COLUMN IF NOT EXISTS "lastRemindedAt" TIMESTAMP WITH TIME ZONE;

-- One enabled rule per (documentType, floor)
CREATE UNIQUE INDEX IF NOT EXISTS "approvalRule_type_floor_enabled_idx"
  ON "approvalRule" ("companyId", "documentType", "lowerBoundAmount")
  WHERE "enabled" = true;

-- purchaseInvoices view: add 'Pending Approval' to the status passthrough CASE
-- (DROP + recreate, forked from the NEWEST definition per .ai/lessons.md)
```

## API / Service Changes

- `shared.service.ts`: `canApproveRequest`/`canApproveRequestInWindow` gain `requestedBy` + the self-approval check; `approveRequest`/`rejectRequest` gain the four document cases with guarded status transitions; `getPendingApprovalsForApprover` excludes own requests; `createApprovalRequest` unchanged.
- `accounting.service.ts`: `postJournalEntry` gains the approval gate (rule check → park + request + notify, or post) and stamps `preparedBy`/`approvedBy`; `reverseJournalEntry` fires the approver notification.
- Edge functions: `post-payment` / `post-memo` status guards accept `'Pending Approval'` iff the latest request is Approved (checked in-transaction); `post-purchase-invoice` post branch gains a status guard (Draft / transient Pending / approved Pending Approval only).
- Routes: post routes for the four documents gain the gate + submitted-for-approval flash; decision actions (approve/reject with notes) added to each document's detail route mirroring `$orderId.tsx:86-124`; withdraw actions mirror `canCancelRequest`; `api+/link.ts` + `notify.ts` learn the four types.
- Jobs: `approval-escalation` daily cron in `packages/jobs`.
- Reports: `getUserAccessReport` (users service), `getSodConflicts` (settings/users service) + two routes with CSV export.
- MCP: `accounting_postJournalEntry` inherits the gate automatically (it calls the service).

## UI Changes

- Status badges (`Pending Approval` = yellow) across the four documents' tables/headers; Approve/Reject modal (notes field) on each document page for eligible approvers; withdraw button for requesters; edit surfaces disabled while pending.
- Settings → Approval Rules: four new amount-tiered cards; `escalationDays` field restored.
- Accounting + invoicing dashboards: pending-approvals widget (purchasing precedent).
- Settings: Access Report + SoD Report pages with CSV export; `enforceNoSelfApproval` toggle with warning copy.

## Acceptance Criteria

- [ ] With a JE rule (floor $0) enabled: posting a balanced manual JE from the UI **and** from the MCP tool parks it in `Pending Approval` with a request (amount = totalDebits) and notifies approvers; with no rule, posting behaves byte-identically to today.
- [ ] The requester — even when a rule approver — cannot approve their own JE/payment/invoice/memo/PO (server-rejected); a second approver can; with `enforceNoSelfApproval` off (audit-logged), the requester-approver can, and the SoD report shows the standing exception.
- [ ] Approving a pending JE posts it (balance + period re-validated in-transaction) and stamps `preparedBy`/`approvedBy`; rejecting returns it to Draft with notes; the requester can withdraw; a parked JE cannot be edited via PostgREST or the UI without withdrawing first.
- [ ] A payment above a $10k rule floor parks; direct invocation of `post-payment` on the parked payment fails until the request is Approved; after approval the normal post flow succeeds. Same for a memo and a purchase invoice; `post-purchase-invoice` now rejects posting any invoice that is not Draft / transient-Pending / approved-Pending-Approval.
- [ ] Amount tiering: a $500 JE matches the $0 rule and a $50k JE the $25k rule; a $0-tier approver cannot approve the $50k entry; duplicate enabled floors are rejected at rule save.
- [ ] Reversing a posted JE and voiding a posted payment still work one-step and fire a notification to the matched rule's approvers.
- [ ] A request pending longer than `escalationDays` triggers exactly one reminder per day to approvers + default approver.
- [ ] Access report lists a seeded user's effective permissions per company with the wildcard expanded; SoD report flags a user holding `accounting_update` + JE approver membership, a company with no enabled JE rule, and a company with enforcement off; both export CSV.
- [ ] `pnpm run generate:types`, scoped typecheck, lint, and existing approval/PO tests pass; migration applies idempotently twice.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Enum ADD VALUE + same-migration use (Postgres restriction) | Med | Follow the `20260630093809` guarded pattern; view recreation in the same migration only references, never inserts, the new values |
| `approveRequest` grows four Kysely branches → drift vs edge-function logic | Med | JE posting logic shared via one validated SQL path; payment/memo/invoice transitions stay in their edge functions (single owner per document) |
| Parked documents block month-end (approver on vacation) | Med | Escalation reminders + default approver; withdraw always available to the requester; close-readiness already blocks on drafts, pending items surface the same way |
| PO behavior change (self-approval now blocked) surprises existing users | Med | Release note; `enforceNoSelfApproval` toggle exists but defaults on; SoD report explains the why |
| MCP agents parking documents unexpectedly | Low | Gate returns a structured "submitted for approval" result, not an error; tool docs updated |
| purchaseInvoices view recreation churn | Med | Fork from newest definition per `.ai/lessons.md`; `SELECT *` passthrough |

## Open Questions

> All resolved before writing (see Resolved Questions above) — none outstanding.

## Changelog

- 2026-07-04: Created under the updated spec-writing flow: engine + document-flow fieldwork first, four open questions resolved with Brad (recommendations accepted: reversals/voids not gated in v1; memos included; opt-in rules, no seeding; daily escalation reminder), spec written with resolutions baked in. Ready for `/plan`.
