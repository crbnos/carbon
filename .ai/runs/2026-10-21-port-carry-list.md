# Port carry list

Merge of main `0a1bd961b2` into the branch frozen at `50c4309a9c` (FREEZE). Merge-base `23bd5d6e0b` (MB).
Plan: `.ai/plans/2026-10-21-port-branch-onto-main-service-functions.md`.

Every branch change the merge commit did not keep is listed here. Read the branch side with
`git diff 23bd5d6e0b 50c4309a9c -- <path>` (or `git show 50c4309a9c:<path>`). Tick a line when its change
is carried to its new home, and name that home.

## A. Conflicting hunks resolved to main's side (`ours` = branch, kept in `2026-10-21-port-carry/hunks/<path>.conflict`, diff3)

- [ ] `apps/erp/app/modules/accounting/accounting.server.ts`
- [ ] `apps/erp/app/modules/accounting/accounting.service.ts`
- [ ] `apps/erp/app/modules/invoicing/invoicing.server.ts`
- [ ] `apps/erp/app/modules/items/items.service.ts`
- [ ] `apps/erp/app/modules/people/people.service.ts`
- [ ] `apps/erp/app/modules/production/production.server.ts`
- [ ] `apps/erp/app/modules/production/production.service.ts`
- [ ] `apps/erp/app/modules/purchasing/purchasing.service.ts`
- [ ] `apps/erp/app/modules/sales/sales.server.ts`
- [ ] `apps/erp/app/modules/sales/sales.service.ts`
- [ ] `apps/erp/app/modules/settings/settings.service.ts`
- [ ] `apps/erp/app/modules/shared/shared.server.ts`
- [ ] `apps/erp/app/routes/api+/integrations.jira.issue.create.ts`
- [ ] `apps/erp/app/routes/api+/integrations.jira.issue.link.ts`
- [ ] `apps/erp/app/routes/api+/integrations.linear.issue.create.ts`
- [ ] `apps/erp/app/routes/api+/integrations.linear.issue.link.ts`
- [ ] `apps/erp/app/routes/api+/kanban.$id.tsx`
- [ ] `apps/erp/app/routes/api+/mrp.ts`
- [ ] `apps/erp/app/routes/x+/accounting+/periods.$periodId.close.tsx`
- [ ] `apps/erp/app/routes/x+/accounting+/projects.tsx`
- [ ] `apps/erp/app/routes/x+/accounting+/reports.tsx`
- [ ] `apps/erp/app/routes/x+/accounting+/revenue-recognition-runs.new.tsx`
- [ ] `apps/erp/app/routes/x+/contract+/$id.$lineId.details.tsx`
- [ ] `apps/erp/app/routes/x+/contract+/$id.$lineId.update.tsx`
- [ ] `apps/erp/app/routes/x+/contract+/$id.amend.tsx`
- [ ] `apps/erp/app/routes/x+/contract+/$id.details.tsx`
- [ ] `apps/erp/app/routes/x+/contract+/$id.lines.new.tsx`
- [ ] `apps/erp/app/routes/x+/contract+/$id.setup.details.tsx`
- [ ] `apps/erp/app/routes/x+/contract+/new.tsx`
- [ ] `apps/erp/app/routes/x+/contract+/update.tsx`
- [ ] `apps/erp/app/routes/x+/inventory+/quantities.tsx`
- [ ] `apps/erp/app/routes/x+/job+/$jobId.details.tsx`
- [ ] `apps/erp/app/routes/x+/job+/$jobId.status.tsx`
- [ ] `apps/erp/app/routes/x+/job+/new.tsx`
- [ ] `apps/erp/app/routes/x+/job+/update.tsx`
- [ ] `apps/erp/app/routes/x+/payments+/$paymentId.post.tsx`
- [ ] `apps/erp/app/routes/x+/payments+/new.tsx`
- [ ] `apps/erp/app/routes/x+/person+/$personId.job.tsx`
- [ ] `apps/erp/app/routes/x+/priority+/dates.tsx`
- [ ] `apps/erp/app/routes/x+/priority+/operations.tsx`
- [ ] `apps/erp/app/routes/x+/production+/planning.tsx`
- [ ] `apps/erp/app/routes/x+/production+/planning.update.tsx`
- [ ] `apps/erp/app/routes/x+/purchase-invoice+/$invoiceId.$lineId.details.tsx`
- [ ] `apps/erp/app/routes/x+/purchase-invoice+/$invoiceId.new.tsx`
- [ ] `apps/erp/app/routes/x+/purchase-order+/$orderId.finalize.tsx`
- [ ] `apps/erp/app/routes/x+/purchase-order+/$orderId.new.tsx`
- [ ] `apps/erp/app/routes/x+/purchase-order+/$orderId.status.tsx`
- [ ] `apps/erp/app/routes/x+/purchasing+/planning.tsx`
- [ ] `apps/erp/app/routes/x+/purchasing+/planning.update.tsx`
- [ ] `apps/erp/app/routes/x+/receipt+/$receiptId.post.tsx`
- [ ] `apps/erp/app/routes/x+/reimbursements+/$reimbursementId.edit.tsx`
- [ ] `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.post.tsx`
- [ ] `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.recalculate.tsx`
- [ ] `apps/erp/app/routes/x+/revenue-recognition-run+/$runId.repeat.tsx`
- [ ] `apps/erp/app/routes/x+/sales-order+/$orderId.confirm.tsx`
- [ ] `apps/erp/app/routes/x+/sales-return-order+/$id.$lineId.issue.tsx`
- [ ] `apps/erp/app/routes/x+/settings+/accounting.tsx`
- [ ] `apps/erp/app/routes/x+/settings+/invoicing.tsx`
- [ ] `apps/erp/app/routes/x+/settings+/people.tsx`
- [ ] `apps/erp/app/routes/x+/shipment+/lines.tracking.tsx`
- [ ] `apps/erp/test/database/post-charge/post-charge-transaction.test.ts`
- [ ] `apps/erp/test/database/post-reimbursement/post-reimbursement-transaction.test.ts`
- [ ] `apps/erp/test/release-jobs.test.ts`
- [ ] `apps/mes/app/services/inventory.service.ts`
- [ ] `packages/jobs/src/inngest/functions/scheduled/revenue-recognition-proposal.ts`

## B. Files main deleted that the branch modified (deleted in the merge; re-apply the branch diff where the code moved)

- [ ] `apps/erp/app/modules/accounting/period-runs.server.ts`
- [ ] `apps/erp/app/modules/production/production.mcp.server.ts`
- [ ] `apps/erp/app/modules/production/production.server.test.ts`
- [ ] `apps/erp/app/modules/quality/quality-disposition.server.ts`
- [ ] `apps/erp/app/routes/api+/mcp+/lib/mcp-exposure.ts`
- [ ] `apps/erp/app/routes/api+/v1+/lib/dispatch-parity.test.ts`
- [ ] `apps/erp/app/routes/api+/v1+/lib/registry.server.ts`
- [ ] `apps/erp/app/routes/x+/job+/$jobId.status.test.ts`
- [ ] `apps/erp/test/mcp-upsert-job-material.test.ts`
- [ ] `packages/server-functions/AGENTS.md`
- [ ] `packages/server-functions/package.json`
- [ ] `packages/server-functions/src/activate-accounting/legacy/runs.ts`
- [ ] `packages/server-functions/src/activate-accounting/recost.ts`
- [ ] `packages/server-functions/src/company-records.ts`
- [ ] `packages/server-functions/src/convert/index.ts`
- [ ] `packages/server-functions/src/correct-stock-movement/index.ts`
- [ ] `packages/server-functions/src/create-contract-invoices/index.ts`
- [ ] `packages/server-functions/src/create/index.ts`
- [ ] `packages/server-functions/src/get-method/index.ts`
- [ ] `packages/server-functions/src/import-csv/index.ts`
- [ ] `packages/server-functions/src/invoke.ts`
- [ ] `packages/server-functions/src/issue/index.ts`
- [ ] `packages/server-functions/src/lib/calculate-cogs.ts`
- [ ] `packages/server-functions/src/lib/plan-adjustment.ts`
- [ ] `packages/server-functions/src/lib/post-adjustment.ts`
- [ ] `packages/server-functions/src/lib/storage-units.ts`
- [ ] `packages/server-functions/src/post-charge/build-charge-journal.ts`
- [ ] `packages/server-functions/src/post-charge/post-charge-post.ts`
- [ ] `packages/server-functions/src/post-charge/post-charge-void.ts`
- [ ] `packages/server-functions/src/post-customer-contract/index.ts`
- [ ] `packages/server-functions/src/post-customer-contract/schedule-writes.ts`
- [ ] `packages/server-functions/src/post-inventory-adjustment/index.ts`
- [ ] `packages/server-functions/src/post-inventory-count/index.ts`
- [ ] `packages/server-functions/src/post-nonconformance/index.ts`
- [ ] `packages/server-functions/src/post-payment/journal-input.ts`
- [ ] `packages/server-functions/src/post-picking/index.ts`
- [ ] `packages/server-functions/src/post-production-event/index.ts`
- [ ] `packages/server-functions/src/post-purchase-invoice/index.ts`
- [ ] `packages/server-functions/src/post-purchase-invoice/posting-lines.ts`
- [ ] `packages/server-functions/src/post-receipt/index.ts`
- [ ] `packages/server-functions/src/post-receipt/posting-lines.ts`
- [ ] `packages/server-functions/src/post-receipt/void-cost-ledger.ts`
- [ ] `packages/server-functions/src/post-reimbursement/build-reimbursement-journal.ts`
- [ ] `packages/server-functions/src/post-reimbursement/post-reimbursement-post.ts`
- [ ] `packages/server-functions/src/post-reimbursement/post-reimbursement-void.ts`
- [ ] `packages/server-functions/src/post-sales-invoice/index.ts`
- [ ] `packages/server-functions/src/post-shipment/index.ts`
- [ ] `packages/server-functions/src/post-stock-transfer/index.ts`
- [ ] `packages/server-functions/src/preview-revenue-recognition-run/index.ts`
- [ ] `packages/server-functions/src/propose-revenue-recognition-run/index.ts`
- [ ] `packages/server-functions/src/recalculate-revenue-recognition-run/index.ts`
- [ ] `packages/server-functions/src/seed-company/index.ts`
- [ ] `packages/server-functions/src/server-fn-context.ts`
- [ ] `scripts/lib/service-metadata.ts`

## C. Branch-only server-function files (removed; rebuild in their new homes, Phases 3–5 and 8)

Rename detection had moved 38 of these under apps/erp/test/database and modules/shared (deleted there):

- [ ] `apps/erp/app/modules/shared/payroll-total-import.test.ts`
- [ ] `apps/erp/app/modules/shared/payroll-total-import.ts`
- [ ] `apps/erp/test/database/activate-accounting/fixed-asset-cip.test.ts`
- [ ] `apps/erp/test/database/activate-accounting/project-recost.test.ts`
- [ ] `apps/erp/test/database/activate-accounting/project-stripes.test.ts`
- [ ] `apps/erp/test/database/activate-accounting/project-wip.test.ts`
- [ ] `apps/erp/test/database/fixtures/synthesizer-order.test.ts`
- [ ] `apps/erp/test/database/issue/project-issue.test.ts`
- [ ] `apps/erp/test/database/lib/project-always-post.test.ts`
- [ ] `apps/erp/test/database/lib/project-billing-test-fixture.ts`
- [ ] `apps/erp/test/database/lib/project-cip.test.ts`
- [ ] `apps/erp/test/database/lib/project-cip.ts`
- [ ] `apps/erp/test/database/lib/project-journal.ts`
- [ ] `apps/erp/test/database/lib/project-posting-test-fixture.ts`
- [ ] `apps/erp/test/database/lib/project-posting.test.ts`
- [ ] `apps/erp/test/database/lib/project-posting.ts`
- [ ] `apps/erp/test/database/lib/project-revenue.ts`
- [ ] `apps/erp/test/database/lib/right-to-invoice.test.ts`
- [ ] `apps/erp/test/database/lib/sales-return-test-fixture.ts`
- [ ] `apps/erp/test/database/lib/service-orders.test.ts`
- [ ] `apps/erp/test/database/lib/service-orders.ts`
- [ ] `apps/erp/test/database/lib/stock-stripes.test.ts`
- [ ] `apps/erp/test/database/lib/stock-stripes.ts`
- [ ] `apps/erp/test/database/post-inventory-adjustment/project-stock.test.ts`
- [ ] `apps/erp/test/database/post-purchase-invoice/project-charges.ts`
- [ ] `apps/erp/test/database/post-purchase-invoice/project-invoice.test.ts`
- [ ] `apps/erp/test/database/post-receipt/grouped-receipt.test.ts`
- [ ] `apps/erp/test/database/post-receipt/grouped-receipt.ts`
- [ ] `apps/erp/test/database/post-receipt/project-receipt.test.ts`
- [ ] `apps/erp/test/database/post-receipt/project-routes.ts`
- [ ] `apps/erp/test/database/post-receipt/repair.ts`
- [ ] `apps/erp/test/database/post-receipt/sales-return-repair.test.ts`
- [ ] `apps/erp/test/database/post-sales-invoice/post-sales-invoice.test.ts`
- [ ] `apps/erp/test/database/post-shipment/customer-assets.test.ts`
- [ ] `apps/erp/test/database/post-shipment/customer-assets.ts`
- [ ] `apps/erp/test/database/post-shipment/project-stock-shipment.test.ts`
- [ ] `apps/erp/test/database/post-shipment/repair.ts`
- [ ] `apps/erp/test/database/post-shipment/sales-return-repair.test.ts`

The rest, still at their branch paths:

- [ ] `packages/server-functions/src/complete-service-order/complete-service-order.test.ts`
- [ ] `packages/server-functions/src/complete-service-order/index.ts`
- [ ] `packages/server-functions/src/complete-service-order/load.ts`
- [ ] `packages/server-functions/src/complete-service-order/plan.test.ts`
- [ ] `packages/server-functions/src/complete-service-order/plan.ts`
- [ ] `packages/server-functions/src/correct-stock-movement/correct-stock-movement.test.ts`
- [ ] `packages/server-functions/src/create-contract-invoices/insert-invoice.ts`
- [ ] `packages/server-functions/src/create-project-billing-invoices/clin.test.ts`
- [ ] `packages/server-functions/src/create-project-billing-invoices/clin.ts`
- [ ] `packages/server-functions/src/create-project-billing-invoices/create-project-billing-invoices.test.ts`
- [ ] `packages/server-functions/src/create-project-billing-invoices/index.ts`
- [ ] `packages/server-functions/src/create-service-order-invoice/create-service-order-invoice.test.ts`
- [ ] `packages/server-functions/src/create-service-order-invoice/index.ts`
- [ ] `packages/server-functions/src/create-service-order-invoice/plan.test.ts`
- [ ] `packages/server-functions/src/create-service-order-invoice/plan.ts`
- [ ] `packages/server-functions/src/generate-contract-billable-items/generate-contract-billable-items.test.ts`
- [ ] `packages/server-functions/src/generate-contract-billable-items/index.ts`
- [ ] `packages/server-functions/src/post-picking/project-stock-pick.test.ts`
- [ ] `packages/server-functions/src/post-picking/refurbishment-guard.test.ts`
- [ ] `packages/server-functions/src/post-production-event/project-event.test.ts`
- [ ] `packages/server-functions/src/post-project-burden/index.ts`
- [ ] `packages/server-functions/src/post-project-burden/post-project-burden.test.ts`
- [ ] `packages/server-functions/src/post-project-expense/index.ts`
- [ ] `packages/server-functions/src/post-project-expense/post-project-expense.test.ts`
- [ ] `packages/server-functions/src/post-project-issue/index.ts`
- [ ] `packages/server-functions/src/post-project-issue/post-project-issue.test.ts`
- [ ] `packages/server-functions/src/post-project-issue/service.ts`
- [ ] `packages/server-functions/src/post-project-stock-transfer/index.ts`
- [ ] `packages/server-functions/src/post-project-stock-transfer/plan.test.ts`
- [ ] `packages/server-functions/src/post-project-stock-transfer/plan.ts`
- [ ] `packages/server-functions/src/post-project-stock-transfer/post-project-stock-transfer.test.ts`
- [ ] `packages/server-functions/src/post-timesheet/index.ts`
- [ ] `packages/server-functions/src/post-timesheet/plan.test.ts`
- [ ] `packages/server-functions/src/post-timesheet/plan.ts`
- [ ] `packages/server-functions/src/post-timesheet/post-timesheet.test.ts`
- [ ] `packages/server-functions/src/reclass-project-coverage/index.ts`
- [ ] `packages/server-functions/src/reclass-project-coverage/reclass-project-coverage.test.ts`
- [ ] `packages/server-functions/src/save-timesheet-entry/index.ts`
- [ ] `packages/server-functions/src/save-timesheet-entry/save-timesheet-entry.test.ts`
- [ ] `packages/server-functions/src/submit-timesheet-week/index.ts`
- [ ] `packages/server-functions/src/submit-timesheet-week/submit-timesheet-week.test.ts`

## D. Deleted on the branch, kept deleted

- `apps/erp/app/routes/api+/integrations.jira.issue.sync-notes.ts`
- `apps/erp/app/routes/api+/integrations.linear.issue.sync-notes.ts`
- `apps/erp/app/routes/x+/accounting+/projects.$projectId.tsx`
- `apps/erp/app/routes/x+/accounting+/projects.delete.$projectId.tsx`
- `apps/erp/app/routes/x+/accounting+/projects.new.tsx`

## E. Docs merged as a union of both sides (refresh in Phase 9; duplicate or stale lines possible)

- [ ] `.ai/lessons.md`
- [ ] `.claude/rules/commercial-licensing.md`
- [ ] `.claude/rules/fixed-asset-lifecycle.md`
- [ ] `.claude/rules/inventory-system.md`
- [ ] `.claude/rules/jira-integration.md`
- [ ] `.claude/rules/mcp-tools-reference.md`
- [ ] `AGENTS.md`
- [ ] `apps/erp/app/modules/accounting/AGENTS.md`
- [ ] `apps/erp/app/modules/inventory/AGENTS.md`
- [ ] `apps/erp/app/modules/production/AGENTS.md`
- [ ] `apps/erp/app/modules/sales/AGENTS.md`
- [ ] `packages/database/AGENTS.md`
- [ ] `packages/ee/AGENTS.md`
- [ ] `packages/jobs/AGENTS.md`
- [ ] `packages/utils/AGENTS.md`
- [ ] `docs/content/docs/reference/contracts.mdx`
- [ ] `docs/content/docs/reference/planning.mdx`

## F. Generated files taken from main (regenerate in Phases 2 and 9)

- [ ] `apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json`
- [ ] `apps/erp/test/__snapshots__/posting-permissions.test.ts.snap`
- [ ] `packages/database/src/swagger-docs-schema.ts`
- [ ] `packages/database/src/types.ts`
- [ ] `packages/jobs/manifests/schema.json`

## G. Resolved by hand in the merge

UI imports moved to main's file paths; Form, react, documents, ee exports kept from both sides; ee notifications keep the branch's removal of Jira (moved to issue-sync); `usePlanningActions` uses main's `useAction` with the branch's transfer-link toast; `mrp.ts` keeps the branch's split and `plan-company.ts` takes main's `bomChildren` (#1968); `wipe.ts` keeps projectBorrow, projectStockTransfer and trainingAssignment.
