# Feature run: Sales order delivery date check

- Date: 2026-11-10
- Mode: fully-autonomous
- Request: "create all this in 1 pr instead of 3 and what do you suggest for the questions? and write the spec and then implement it and why you wont build the 'Holding stock or capacity for an accepted order.'?"
- Phase plan: research [skip — done: `.ai/research/order-promising-time-fence.md`] · spec [run] · plan [run] · execute [run] · test [run if a dev stack runs for this worktree, else skip and say so] · self-review [run]

## Decisions

- Scope: one PR with 3 check levels (Lead time, Stock, Capacity) — the user asked for one PR — 2026-11-10
- Research question 1 (days or weeks): weeks — the user decided — 2026-11-10
- Research question 2 (lead time of a make item): the cumulative lead time through the BOM — the user decided — 2026-11-10
- Research questions 3, 4, 5: my suggestions, the user said "sounds good" — 2026-11-10
- Meaning of `itemReplenishment.leadTime` on a make item: the own build time of one batch, so the cumulative lead time adds the components — the glossary term `item-manufacturing-lead-time` defines it so — 2026-11-10
- Name of the fence: no separate fence setting; the fence is the calculated cumulative lead time, so no name clashes with `planningTimeFenceDays` — avoids a new setting and the clash — 2026-11-10
- Holding stock or capacity: out of scope — see the spec — 2026-11-10
- Spec gate: open questions resolved (5 by the user, 5 autonomous) — the user asked to write the spec and then implement — 2026-11-10
- UI of the warning: inline alert, never a block — `useRuleViolations` treats any other payload as success, and the check never blocks — 2026-11-10
- Plan gate: approved autonomously; 18 tasks in `.ai/plans/2026-11-10-sales-order-delivery-date-check.md` — the user asked to implement after the spec — 2026-11-10

## Phase log

- research: skipped, file exists
- spec: `.ai/specs/2026-11-10-sales-order-delivery-date-check.md` written; 5 autonomous resolutions in its Open Questions; STE-80 pass done
- plan: `.ai/plans/2026-11-10-sales-order-delivery-date-check.md` written; STE-80 pass done
- execute: 18 tasks done, 7 commits; 3 deviations recorded in the plan
- test: 8 browser checks passed; playbook `.ai/playbooks/sales-order-delivery-date-check.md`
- self-review: docs freshness fixed (planning, sales, items AGENTS.md; spec changelog); 2 risks reported to the user

## Outcome

- PR https://github.com/crbnos/carbon/pull/2182
