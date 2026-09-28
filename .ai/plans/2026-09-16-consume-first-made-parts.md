# Consume First for made parts — same rule as bought parts

Branch: `supersession-trial-pdf-issues`. Decision (user, 2026-09-16): a made
Consume First predecessor with stock is used up first, exactly like a bought
one. Job creation and MRP both net the old part's on-hand in whole assemblies
and move only the shortfall to the successor.

## Scope

- MRP: a Consume First child of ANY replenishment stays on the predecessor in
  the BOM; the engine nets the predecessor's on-hand per contributor in whole
  assemblies and moves the shortfall to the successor, which then plans as
  itself (explodes its own BOM when Make, surfaces as buy when Buy). Replaces
  the bought-only post-explosion pass in `mrp.ts`, which could not explode a
  made successor.
- Job creation: a Pull from Inventory line for a made predecessor gets the same
  per-line settle as a bought line. Make to Order lines keep the successor swap
  (a Make to Order line never consumes stock, so "use the old stock" has no
  meaning for it, and building the phased-out part fresh is never wanted).

## Tasks

- [x] `lib/mrp-engine.ts`: `explodeBom` takes `consumeFirstRedirect`; levels
      the successor below the predecessor; nets + redirects at the predecessor.
- [x] `lib/mrp-engine.test.ts`: made predecessor nets stock and explodes only
      the successor's BOM for the shortfall; a shallower successor still
      receives the redirected demand; bought behaviour unchanged.
- [x] `packages/ee/src/planning/mrp/mrp.ts`: drop the Make exception in the
      BOM rewrite, pass the redirect map + Phase 4.5 remaining on-hand into the
      engine, delete the post-pass.
- [x] `get-method/index.ts`: `settleConsumeFirstLines` also settles a line
      swapped at creation from a Consume First predecessor (revert to the
      predecessor when it covers a whole assembly); `loadSupersessionRedirect`
      comment restated.
- [x] Docs: `.claude/rules/supersession-system.md`, `.ai/lessons.md`.
- [x] Verify: `deno test --no-lock lib/mrp-engine.test.ts lib/supersession-pick.test.ts`
      in `packages/database/supabase/functions`; `pnpm exec turbo run typecheck --filter=@carbon/ee`;
      `deno check --no-lock get-method/index.ts`.

## Follow-up (same day): Make to Order lines

Decision (user): per-unit matching, bought and made alike; a batch may mix
units, a unit never mixes parts. No line split.

- [x] `get-method`: `loadSupersessionRedirect` returns `{ redirect,
      consumeFirstOnHand }`; `itemToJob` / `itemToJobMakeMethod` row builders
      turn a Make to Order line into Pull from Inventory on the predecessor
      when `consumableInWholeAssemblies(onHand, quantity) > 0`; `madeChildren`
      derived from the built rows.
- [x] Picking excludes Make to Order lines: `generatePickingList` (TS) and
      `get_picking_schedule` (migration `20260908211552`, NOT yet applied).
- [x] Docs: rule + lessons.
- [x] Verify: deno test (37 pass), deno check get-method (no new errors),
      biome (pre-existing warnings only), migration compiled in a rolled-back
      transaction, ERP typecheck.

## Follow-up: gaps 2 and 3 (same day)

- [x] Fix 3 — successor lead time: `explodeBom` places the redirected
      shortfall earlier by the successor's longer lead time, never later.
      Test: "fix 3" in `lib/mrp-engine.test.ts`.
- [x] Fix 2 — chains hop by hop: `buildConsumeFirstHops` +
      `firstStockedInConsumeFirstChain` (lib, tested); MRP Phase 4.5 and the
      engine use hops; both job-creation flows walk the chain for a Make to
      Order line. Test: "fix 2" in `lib/mrp-engine.test.ts`.
- [ ] Fix 1 — job-to-job copies of a converted line: NOT done. Needs made
      sub-assembly explosion inside `jobToJob` (the documented "later layer");
      a copied line has no marker that its BOM source was Make to Order, so
      a partial fix would guess. See the summary to the user.

## Follow-up: Phase 4.5 whole assemblies (same day)

- [x] `netConsumeFirstContributors` (engine, exported, tested) is the one
      per-contributor netting; the engine's redirect and MRP Phase 4.5 both
      use it. Job Material contributors carry `perAssemblyQuantity`.
      Trial: J000038 (2 ASM, 2 OLD per unit, 3 OLD on shelf) now plans
      NEW 2, not 1.

## Follow-up: review findings (same day)

- [x] Make to Buy successor: a Make to Order line with no stocked hop and a
      bought successor is created as Pull from Inventory on the successor.
- [x] Chains: Phase 4.5 runs predecessor-first along the hops; moved
      contributors keep the origin and a converted per-assembly quantity.
      Closes the lineage and actual-demand findings.
- [ ] Job-to-job copies: deferred (needs made sub-assembly explosion in that
      flow). Not in this PR.
- [x] Inline share: not a defect — a Make to Order successor is built inline,
      so no separate production forecast row is correct. Closed, no change.

## Follow-up: quality pass (same day)

- [x] `supersessionMode` typed as the DB enum everywhere it was `string`
      (lib `SupersessionMode`, MRP, ERP picking module, forecast route).
- [x] `resolveMadeLinePull` + `SupersessionContext` replace the duplicated
      Make to Order decision in both job-creation flows.
- [x] Order Status badge reads the substitute item's supply jobs and PO
      lines, so a job raised for the NEW remainder shows "Planned job".
- [x] Every comment added on this branch removed (309 lines, 29 files);
      functional directives kept.
- [x] The two schedule migrations merged into
      `20260908211552_picking-supersession-consume-first.sql`.

## Follow-up: lineside credit (same day)

- [x] One definition of usable lineside stock (`linesideCredit` /
      `get_lineside_credit`): own live picks + unclaimed on-hand, claims only
      from live jobs. Used by the generator (all lines, running balance per
      item+bin), the schedule, and consumption budgets.
- [x] Consume First picks credit staged parts in whole assemblies across both
      items (`splitConsumeFirstPick`, tested); consumption takes a
      predecessor only in whole assemblies.
- [x] Schedule hides an operation only while a list is OPEN.
- [ ] Cancelling a pick list leaves picked material at the lineside bin
      (status flip only). Now harmless — the stock is unclaimed and reused —
      but returning it on cancel is a product decision. Not changed.
