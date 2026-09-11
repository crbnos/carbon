# Feature run: Demand forecast consumption for MRP

- Date: 2026-09-11
- Mode: fully-autonomous through plan; execute gated on Brad's veto
- Branch: mrp-action-suggestions (worktree kelowna)
- Request (verbatim): "we've rewritten a lot of the MRP functionality in this branch -- to move to a planned action approach -- but one problem that we still haven't solved is demand forecasting. the basic problem is double counting. a sales order due date and a projection for the same week should reconcile, such that if there are 10 sales orders and 10 forecasted for the week, there are 10 demands driving MRP and if there are 5 sales orders and 10 forecasted for the week, there are 10 demands driving MRP and if there are 12 sales orders and 10 forecasted for the week, there are 12 driving MRP. this that i described above should be working already, although it's worth an audit to verify. jobs for inventory should work similar to sales orders in that they should net out. but here's the complication: when there are gaps between forecasts (e.g 0 this week, 10 next week, 0 the following week, 10 the week after that), and a sales order comes in that matches a 0, we don't back out the forecast and we end up with a double count. the basic problem we're trying to solve is how do we make the forecasts self-heal to the actuals without requiring communication between sales and production regarding updating the forecast. production should be able to set a rough estimate, and it should be flexible enough to work flexibly without the double counting. let's treat this like a feature"
- Phase plan: research [run — ERP-domain (MRP) logic, force-include] · spec [run — new data model + crosses sales/production/MRP] · plan [run] · execute [run, gated on veto] · test [run — MRP run + forecast UI are user-facing] · self-review [run — default]

## Decisions
- Autonomy gates: research→spec and spec→plan auto-resolved with recommendations recorded in the spec's Open Questions; plan→execute is a HUMAN stop (Brad's veto), per established workflow for domain-heavy features. — 2026-09-11

## Phase log
- Phase 0 (audit): DONE — `.ai/runs/2026-09-11-demand-forecast-consumption-audit.md`. **Belief REFUTED**: no netting exists anywhere; forecast + actuals are summed in 4 places (mrp.ts Phase 4, both planning RPCs' demand_data CTE, planning-actions.ts union). 10F+10SO = 20 demand today. MTS jobs DO net correctly (as supply, via explodeBom running balance). Gap bug confirmed as a special case of "no consumption at all". No test pins current behavior.
- Phase 1 (research): DONE — `.ai/research/demand-forecast-consumption.md`. Consensus: net = actuals + unconsumed forecast remainder, computed regeneratively per plan run; backward-then-forward search; bucket-granular windows for bucket-native forecasts; only demand consumes (jobs are supply); past forecast drops out. Recommended for Carbon: regenerative consumption in runMrp, week-bucket windows, compute-once/read-everywhere.
- Phase 2 (spec): DONE — `.ai/specs/2026-09-11-demand-forecast-consumption.md`. Design: consumeForecast pure fn in @carbon/ee (actuals consume own bucket → backward 4 → forward 1, week-granular), regenerative in runMrp Phase 4 (pre-supersession), persisted as demandProjection.consumedQuantity, GREATEST-subtracted at 5 read sites (2 planning RPCs, planning-actions union, get_inventory_quantities, getItemDemand). New view column quantityToConsume (pre-job-dedup) so covered MTO orders still consume. 9 open questions autonomously resolved (recorded in spec) for veto at plan gate.
- Phase 3 (plan): DONE — `.ai/plans/2026-09-11-demand-forecast-consumption.md`. 10 tasks: pure fn+tests → migration (2 columns + quantityToConsume view column + 3 function forks) → types → runMrp wiring → planning-actions + getItemDemand + settings card + grid annotation (parallelizable) → docs sync → gates + /test (5 browser scenarios). Two spec corrections made during planning: get_inventory_quantities forks 20260716142907 (true newest), and upsertDemandProjections needs no change (PostgREST upserts preserve absent columns).

- GATE RESOLVED: Brad approved spec + plan ("let's execute") — 2026-09-11.
- Phase 4 (execute): started.

## Outcome
- (pending)
