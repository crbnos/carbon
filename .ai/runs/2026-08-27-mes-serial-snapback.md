# Bugfix run: MES snaps back to latest serial, can't select a previous SN

- Date: 2026-08-27
- Mode: fully-autonomous (non-interactive session; user answered "run /fix" to the offered diagnosis)
- Request: "Customer reported Bug in MES, won't allow us to go back to a previous SN in a batch job, keeps defaulting to the latest. Previously this has worked"
- Phase plan: root-cause [done — inline in conversation, HIGH] · instrument [skip — cause proven by code reading + git history] · fix [run] · test [skip — pure-logic regression test covers the decision; no dev stack in this session] · commit [skip — not asked]

## Decisions

- instrument: skip — root-cause is HIGH; the override is a deterministic client effect, confirmed by reading the code and by git history (regression introduced in PR #1307, commit 00179b9424, Aug 3 2026).
- browser test: skip — the bug is a pure selection-decision in `useOperation`'s first-operation branch; extracting it to a pure function and unit-testing red→green proves it. Logged for follow-up e2e if desired.
- commit: skip — user asked for /fix only; stop at READY and offer.

## Root cause (HIGH)

The Serial Numbers table in `apps/mes/app/components/JobOperation/JobOperation.tsx` (~line 1814)
lets the operator Select any non-scrapped serial, writing `?trackedEntityId=<id>`. The
serial-advancement effect in `apps/mes/app/components/JobOperation/hooks/useOperation.tsx`
(first-operation branch, ~line 305) then sees the selected unit is not in the incomplete list
(`isSerialEntityIncompleteForOperation` — the entity already carries an `Operation <opId>`
attribute) and immediately fires `onAdvanceToUnit(uncompletedEntities[0])`, snapping the URL back
to the next incomplete unit. Single-operation routings are always "the first operation", so batch
jobs hit it every time. The effect cannot distinguish "held unit just completed → advance" from
"operator deliberately selected a completed unit → leave it". Server-side start/end routes only
fall back to next-incomplete when NO trackedEntityId is passed, so the client effect is the only
override site of this class.

Regression window: worked before PR #1307 (00179b9424, 2026-08-03) which introduced the
auto-advance authority; follow-ups 77982f16a2 / #1330 kept the same first-op logic.

## Phase log

- root-cause: HIGH — see above (done pre-skill, in conversation)
- fix: extracted the first-operation advance decision to `shouldAdvanceToNextSerialUnit`
  (`apps/mes/app/services/serial-advancement.ts` — standalone like `allocation.ts`, because the
  operations service barrel transitively pulls Lingui macros vitest can't transform),
  edge-triggered off the held unit; the hook now tracks the held unit on the first-operation
  branch too. Red→green: `apps/mes/app/services/operations.serial-advancement.test.ts` — the two
  override cases failed against the extracted legacy behavior, all 5 pass after the fix.
  Gates: biome PASS (1 format fix), typecheck(mes) PASS, vitest(mes) PASS (3 files, 52 tests).

## Outcome

- READY — not committed (not requested)
