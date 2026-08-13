# MRP: measured findings from the production snapshot

Measured 2026-08-12 against a restored production cluster dump
(`<production cluster dump>`, 1,634 companies, 18,542 items, 15,095 make
methods, 12,534 method materials, 24,310 `itemLedger` rows — amplified to 8M
ledger rows for one tenant during the `itemStockQuantities` benchmark). All
numbers are from real runs, not estimates. Companion work: the incremental
`itemStockQuantities` table (branch `sid/item-dropdown-inventory-refresh`,
commit `54416a34bb`).

## Bugs found (ranked)

### 1. CRITICAL — MRP hard-fails for tenants with hyphenated (imported) item ids — **FIXED 2026-08-12**

Fixed on `sid/item-dropdown-inventory-refresh`: composite keys now join on a
control character (`KEY_SEP = "\x1f"` in `lib/mrp-engine.ts`), every inline key
construction in `mrp/index.ts` goes through `makeKey` / `makeLocationItemKey` /
`makeActualKey`, and Deno regression tests cover hyphenated ids in every key
position (`lib/mrp-engine.test.ts`). Verified live: the failing tenant returns
201 with 256 demandActual + 29 supplyActual rows, all full UUIDs, zero orphan
refs; the giant tenant's output is byte-identical pre/post fix.

`mrp/index.ts` Phase 6 rebuilds composite map keys with naive splits:

```ts
// key layout: `${itemId}-${locationId}-${periodId}-Sales Order`
itemId: key.split("-")[0], locationId: key.split("-")[1], periodId: key.split("-")[2]
// and for supply: const [locationId, periodId, itemId] = key.split("-")
```

`item.id` is TEXT and the import pipeline accepts caller-supplied ids, so
migrated data can carry any id shape. In the snapshot, 330 items across 3
tenants have **UUID v5** ids (deterministic name-based — the fingerprint of a
bulk import minting idempotent ids; all created in single-day batches per
tenant). A hyphenated itemId is truncated to its first segment by the split,
distinct (item, period) pairs collapse to the same tuple, and the batched
insert dies with Postgres error 21000 (`ON CONFLICT DO UPDATE command cannot
affect row a second time`). Reproduced: tenant `tenant-B` (all
229 open-line item ids are UUIDs) → HTTP 500 every run. Because ids arrive via
onboarding imports, the affected population is *recently migrated customers*,
and it grows with every data migration — not a frozen legacy set.

- **Silent in production.** The 3-hourly scheduler (`scheduled/mrp.ts:34-43`)
  logs `result.error` and continues. Production evidence: that tenant has
  **zero `demandActual` rows** in the snapshot — MRP has never completed for
  them.
- **Partial-write corruption on every failure — FIXED 2026-08-12.** The run
  deleted and rewrote `demandForecast` (+source) successfully, then crashed at
  `demandActual` — affected tenants carried fresh forecasts and permanently
  empty actuals. Phase 7 is now one Kysely transaction. Proven by fault
  injection: with a poisoned trigger on the LAST table written, the run 500s
  and `demandForecast` is untouched to the microsecond (previously it was
  wiped and rewritten before the crash).
- Blast radius in the snapshot: ≥4 tenants with hyphenated item ids in open job
  demand.
- Fix shape: stop round-tripping through string keys — carry structured
  `{itemId, locationId, periodId}` values in the maps (or reuse `splitKey`,
  which already handles hyphenated ids by position). Small, mechanical.

### 2. HIGH — input truncation at PostgREST `max_rows` (prod-only) — **FIXED 2026-08-12**

Fixed: all PostgREST reads in `mrp/index.ts` paginate via `lib/fetch-all.ts`
(1000-row pages, stable `.order()`), including the Phase-6 `demandActual` /
`supplyActual` reads, which also exceeded the cap (9,391 rows observed — in
prod their zeroing pass was truncated too). Verified: the tenant whose inputs
span multiple pages (2,497 job lines, 9,391 actuals) produces byte-identical
output to the unpaginated baseline.

Phase-1 loads use bare `.select("*")` with no pagination. Production
`config.toml` sets `max_rows = 1000`; the crbn dev stack does **not** enforce it
(verified empirically: 2,497 rows returned locally), which is why this is
invisible in dev. Snapshot tenants over the limit: `tenant-A`
(2,497 open job material lines) and `tenant-B` (1,495). In prod
those tenants plan on a silently truncated demand picture. Fix:
`fetchAllFromTable`-style pagination for the five Phase-1 reads.

### 3. MEDIUM — self-referencing BOMs exist in production data — **BOM layer FIXED 2026-08-12**

Fixed in `20260812030545_bom-self-reference-guard.sql`: the 6 `methodMaterial`
self-references deleted (all confirmed accidental: 4× tenant-E purchased
hardware, 1× tenant-F mis-pick, 1× test-tenant junk), and a **sync
interceptor** (`sync_check_method_material_self_reference`, wired via
`attach_event_trigger`) now vetoes both shapes on write — item on its own BOM,
and `materialMakeMethodId = makeMethodId`. Verified: both vetoes fire with
`check_violation`, legitimate BOM lines still insert.

**Job layer also FIXED 2026-08-12** (`20260812032423_job-material-self-reference-guard.sql`),
by product decision: self-consumption benefits no one and should have been
prevented from the start. `jobMaterial` rows where the job consumes its own
output item numbered **50 across ~20 tenants** — most added directly on jobs,
not copied from BOMs. All 50 deleted; a sync interceptor
(`sync_check_job_material_self_reference`, PREPENDED to jobMaterial's existing
interceptor chain) now vetoes the class on every write path. Deletion nuance
that mattered, and that a first pass got WRONG: the cascade chain
(`jobMaterial → jobMakeMethod → jobOperation`) reaches SIX child tables —
`productionEvent` (labor/time), `jobOperationTool`, `jobOperationStep`,
`jobOperationParameter`, `rework`, `nonConformanceJobOperation`. Only
`productionQuantity` is `NO ACTION`; it raises, which is the only reason the
problem was noticed at all. The others delete silently. A first version of this
migration detached only subtrees containing `productionQuantity` and did
destroy a labor record on the restored snapshot (`productionEvent` 3,159 in the
backup → 3,158 after). The shipped version detaches every subtree containing
ANY `jobOperation`, so the cascade can never reach an operation; only empty
method copies are collected. Re-proven by probe: labor 1→1, operation kept,
self-consuming line deleted. Verified: 0 self-rows remain, veto fires,
legitimate materials insert, existing interceptor chain intact.

**Lesson worth generalizing:** before writing any data-deleting migration,
enumerate the full `ON DELETE` graph (`pg_constraint.confdeltype`) — a
`RESTRICT`/`NO ACTION` edge fails loudly and teaches you; every `CASCADE` edge
is silent and is where the data actually goes.

6 `methodMaterial` rows across 3 tenants list an item as a component of itself
(one at quantity **100**): 4 purchased-hardware parts in `tenant-E`, 1 in
`tenant-F`, and 1 junk row in a test tenant.
`computeLowLevelCodes` survives via its `visited`
guard (silently truncating the cycle); `explodeBom` does not loop but generates
self-demand that is never netted — inflated, wrong requirements for those items.
Two-part fix: a DB guard (`CHECK`/trigger rejecting `mm."itemId" =
makeMethod."itemId"`, plus data cleanup) and explicit cycle detection in the
engine (comes free with the Kahn rewrite below).

## Before/after benchmark (same DB, same 8M-row ledger, 2026-08-12)

End-to-end MRP, 5 runs per tenant, best-of reported (edge function via HTTP):

| Tenant | Shape | Before | After | Change |
|---|---|---|---|---|
| `tenant-C` | mid-size, 1,739 BOM edges | 0.52 s | **0.084 s** | 6× faster |
| `tenant-A` | giant, 8M ledger rows | 17.5–20.4 s | **0.226 s** | **~85× faster** |
| `tenant-B` | imported UUID item ids | **HTTP 500** (every run, since onboarding) | **0.207 s** | now works at all |
| `tenant-D` (tenant-D) | contains a BOM cycle | silently mis-planned | **0.036 s** + logged warning | now correct + visible |

Component: the on-hand input, both queries measured back-to-back on the same
data —

| On-hand input | Time |
|---|---|
| OLD: `SELECT itemId, locationId, SUM(quantity) FROM itemLedger WHERE companyId=… GROUP BY` | **19.8–20.3 s** |
| NEW: `SELECT … FROM itemStockQuantities WHERE companyId=…` | **0.27–5.6 ms** |

The old query's plan explains the whole run: `Buffers: shared hit=840
read=399986` — ~3 GB read from disk per run, I/O-bound, and it does not warm up
across repeats (the table is 6 GB against a much smaller `shared_buffers`).
NOTE: an earlier probe in this document measured 0.8–1.7 s for "the same"
query; that was a `count(*)` wrapper measured immediately after the amplifying
writes, i.e. a different plan against warm page cache. The ~20 s figure is the
honest steady state, and it matches the observed 17.5–20.4 s end-to-end run.

### Low-level codes: Kahn vs path enumeration

On real customer BOMs the two are equivalent (worst real case 2.03 ms → 0.49 ms,
4.1×) — the exponential blowup is NOT triggered by current data, as first
measured. But the risk is real and cheap to demonstrate on a *tiny* graph
whose node count grows linearly while root-to-node paths grow exponentially:

| Layers | Nodes | Edges | Old | Kahn | Speedup |
|---|---|---|---|---|---|
| 8 | 18 | 32 | 0.59 ms | 0.106 ms | 6× |
| 12 | 26 | 48 | 4.19 ms | 0.023 ms | 181× |
| 16 | 34 | 64 | 59.0 ms | 0.031 ms | 1,927× |
| 18 | 38 | 72 | 211.5 ms | 0.034 ms | 6,283× |
| 20 | 42 | 80 | **851.8 ms** | 0.038 ms | **22,639×** |

A **42-node** BOM — trivially small — took the old implementation 0.85 s, and
each added layer roughly quadruples it. Reuse-heavy nesting like this is normal
in electronics and aerospace assemblies, so this was a live landmine for the
next customer with a deep BOM, not a theoretical one.

## Performance baselines (measured)

| Scenario | Wall time |
|---|---|
| Full company MRP, mid-size tenant (`tenant-C`, 1,739 BOM edges, 199 methods) | **0.52 s** |
| Full company MRP, giant tenant (`tenant-A`, 3,330 BOM edges, 8M-row amplified ledger) | **17.5–20.4 s** |

Attribution for the giant (sampled `pg_stat_activity` during the run + direct
query timing):

| Component | Cost |
|---|---|
| `itemLedger` GROUP BY on-hand input (8M rows) | ~6–8 s from the function's connection (0.8–1.7 s via psql — plan/streaming difference) |
| The four open-demand/supply view reads | < 50 ms total server-side |
| `activeMakeMethods` + `methodMaterial` | < 35 ms |
| Output writes (~19k rows, sequential 500-row batches) + PostgREST round-trips + Deno CPU | the remaining ~10 s, unattributed at finer grain (needs in-function instrumentation) |

**Lever confirmed:** the on-hand input read from the new `itemStockQuantities`
table is **0.15 ms** vs 812 ms–1.7 s for the raw GROUP BY at 8M rows — but note
the semantic difference: MRP currently sums raw quantity (Rejected included),
the table excludes Rejected. Adopting it is a deliberate correctness decision,
not a drop-in.

## Low-level-code verdict: no real-world blowup (hypothesis falsified)

`computeLowLevelCodes` **used to** enumerate root-to-node paths with a copied
`visited` Set per child — worst-case exponential on diamond-heavy BOMs.
Measured against every company's real BOM: worst case **1.62 ms** (`tenant-A`,
1,133 items / 3,330 edges); the Kahn longest-path implementation agreed on
every acyclic input and was at best 2.4× faster. Current customer BOMs are too
shallow/narrow to trigger the explosion, so the hypothesis was falsified on
real data. Kahn **shipped anyway** and is now the implementation — not for
speed on today's data, but because it *detects* the real cycles above instead
of silently truncating them, and because the exponential case is trivially
reachable (a 42-node synthetic BOM took the old code 852 ms; see the table
above).

## Recommended order (updated by evidence)

1. **Fix the key-parsing bug** (structured keys / `splitKey`) — restores MRP for
   UUID-id tenants. Trivial diff, big blast radius.
2. **Make the output write transactional** — **DONE 2026-08-12** (Phase 7 in one
   Kysely transaction; rollback proven by fault injection).
3. **Paginate the inputs** — **DONE 2026-08-12** (`lib/fetch-all.ts`; Phase 1
   AND the Phase-6 actuals reads; multi-page output byte-identical).
4. **BOM cycle guard + Kahn rewrite** — **DONE 2026-08-12.**
   - `computeLowLevelCodes` is now Kahn's longest-path (O(items + edges),
     replacing worst-case-exponential path enumeration) and returns
     `cycleItemIds`. `explodeBom` plans cycle members as LEAF items (their own
     demand still nets; nothing explodes through them) and the run logs a
     warning via `getFunctionLogger` naming company + items — no longer
     silently wrong, and one corrupt loop no longer fails a whole company.
   - The `methodMaterial` interceptor gained a recursive-CTE reachability walk
     (active methods, per company, UNION-deduped so it terminates over
     existing cyclic data, depth-capped): writes that would close a
     multi-node cycle (A→B→A) are vetoed at the door.
   - A real multi-node cycle was found in prod: tenant-D,
     A → B → C → A (1 active job on those items).
     Grandfathered data — their MRP now runs green with the warning logged;
     editing inside the loop will veto until they break it.
5. **Read on-hand from `itemStockQuantities`** — **DONE 2026-08-12.** Semantics
   decided: Rejected stock excluded (matches `get_inventory_quantities`; exactly
   one tenant / 10 units were affected by the change). Measured effect: the
   8M-row tenant's full MRP run dropped from ~20 s to **~0.3 s** with
   byte-identical output (7,953 demandActual rows, same quantity sum) — the
   entire history-scaling cost was the ledger scan.
6. Net-change/dirty-skip scheduling and per-company fan-out — the big
   architectural wins, justified once 1–5 land; a full run for a normal tenant
   is already ~0.5 s, so event-driven near-realtime MRP is viable after the
   correctness fixes.

Items 1–3 are correctness bugs and jump the queue over every optimization.
