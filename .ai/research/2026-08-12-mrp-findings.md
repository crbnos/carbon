# MRP: measured findings from the production snapshot

Measured 2026-08-12 against a restored production cluster dump
(`db_cluster-07-08-2026@09-15-19`, 1,634 companies, 18,542 items, 15,095 make
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
affect row a second time`). Reproduced: tenant `2QHYS5kvVmu4Jsi6EXh33q` (all
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
invisible in dev. Snapshot tenants over the limit: `d0rlmp5l6de2s779lqi0`
(2,497 open job material lines) and `2QHYS5kvVmu4Jsi6EXh33q` (1,495). In prod
those tenants plan on a silently truncated demand picture. Fix:
`fetchAllFromTable`-style pagination for the five Phase-1 reads.

### 3. MEDIUM — self-referencing BOMs exist in production data

6 `methodMaterial` rows across 3 tenants list an item as a component of itself
(one at quantity **100**): PRT-101641/101820/102065/102136
(`cs868u84gfk07v78v9e0`), 11760760 (`ctk2vr84gfk0jrv92r1g`), 000000001
(`LxozrftWzReZ49VbgF45fx`). `computeLowLevelCodes` survives via its `visited`
guard (silently truncating the cycle); `explodeBom` does not loop but generates
self-demand that is never netted — inflated, wrong requirements for those items.
Two-part fix: a DB guard (`CHECK`/trigger rejecting `mm."itemId" =
makeMethod."itemId"`, plus data cleanup) and explicit cycle detection in the
engine (comes free with the Kahn rewrite below).

## Performance baselines (measured)

| Scenario | Wall time |
|---|---|
| Full company MRP, mid-size tenant (`cvnu…`, 1,739 BOM edges, 199 methods) | **0.52 s** |
| Full company MRP, giant tenant (`d0r…`, 3,330 BOM edges, 8M-row amplified ledger) | **17.5–20.4 s** |

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

`computeLowLevelCodes` enumerates root-to-node paths with a copied `visited`
Set per child — worst-case exponential on diamond-heavy BOMs. Measured against
every company's real BOM (script: `scripts/bench-mrp-llc.mjs`): worst case
**1.62 ms** (`d0r…`, 1,133 items / 3,330 edges); a Kahn's-algorithm longest-path
reference agrees on every acyclic input and is at best 2.4× faster. Current
customer BOMs are too shallow/narrow to trigger the explosion. The Kahn rewrite
is still worth taking — not for speed, but because it *detects* the real cycles
above instead of silently truncating them.

## Recommended order (updated by evidence)

1. **Fix the key-parsing bug** (structured keys / `splitKey`) — restores MRP for
   UUID-id tenants. Trivial diff, big blast radius.
2. **Make the output write transactional** — **DONE 2026-08-12** (Phase 7 in one
   Kysely transaction; rollback proven by fault injection).
3. **Paginate the inputs** — **DONE 2026-08-12** (`lib/fetch-all.ts`; Phase 1
   AND the Phase-6 actuals reads; multi-page output byte-identical).
4. **BOM cycle guard** + data cleanup for the 6 self-referencing rows; swap
   `computeLowLevelCodes` for Kahn (cycle detection included).
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
