# Task Brief: Issue #1032 — Document Approvals (JEs, Payments, Purchase Invoices, Memos) + SoD Reporting

## Context
You are running inside the Carbon loop harness as the doer/judge. The full spec is at `.ai/specs/2026-07-04-document-approvals.md` in the worktree. Read it completely before planning.

## Objective
Extend the existing PO approval engine to four financial documents (manual JEs, payments, purchase invoices, credit/debit memos) with amount-tiered rules, `Pending Approval` document statuses, approve/reject/withdraw on the document page, system-enforced no-self-approval for ALL document types (closes existing PO hole), escalation reminder job, user access report, and SoD conflict report.

## Binding
```yaml
kind: feature
risk: medium
issue: 1032
acceptance:
  - "With JE rule (floor $0) enabled: posting balanced manual JE from UI and MCP tool parks it Pending Approval with request (amount=totalDebits) + notifies approvers; no rule = byte-identical to today"
  - "Requester cannot self-approve JE/payment/invoice/memo/PO — server-rejected in canApproveRequest; second approver succeeds; enforceNoSelfApproval=false is audit-logged and appears in SoD report"
  - "Approving pending JE posts it (balance + period re-validated in-transaction, preparedBy/approvedBy stamped); rejecting returns to Draft with notes; requester can withdraw; parked JE not editable via PostgREST or UI without withdrawing"
  - "Payment above rule floor parks; direct post-payment invocation on parked payment fails until request Approved (in-transaction check); same for memo and purchase invoice; post-purchase-invoice now rejects any status other than Draft/transient-Pending/approved-Pending-Approval"
  - "Amount tiering: $500 JE matches $0-tier rule; $50k JE matches $25k rule; $0-tier approver cannot approve $50k entry; duplicate enabled floors rejected at rule save"
  - "Reversing posted JE and voiding payment still work one-step; fire notification to matched rule approvers"
  - "Escalation reminder fires exactly once per day per request pending longer than escalationDays"
  - "Access report lists effective permissions per user/company with wildcard expanded; SoD report flags accounting_update + JE-approver user, no-JE-rule company, enforcement-off company; both export CSV"
  - "pnpm run generate:types, scoped typecheck (erp + ee + shared), lint, and existing approval/PO tests pass; migration idempotent x2"
```

## Key Implementation Notes (from spec)
- Gate for JE must be inside `postJournalEntry` service (not route) — MCP path bypasses route guards
- `post-payment`/`post-memo` accept `Pending Approval` status ONLY when latest request is Approved (checked inside FOR-UPDATE transaction)
- `post-purchase-invoice` post branch currently has NO status guard — add one accepting Draft/transient-Pending/approved-Pending-Approval
- `canApproveRequest` gains `requestedBy` + self-approval check; `getPendingApprovalsForApprover` excludes own requests
- New enum values: `'Pending Approval'` on journalEntryStatus/paymentStatus/memoStatus/purchaseInvoiceStatus; new approvalDocumentTypes: journalEntry/payment/purchaseInvoice/memo
- New columns: `journal.preparedBy`, `journal.approvedBy`, `journal.approvalRequestId`; `companySettings.enforceNoSelfApproval` (default true); `approvalRequest.lastRemindedAt`
- Unique index on approvalRule (companyId, documentType, lowerBoundAmount) WHERE enabled=true
- SoD matrix is a typed constant in code (not a table)
- Reports: `getUserAccessReport` (users service), `getSodConflicts` (settings/users service)
- Reversals/voids NOT gated — audit-logged + approver notification only

## DO NOT
- Do not implement inline — always read the spec first
- Do not skip the typecheck/lint gates
- Do not push directly to main — open PR

## Output
Open a PR to `crbnos/carbon` main branch targeting `loop/1032`. Write outcome to `.ai/runs/1032/outcome.json`:
```json
{"state": "shipped"|"salvage"|"blocked"|"needs-verification", "pr": <number>, "summary": "..."}
```
