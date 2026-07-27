# Bugfix run: Inbound-inspection reject posts no inventory write-off

- Date: 2026-07-26
- Mode: fully-autonomous (stop at READY; commit only on explicit ask)
- Request: Rejecting a non-tracked Inventory inbound-inspection lot posts no negative
  inventory adjustment and no scrap-account journal. Ordered 5, rejected 5 (no -5),
  NCR disposition use-as-is 3 (+3) → 8 on hand instead of 3.

- Phase plan: root-cause [done — HIGH] · instrument [skip — HIGH confidence] ·
  fix [run] · test [run — route-action unit test] · commit [skip — no explicit ask]

## Decisions

- instrument: skip — root cause HIGH, statically proven (git diff shows the engine
  returns `writeOff` while committed HEAD reject route ignores it) — 2026-07-26
- test approach: route-action unit test on `$id.reject.tsx` (mock requirePermissions +
  dispositionInspection + fake client.functions.invoke), per traceability.search.test.ts
  precedent — the defect is a missing route→edge-function call, so the route is the unit.

## Phase log

- root-cause: HIGH. 868f5c1bf moved the itemLedger reject write-off out of
  `dispositionInspection` (now returns a `writeOff` descriptor); ERP reject route was
  not updated to post it via `post-nonconformance`. Working tree already adds the wiring
  but still swallows a failed post (logs + continues), so a failed write-off silently
  proceeds to NCR creation whose Use-As-Is restore double-counts.

- fix: hardened `$id.reject.tsx` — a failed `post-nonconformance` write-off now
  surfaces (flash error) and aborts before NCR creation, instead of logging and
  proceeding. Wiring (writeOff → post-nonconformance) confirmed present/correct.
- test: added `$id.reject.test.ts` (3 cases). RED baseline: test 3 failed
  (getInspection called after swallowed error); committed HEAD had 0 writeOff
  references (wiring regression baseline). GREEN after fix: 3/3 pass.

## Outcome

- READY (not committed — no explicit ask). Gates: generate:types SKIP · biome PASS ·
  typecheck(erp) PASS · test(erp quality+inspection) PASS 13/13.
- Note: primary wiring fix was pre-existing uncommitted working-tree work; this run
  adds the failure-surfacing hardening + the regression test that locks both.
