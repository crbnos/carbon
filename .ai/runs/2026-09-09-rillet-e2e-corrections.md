# Rillet E2E corrections

Autonomous /fix + TDD. Prior live reproduction proves inverted bill FX and suppressed/unsupported voids; no further instrumentation needed. Root coordinates the overall authorized items 1, 3, 4. This slice owns only Rillet provider behavior and its necessary reconciler plumbing. No commits/push. Plan and red→green/live results: `.context/accounting/e2e-20260909/fix-rillet-plan.md`, `.context/accounting/e2e-20260909/fix-rillet-results.md`.


## Outcome

READY, no commit/push. Proven fixed bill FX direction, native RRO invoice fixed rates/immediate revenue using the Carbon posting date, and complete native invoice/bill/payment void propagation with durable fanout mapping markers and bounded reconciler re-drive. Configuration mappings excluded.

Red regressions recorded before implementation: FX/delete9, document/payment void10, RRO1, reconciler3, posting-date1. Final focused checks: EE197 PASS, jobs142 PASS, EE/jobs scoped typechecks exit0, Biome18 files no errors (existing warnings).

Fresh sandbox evidence: eleven native documents matched independently fetched GL across USD/EUR/JPY/BHD, shipping and tax; customer payment169.08 fanned out to2 native payments and supplier100 to1. Real HTTP payment voids reopened all native documents; real invoice/bill voids plus reconciliation/drain deleted all11. Final GL contains zero entries under the fresh prefix, including the removed API-only contract probe. Replays enqueued0. No emails sent, no browser session. Inbound webhook and unconfigured Xero/QBO not live tested; FX payment push remains an existing unsupported case.

Full report: `.context/accounting/e2e-20260909/fix-rillet-results.md`. Updated successful cache: `.ai/playbooks/rillet-provider-accounting.md`.
