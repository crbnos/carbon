# Self-review fixes for crbnos/carbon#1937

Branch: `refactor/service-functions`. Source: the branch self-review of 2026-10-17
(nine slice reviews and nine port comparisons). The user asked to resolve every finding.

## Decisions

These are the defaults this plan applies. Each one is reported to the user, who can
override it.

| # | Question | Decision |
|---|---|---|
| D1 | A service function's permission differs from its old route | Use the permission the old flow enforced in effect: the route's gate plus the RLS of the writes it made. Where the write now bypasses RLS (Kysely, service role), the function needs what that RLS needed. |
| D2 | Published tools the branch removed | Keep the removals the migration plan made. Restore two capabilities that external callers used: `completeOperation` (production) and `mergeTrackedEntities` (inventory), as service functions. |
| D3 | Cancelling a job sweeps its picks | Keep the sweep (the PR states it). Run it after the guarded status update, so a refused cancel returns nothing. |
| D4 | Printer route and reprint tools post to any URL | Do not publish them. The UI keeps them. |
| D5 | `importChartOfAccounts` and `enableAccountingCutover` are published | Do not publish them. |
| D6 | `SESSION_SECRET` signs MES system postings | Keep it. The internal-call key is derived with its own HKDF label. |
| D7 | Redis down: the internal endpoint accepts a call without the replay check | Keep (a deliberate earlier fix). Treat a timed-out SET as unknown, not as a replay. |
| D8 | MES posting retries can double-post | Idempotency is spec-only in the migration plan. Do not add a client timeout: it makes a split more likely. Classify config errors apart from network errors. |
| D9 | Onshape content ids assume deterministic exports | Not verifiable without an Onshape account. Keep. Recorded in the plan's risks. |
| D10 | Purchase order status route and delete now refuse late statuses | Keep: they close a state-machine bypass. State them in the PR description. |
| D11 | UX regressions (period run redirect, Make to Asset field error, Planned re-save) | Restore the old behaviour. |
| D12 | Changelog entry for renamed tools and the workflow gate | Ask the user. The migration rule says a changelog is written only when asked. |
| D13 | Logger namespaces of the ported postings | Use `getLogger("erp", "<module>")` everywhere. No Axiom monitor filters on the old names (checked). |

## Work, by area

Each area is one owner. An owner edits only its own files, so the areas can run at the
same time. Nobody commits; the lead runs the checks and commits each area.

- [x] A. Platform: `stamp`, error mapping, nested gate, generator, cache inputs, checks
- [x] B. MES and the internal postings endpoint
- [x] C. Inventory
- [x] D. Production
- [ ] E. Items, quality, resources, people, documents
- [x] F. Sales and purchasing
- [x] G. Accounting and invoicing
- [x] H. Shared, settings, users, and the posting runner
- [x] I. Model pipeline and assembler
- [ ] Lead: manifest regeneration, typecheck, tests, Biome, commits, PR description, lessons

The finding list for each area is in the area owner's brief. The final report lists every
finding with its resolution.
