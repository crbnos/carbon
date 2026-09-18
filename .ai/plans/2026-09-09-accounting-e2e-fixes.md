# Fix the accounting E2E findings selected by the user

User request: “fix 1, 3, and 4” from the previous final summary: Rillet provider correctness; payments/memos/refunds/published settlement API; historical reports/pagination. Integration configuration (item 2) and the pre-existing asset master void gap remain outside this requested fix.

Evidence: [executed E2E report](../runs/2026-09-09-accounting-e2e.md). Root causes are proven against code and real local/provider API responses. Work autonomously through focused failing regression → minimal integrated fix → scoped checks → fresh live verification. Preserve existing workspace changes, no database rebuild, no credentials in artifacts. No new commit or push requested for this turn.

- [x] Rillet bill FX: fix directed pair and reciprocal; unit and live provider GL proof.
- [x] Rillet lifecycle: propagate invoice, bill and payment voids through operation creation/drain, handle retries and actual provider refusal states; verify remote documents and GL.
- [x] Rillet AR FX/revenue: establish supported representation from primary docs/live API, implement exact book fidelity, verify independent remote GL. Do not silently skip discrepant cases or count provider HTTP success as fidelity.
- [x] Memo principal: round remaining source-document currency before comparison, customer and supplier final-cent regressions and fresh post/void.
- [x] Refunds: keep ledger party independent of cash direction across UI, application service, posting, aging/tie-out; exact source memo/prior-payment relief and reversal.
- [x] Published API: derive required createdBy injection from service argument contract; regression uses actual dispatch and auth context, then real scoped HTTP request.
- [x] Reports: include inactive historical leaves/ancestors; reject out-of-group report selections; preserve valid child-only parent CTA.
- [x] Application lists: page all results and fail closed on late-page errors; real max_rows1000 browser proof for payment/invoice.
- [x] Apply new migrations together, regenerate types, format/lint changed files, scoped ERP/EE/jobs typechecks and tests, dataset/backup checks.
- [x] Review final diff, refresh durable rules/playbooks and produce final proof report.

Ownership: Rillet agent owns EE/jobs provider flow; payment agent owns invoicing/payment service and edge logic; reports agent owns report/refund SQL and only the two invoice-settlement read functions in invoicing.service.ts. Root owns API metadata/dispatch contract tests, payment form/composer/route, integration review, migration application/type generation and broad gates. Agents coordinate patches in the shared service file; no generated artifacts edited manually.

Completed locally. Evidence and validation exceptions are recorded in [the final verification report](../runs/2026-09-09-accounting-e2e-fixes.md#final-verification).
