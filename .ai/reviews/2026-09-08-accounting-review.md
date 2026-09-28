# Accounting PR review resolution

PR: https://github.com/crbnos/carbon/pull/1599 · CodeRabbit review: 5149438993 · Base: origin/main

The review contains six inline findings and 34 additional body findings. Every suggestion was checked against source and the approved exact-document-principal contract. The original nuclear review's eight implementation blockers are also addressed by the same correction pass.

## Suggestions not applied

| Finding | Evidence and disposition |
| --- | --- |
| 3964376569 — absolute original controls | Rejected. Actual AR and AP posting tests show +100/−10 originals must carry 90; absolute sums produce 110 and fictitiousFX 20. Signed amounts are correct. Original-role selection excludes `VOID:` reversals and now includes intercompany controls. |
| f1e4f000272bb8e20b387272 — reject zero rounded memo base | Rejected. Positive document principal may legitimately have zero rounded carrying base at high rates. The approved contract explicitly preserves it; conversion, composer and transaction regressions cover the final document minor unit. Restoring a fixed base threshold would reintroduce the bug. |
| 3964376574 — hand-add `nullable: true` to generated Swagger | Not applicable to the proposed patch. The generator emits Swagger2.0; `nullable` is an OpenAPI3 keyword. The property is absent from `required`, its schema-derived description explains NULL, and regenerated database types already express `string | null`. Optional omission does not fully express nullable responses: this is an inherited Swagger2 generator limitation, not proof that the API schema fully models nullability. A general OpenAPI format/nullability migration is outside these accounting corrections; no generated file was hand-edited. See [OpenAPI data types](https://swagger.io/docs/specification/v3_0/data-models/data-types/). |

## Confirmed code corrections

| Findings | Resolution |
| --- | --- |
| 3964376617 | Block consumed memo void under the same memo lock used by payment posting; reverse consumer first. Actual database red→green proves state/journal preservation and voided/Draft consumer behavior. |
| 3964376632 | Remove transaction commands from both runner-managed migrations and the stale planning-only preamble; reapply both inside one explicit local transaction. |
| 3964376646 | Exclude an entire memo with unknown effective consumed principal from open reports rather than fabricate an amount; preserve historical cutoff behavior. |
| 3964376653 | Evict rejected QBO tax-catalog promises; successful results stay cached. |
| fbe0d40c67975a6bcdaad6b5 | Guard missing inbound QBO AccountRef values without discarding valid remaining lines. |
| 5fba2f61b8386f675bc17a62 | Surface the specific invalid-account mapping reason; defaults update is now one atomic write. |
| db120fa1c4e0be4c6945e0ac | Round merged source principal in payment history, including0.1+0.2 regression. |
| da7c4995cf1dcb3130d58092 | Empty state, footer and Auto apply use the actual filtered rows. |
| ae0f05254d816a6ea1a68c03 | Derive costing tolerance from the shared storage scale. |

## Test and documentation corrections

| Findings | Resolution |
| --- | --- |
| 3c626ca8c2fbc566e19f7ae9 | Replace audit workstation links with repository-relative paths and line anchors. |
| 91c762fb1f2a30a287c18ad3 | Correct stale QBO rate/amount comments. |
| f405311f2bae935b5fc1903e | Diagnose absent local database environment before URL parsing. |
| c6ef98b3b2672adcf835f170 | Document all deliberate pure edge-shared utility exports; typechecks and ERP production build verify consumer integration. |
| c7f5816baa88bb1099cabc03 | Keep settlement constraints in the posting-corrections suite; shipping suite owns only backfill/schema behavior. |
| a52d17dac257d5da125de7d2 | Use private P9001 rollback sentinels so real data exceptions fail tests. |
| 85ba658d52ba21d5ae138e14, 547d5ba6f453b5e86ca0559a | Move purchase imports and payment sql import to module scope. |
| ffd8973dc020f76c8c5c5e62 | Remove tautological void arithmetic. Keep actual posting amount/class balance assertions and actual transaction reversal tests; do not assert raw natural-balance amounts sum to zero. |
| 1813ebb0eb02c683cc0b782b | Assert captured tax-preflight error outside catch so test assertion failures keep their original diagnostic. |
| ba9322a2dc4d8d58ad8e56c2 | Add AR/AP multiple-application control-relief tests with distinct target rates and both discount/write-off components. |

## Translation findings

The following findings concern existing ERP catalog entries: payment credits versus ledger credit-side postings, FX gain/loss amounts versus exchange rates, shipping fees billed to customers, and payment allocation wording. Corrections preserve interpolation placeholders and existing glossary context.

- ru: 7c30c2aa8fb5ccaf93a02660
- tr: e9e359b39cba6f90a01ff75a
- zh: f8d04513831c380ec73be3cf
- de: e728fd7345c4e40f75f65f2a
- es: eff660e22867607cea45da3e, 9a53d72300ad16622164bd0a
- hi: 3593041ebfacbfa7fbacf53c, 948f60c52ccd8abc79ede39f
- it: af571f7ae773e5cb490dba2a, 418f6c9f2c4886a2eb8f00ed
- ja: b5af53bbce73660d465e75c4
- ko: 9c7696bef38ae0a3882d2e11, 8f2e8ed800b61e54038dd683
- pl: b89ded439c738afb78486f20, 55909a2216821c62a0f4cccb, fe4450c455c7688a28425a2c
- pt: f9ea9e09ae2d06aa85980c85

## Nuclear review corrections

Signed controls, original shipping/AP account provenance, supported Xero monetary lines, complete invoice/report reads, exact manual memo principal, authorized root CTA access, shared balance/source rules, and atomic defaults writes have focused regressions. Historical inactive chart leaves and ancestors remain included. Account roles come from an exhaustive original journal vocabulary; transport queries retain company/group/source/status scopes.

The safe test launcher is tracked at `scripts/run-local-accounting-check.ts`. Run it from the repository root with an existing local database; it loads local environment without printing credentials and refuses non-local URLs. It never creates or resets a database. Reproduction commands and final gate outcomes are in [the correction plan](../plans/2026-09-08-accounting-review-corrections.md) and [run log](../runs/2026-09-08-accounting-review-corrections.md).

## Remaining evidence boundary

Provider tests exercise real adapter/query/serialization paths with mocked external transport. No live provider writes were made. Independent Xero returned-ledger acceptance and Rillet rate-direction/base-ledger behavior require connected-provider evidence; no claim of that acceptance is made. Existing direct G/L descriptions may collide with original role labels; AP reconciliation refuses an inconsistent replay rather than guessing. France/e-invoicing and historical cutover machinery remain outside the approved scope.
