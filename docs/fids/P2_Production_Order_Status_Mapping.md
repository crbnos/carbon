# P2 Production Order Status Mapping

## Source status sets

| Source | Values observed | Evidence | Confidence |
| --- | --- | --- | --- |
| Carbon Job | `Draft`, `Planned`, `Ready`, `In Progress`, `Paused`, `Completed`, `Closed`, `Cancelled` (plus deprecated display categories in the ERP model) | `apps/erp/app/modules/production/production.models.ts`; `jobStatus` enum migration. | `CONFIRMED` |
| Carbon Job Operation | `Todo`, `Ready`, `Waiting`, `In Progress`, `Paused`, `Done`, `Canceled` | `jobOperationStatus` enum in `20240927033740_job-operations-for-mes.sql`. | `CONFIRMED` |
| ERPNext Work Order | `Draft`, `Submitted`, `Not Started`, `In Process`, `Stock Reserved`, `Stock Partially Reserved`, `Completed`, `Stopped`, `Closed`, `Cancelled` | `...erpnext-develop.zip::.../work_order/work_order.json`, `status` Select field. | `CONFIRMED` |
| ERPNext Job Card | `Open`, `Work In Progress`, `Partially Transferred`, `Material Transferred`, `On Hold`, `Submitted`, `To Manufacture`, `Cancelled`, `Completed` | `...erpnext-develop.zip::.../job_card/job_card.json`, `status` Select field. | `CONFIRMED` |
| FIDS canonical status | `normal`, `in-progress`, `completed`, `warning`, `blocked`, `critical`, `cancelled`, `unknown` | `packages/utils/src/fids.ts`. | `CONFIRMED` |

## Existing mappings

The frozen adapter maps only a small validated subset: Carbon/ERP-like
`In Progress` → `in-progress`, `Completed`/`Done` → `completed`, and
`Cancelled`/`Canceled` → `cancelled`. Other values remain `unknown` while the
raw source value is preserved. This is correct conservative behavior, but it is
not a complete Production Order status crosswalk.

## Gate decision

Carbon and ERPNext raw status sets are `CONFIRMED`, but the ERPNext-to-Carbon
cross-system mapping is `REQUIRES_DOMAIN_CONFIRMATION` because transition
authority and lifecycle equivalence are not defined. Do not collapse `Paused`,
`Waiting`, `Ready`, `Closed`, `Draft`, `Submitted`, `Stopped`, or `On Hold` into
a canonical state by guesswork. In particular, an operation paused by parent
Job state is a derived execution view in the latest RPC and must not be mistaken
for an ERPNext status transition.
