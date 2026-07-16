# Scheduling Compute Cost & Reactive Architecture: Best Practices Survey

## Summary

Researched three questions raised while designing reactive replanning: (1) how
expensive is a full-org finite-capacity replan, really; (2) how do real systems
react to data changes without over-computing (debounce); (3) how do they let
planners simulate "what if I move a person" without committing. Verdict: the
"just compute the consequence" intuition is correct and measurable — **Carbon's
own engine places 20,000 operations in ~3.2s single-threaded, in memory** —
because deterministic dispatch simulation is polynomial, while *optimizing*
assignments is NP-hard at ≥2 machines and hits solver walls between 10⁴–10⁶
operations. Every fast commercial APS (Asprova, Opcenter/Preactor,
PlanetTogether, D365 Planning Optimization) is a simulator, not an optimizer,
and both mega-vendors moved planning off the transactional DB into dedicated
in-memory services. Reactivity is universally dirty-flag + coalesced drain (SAP
planning file entries), and Inngest — which Carbon already runs — provides
per-key debounce with a max-wait ceiling natively. What-if is a sandbox with an
explicit publish gate everywhere; Carbon's `capacityReservation.scenarioId`
column already anticipates it. The "phase 2 AI suggests / phase 3 AI decides"
roadmap matches the industry sequence exactly (SAP Joule production agent).

## Carbon's Own Numbers (measured, in-memory, single-threaded Deno)

Benchmark of the real allocator (`lib/scheduling/slot-allocator.ts`) with
synthetic org data — sequential placement, growing reservation lists, 40% of
ops ability-gated behind 09:00–17:00 shifts:

| Scale | Time | Throughput |
|---|---|---|
| 1,000 ops (5 abilities × 4 people) | 66 ms | ~15,000 ops/s |
| 5,000 ops (10 × 8) | 553 ms | ~9,000 ops/s |
| 20,000 ops (20 × 15) | 3.2 s | ~6,300 ops/s |

A "full org" replan (hundreds of jobs, tens of thousands of operations) is
**seconds of math**. Production cost is dominated by I/O (loading inputs,
persisting reservations per job over HTTP/Postgres), not calculation — the
same conclusion that drove SAP and Microsoft to in-memory planning services.

## Competitors Surveyed

- **SAP** — liveCache (in-memory planning DB), planning file entries, PP/DS
  simulation versions, Joule production agent.
- **Microsoft Dynamics 365 SCM** — Planning Optimization: planning moved out of
  the ERP database into a multi-tenant in-memory Azure service.
- **Siemens Opcenter APS (Preactor)** — heuristic scheduler, "minutes"
  regeneration, what-if scenarios, new secondary-resource change events.
- **Asprova** — dispatch-rule scheduler; claims 5k ops in 3s, 100k in
  seconds-to-minutes (vendor claims; consistent with complexity theory).
- **PlanetTogether** — what-if scenario copies + KPI compare + publish gate;
  v12.3 job-scoped incremental repair.
- **Epicor Kinetic** — what-if as an engine flag with yellow-bar overlay on the
  live Gantt; accept/discard.
- **Infor SyteLine** — per-transaction "test plan" copies for CTP; numbered
  planning alternatives.
- **Inngest** (infrastructure, not APS) — first-class debounce/throttle
  primitives Carbon already runs.

## Key Consensus Patterns

### 1. Fast replans come from simulating, not optimizing
- Optimal job-shop scheduling is **NP-hard for ≥2 machines** (Garey, Johnson &
  Sethi 1976). State-of-the-art CP solvers (OR-Tools CP-SAT, CP Optimizer) need
  **hours** at 10⁴–10⁵ operations and can fail to find any feasible solution at
  10⁶ (Da Col & Teppan; Hexaly benchmarks).
- Deterministic **dispatch-rule simulation** (what Carbon's engine does) is
  polynomial — classic rules are O(n log n) — and handles 10⁵–10⁶ operations in
  practice (Teppan 2018; Asprova's commercial positioning).
- **Rationale**: "based on current assignments, here's the consequence" is
  cheap; "decide who should be where" is intractable. Every fast APS picks the
  former and leaves deciding to humans.

### 2. Planning runs in memory, off the transactional database
- SAP built **liveCache** specifically because planning "is not possible by
  conventional DBMS"; embedded PP/DS now rides HANA in-memory.
- Microsoft's **Planning Optimization** "holds planning-related data in memory
  and performs the required calculations" in a separate hyper-scalable service;
  benefit list literally includes "do more frequent planning runs" and
  intraday reaction to changes.
- **Rationale**: once compute is seconds, the bottleneck is data movement;
  isolate it from OLTP.

### 3. Reactivity = cheap dirty-marking + coalesced drain (never per-event recompute)
- SAP **planning file entries**: every relevant change writes a per-material
  flag; the net-change run plans only flagged materials and clears flags. N
  changes to one entity → one flag → one recompute. The canonical pattern.
- **Inngest debounce** (Carbon's own job runner): per-key (`companyId`) quiet
  period with every event resetting the timer, plus a `timeout` ceiling so a
  continuous change stream can't starve the recompute forever. Throttle (GCRA)
  as the min-interval alternative; single-flight coalescing absorbs events that
  arrive mid-replan.
- **Rationale**: react within a bounded delay, never crunch per keystroke.

### 4. What-if is a sandbox with an explicit publish gate
- **PlanetTogether**: one-click scenario copy → edit → optimize → KPI compare
  (late jobs, utilization, throughput) → convert-to-live → publish to ERP.
- **Epicor**: what-if is an engine flag; proposed placements render as **yellow
  bars overlaid on the live Gantt**; accept promotes, discard drops.
- **SAP PP/DS simulation versions**: delta-only copies; adoption is a **merge
  with conflict priority** (live confirmations beat simulated moves).
- **Infor**: ephemeral per-transaction test plans for capable-to-promise.
- **Rationale**: simulate freely, commit deliberately; the live schedule is a
  shop-floor contract.

### 5. AI layers on top of the deterministic engine, never replaces it
- **SAP Joule production agent**: AI-guided order release that checks capacity
  and "proposes concrete rescheduling options" — human accepts; deterministic
  MRP is an explicit prerequisite.
- **PlanetTogether/Siemens**: AI recommends; APS engine + planner decide.
- Academic best practice: RL agents whose action space is *classical dispatch
  heuristics* — AI picks among explainable deterministic moves.
- **Rationale**: suggestions need a trustworthy calculator underneath; that's
  the same engine as phase 1.

## Answers to Research Questions

1. **How long does a full-org replan take in memory?** Seconds. Measured on
   Carbon's engine: 20k ops ≈ 3.2s single-threaded. Vendor claims agree in
   order of magnitude (Asprova: 5k ops/3s). The Excel intuition is right.
2. **Is "deciding who goes where" intractable?** Formally yes (NP-hard, m ≥ 2);
   practically yes at scale (CP solvers: hours at 10⁴⁻⁵ ops, DNF at 10⁶). All
   fast commercial APS products simulate given assignments instead.
3. **How to debounce reactivity?** Dirty-flag on change events (per job/company)
   + Inngest `debounce` keyed by company with a timeout ceiling + nightly
   net-change sweep as backstop + single-flight per company (already have
   `concurrency.limit: 1` per company on reschedules).
4. **How do planners simulate "move a person"?** Scenario sandbox: copy or
   delta, engine runs into the scenario, UI shows completion-date/KPI deltas,
   explicit publish/discard. Carbon's `capacityReservation.scenarioId` (NULL =
   live) was designed for exactly this.
5. **AI phases precedent?** Confirmed sequence across vendors: deterministic
   what-if → AI recommendations with human accept → constrained autonomy on
   routine decisions with exception escalation.

## Recommended Approach for Carbon

1. **Trust the engine's speed; fix the I/O path, not the math.** Batch-load a
   company's scheduling inputs once per replan wave instead of per job; keep
   per-job persistence transactional. (The engine is already the "compute
   consequences" kind — no optimizer needed, ever, for phase 1.)
2. **Reactive layer**: change events (shifts, qualifications, work centers,
   calendars) stamp affected jobs stale (SAP planning-file pattern, via the
   existing DB event system) → an Inngest function with
   `debounce: { key: companyId, period: ~2–5 min, timeout: ~30 min }` replans
   the company's stale jobs in due-date order → nightly net-change sweep as
   backstop. Debounce parameters are product knobs, not architecture.
3. **What-if ("move Joe") as phase 1 flagship**: run the engine with
   `scenarioId = <uuid>` against hypothetical inputs (qualification/shift
   overrides), never touching live rows; show completion-date deltas per job
   (Epicor-style overlay or a before/after table); explicit Apply = write the
   real master-data change + live replan; Discard = delete scenario rows.
4. **Phase 2/3 exactly as sketched**: AI suggests candidate moves (which are
   just scenario inputs), human applies; later, auto-apply for low-risk moves
   with exception escalation. The scenario machinery from (3) is the substrate.

## Sources

(Condensed; full URLs in the research transcripts.)
- Microsoft Learn: master-planning-architecture; new-master-planning-engine
- SAP: MaxDB liveCache docs; SAP Community liveCache Q&A; SAPinsider embedded
  PP/DS; PP/DS planning-version & simulation-version docs; Joule
  production-planning agent docs
- Siemens: Opcenter APS 2510 what's-new blog; preactor-aps pages
- Asprova: planning-scheduling.com, eqsystem.pl, takeone.net (vendor claims)
- PlanetTogether: what-if scenarios, production-planning simulations, v12.3
- Epicor: epiusers.help what-if scheduling threads; Kinetic APS pages
- Infor: CSI APS docs (test plan, planning alternatives)
- Inngest: docs/guides/debounce, docs/guides/throttling, debounce engineering
  blogs
- Theory: Garey/Johnson/Sethi 1976 (INFORMS); Bonn scheduling lectures; Teppan
  2018 (IEEE); Da Col & Teppan arXiv 1909.08247 & 2102.08778; Hexaly JSSP
  benchmark; PyJobShop arXiv 2502.13483
- Carbon: `scratchpad/engine-bench.ts` measurement against
  `lib/scheduling/slot-allocator.ts` (this repo, 2026-07-16)
