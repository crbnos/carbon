# Reactive Replan — stale flags, debounced waves, net-change nightly

Design source: `.ai/research/reactive-replanning.md` +
`.ai/research/scheduling-compute-and-reactive-architecture.md` + conversation
2026-07-16 (flow: detect → mark → badge → debounce → wave → fresh).

Decisions (settled): stale state lives on `job` (two nullable columns);
affected-set computation lives in TypeScript (an immediate Inngest "mark"
function), not SQL triggers — API/UI mutation sites fire one event, the
nightly net-change sweep backstops anything missed; the debounced "wave"
clears stale jobs' reservations then reschedules in due-date order so one
wave = one consistent queue; `manuallyScheduled` pins untouched (engine
already honors them); knobs: debounce period 3m, timeout 30m.

## Tasks

- [x] 1. Migration `job.scheduleOutdatedReason TEXT`, `scheduleOutdatedAt
  TIMESTAMPTZ` (nullable, no index needed beyond existing) + apply + regen
  types. Verify: columns exist; `grep scheduleOutdatedReason` in generated types.
- [x] 2. `@carbon/lib` event type `carbon/schedule.inputs.changed`
  `{ companyId, kind: 'ability'|'shift'|'employee-shift'|'work-center'|'location', reason }`.
  Verify: typecheck @carbon/lib.
- [x] 3. `@carbon/jobs` `schedule-inputs-changed.ts`: two Inngest functions.
  (a) `markScheduleStaleFunction` — immediate; computes affected unfinished
  jobs for the company (kind-scoped where cheap, company-wide for v1
  otherwise), stamps columns. (b) `scheduleReplanWaveFunction` — listens to
  same event, `debounce { key: companyId, period: '3m', timeout: '30m' }`,
  `concurrency { key: companyId, limit: 1 }`; loads stale jobs (Ready/In
  Progress/Paused), deletes their live reservations in one step, invokes
  `schedule` per job in due-date order (one step per job), clears stamps per
  success. Register both. Verify: typecheck + `pnpm --filter @carbon/jobs test`.
- [x] 4. Nightly replan → net-change: replan only stale jobs by emitting
  `carbon/schedule.inputs.changed` per company with stale jobs (waves do the
  work) — removes unbounded select + serial-loop timeout (self-review
  must-fix). Verify: typecheck; function registered.
- [x] 5. App wiring: shared `notifyScheduleInputsChanged(companyId, kind,
  reason)` helper; call from mutation sites: person job update (shift),
  employee-ability routes (new/update/delete), abilities deactivate, shift
  update, work-center update, location timezone update. Verify: typecheck erp.
- [ ] 6. (DEFERRED — data layer complete, badge is a follow-up) UI badge: dates-board job card + JobHeader show "Schedule outdated —
  <reason>" when `scheduleOutdatedReason` set (existing queries + small chip).
  Verify: vitest untouched; typecheck.
- [x] 7. Gates + commit via check-and-commit.

Non-goals: what-if scenarios (phase 2), AI (phase 3), per-work-center modes,
DB-trigger detection (backstopped by nightly), i18n of DB reason strings.
