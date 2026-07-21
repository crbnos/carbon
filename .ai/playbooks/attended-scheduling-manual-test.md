# Attended-window scheduling — manual test playbook (clean slate)

Full manual verification of the capacity-planning core: finite machines (capacity 1),
attended-window labor (setup + labor at op start), named-people booking with shift
relay, lights-out runs, wait attribution, and reactive replanning.
Spec: `.ai/specs/2026-07-17-attended-window-labor-scheduling.md`.

## The model under test (read this first)

For every ability-gated operation (process has **Requires Ability** ON) with times
`setup`, `labor`, `machine`:

- **Total work** = `setup + max(labor, machine)` — the machine is reserved for this
  whole elapsed span.
- **Attended window** = `setup + labor` — a **named person** is reserved only for
  this stretch, at the **start** of the op. The attended window accumulates only
  while the chosen person is on shift; if it can't finish before shift end, the op
  either **relays** to another qualified on-shift person or **pauses** (machine
  stays reserved, nobody booked) until someone qualified is free again.
- **Unattended remainder** = `max(0, machine − labor)` — the machine runs
  **lights-out on calendar time, 24/7**, through nights and weekends. Nobody is
  booked for this stretch.
- `labor = machine` ⇒ remainder 0 ⇒ the person is held the whole time (old
  behavior, now opt-in per item).
- `setup = 0 ∧ labor = 0` on a gated process ⇒ **no person reservation at all**
  (unattended op — respect the data).
- Ungated processes (Requires Ability OFF) ⇒ machine only, no people involved,
  runs on calendar time.

People are booked **by name**: each contiguous attended stretch becomes one
`capacityReservation` row with `resourceKind = 'Employee'` and `resourceId` = the
employee's user id. A person can never hold two overlapping Employee reservations —
across any ability, any work center — which is what kills the old cross-ability
double-booking bug.

## Ground rules

- **Use NEAR due dates (today/tomorrow) for every job.** Pass 1 of the engine
  schedules *backward* from the due date; a due date two weeks out gives every op
  huge slack, so nothing ever contends for a machine or person and half these
  tests trivially "pass" without exercising anything. Near dates force the forward
  finite placement to start at release time and make queues visible.
- **Starts are relative to release time.** An op's earliest start is
  `max(now, backward-computed start, predecessor finish)`. All expected times
  below assume you release around **09:00 during the Day shift** — if you release
  at 14:00, shift every expectation accordingly.
- **Know which action triggers which scheduling mode:**
  - **Releasing a job** = initial scheduling (`mode: "initial"`) — the engine
    freely picks the best work center per op.
  - **Dragging a card on Schedule → Dates** = reschedule (`mode: "reschedule"`) —
    **sticky** work centers: an op keeps its assigned machine; only timing moves.
  - **Editing the due date on the job page does NOT reschedule** — known gap; only
    the dates-board drag calls `triggerJobSchedule`.
- **Warm isolates cache master data.** If results look stale after you edit
  shifts/abilities/work centers (e.g. the engine still sees an expired
  qualification), restart the edge-runtime Docker container before concluding
  there's a bug.
- **Timezone**: set the location's timezone to your local timezone so shift
  windows and expected clock times line up.

## Phase 0 — master data (build once, clean slate)

Everything below assumes a fresh company with no other jobs competing for
capacity.

### Shifts (People → Shifts)

| Shift | Days | Hours |
|---|---|---|
| Day | Mon–Fri | 08:00–16:00 |
| Night | Mon–Fri | 16:00–24:00 |

### People (assign the shift on each person's **Job** tab)

| Person | Shift | Qualified for |
|---|---|---|
| Chase Foster | Day | CNC Route + Final Assemble (the dual-skill person — key for B and C tests) |
| Naveen Kumar | Night | CNC Route (the relay partner for A4) |
| Sid Rathi | Day | Final Assemble |
| Anshul Sharma | **no shift** | CNC Route (deliberately shiftless — exercises the 24/7 fallback in C14) |

### Processes and work centers

Turning **Requires Ability** ON auto-creates a 1:1 ability for the process. Then
open the ability and add people to its roster **with training completed** (an
in-training or expired roster entry does not count as qualified).

| Process | Requires Ability | Work centers | Who to qualify |
|---|---|---|---|
| CNC Route ("CNC Machining") | ON | CNC Router, CNC Router 2 ("Mill 1/2") | Chase, Naveen, Anshul |
| Final Assemble ("Assembly") | ON | Final Assembly ("Bench") | Chase, Sid |
| Deburr | **OFF** | Finishing Bench | nobody (ungated — no people ever needed) |
| Welding | ON | Welding | **NOBODY** (deliberately empty roster — drives the C12 conflict) |

### Items (one method op each unless noted; times as setup / labor / machine)

Use Total Hours / Total Minutes units. Material on the method is optional —
materials never constrain scheduling, only capacity does.

| Item | Process | setup / labor / machine | What it exercises |
|---|---|---|---|
| LIGHTS-OUT | CNC | 5 min / 0 / 20 h | tiny attended window, long unattended run |
| TENDED-SHORT | CNC | 0 / 5 min / 1 h | one person tending several machines |
| FULL-ATTEND | CNC | 0 / 12 h / 12 h | `labor = machine` → person held throughout; relay/pause |
| HAND-WORK | Assembly | 0 / 4 h / 0 | pure labor, no machine run (labor-bound) |
| UNGATED | Deburr | 0 / 0 / 4 h | ungated process, machine only |
| NO-HUMAN | CNC | 0 / 0 / 4 h | gated process but zero attended window |
| NO-WELDER | Welding | 0 / 1 h / 1 h | zero qualified people → conflict |
| CHAIN | CNC 0/1h/1h → (After Previous) Assembly 0/2h/0 | | op-to-op dependency + inherited delay |
| OUTSIDE | CNC 0/5min/1h → Anodize (Outside processing, 48 h) → Assembly 0/1h/0 | | outside-processing span, no reservations |

## Run sheet — concrete job fields per test (company 49LVCXaYjc2rfwPP3bqqDT)

Cast (matches the DB): **Chase Foster** — Day, dual-skill machinist lead;
**Naveen Kumar** — Night, relay partner; **Sid Rathi** — Day, assembler;
**Anshul Sharma** — no shift, the deliberate 24/7 case for C14.
Process mapping: CNC Machining → **CNC Route** (CNC Router + CNC Router 2),
Assembly → **Final Assemble**, Deburr/Welding as named, Anodize →
**Anodize (outsourced)**.

Every job: **Quantity 1** (times are Total units — quantity-independent),
**Deadline Type: Hard Deadline** (deadlineType only sets queue priority, in
`priority-calculator.ts`; keep it uniform so board order is the only priority
lever), release ~09:00 local. Lateness is a **calendar-date** comparison
(`placedEndDate > jobDueDate`, `work-center-selector.ts`) — finishing 23:00 on
the due date is on time; conflicts fire only when the finish rolls past it.

| Test | Job(s) | Due date | Prep before release |
|---|---|---|---|
| A1 | LIGHTS-OUT ×1 | tomorrow | both routers active |
| A2 | LIGHTS-OUT ×1 | tomorrow (→ late, machine-queue note) | deactivate Router 2 |
| A3 | FULL-ATTEND ×1 | tomorrow (on time — test is the pause) | expire Naveen + Anshul on CNC (Chase sole machinist) |
| A4 | reschedule A3's job (or fresh FULL-ATTEND) | tomorrow | un-expire Naveen |
| A5 | NO-HUMAN ×1 | tomorrow | — |
| A6 | HAND-WORK ×1 | tomorrow | — |
| B7 | TENDED-SHORT ×2 back-to-back | tomorrow | Router 2 active; Chase sole machinist |
| B8 | TENDED-SHORT ×2 | tomorrow | deactivate Router 2 |
| B9 | UNGATED ×3 | tomorrow | — |
| C10 | FULL-ATTEND-4H ×2 | tomorrow | both routers; Chase sole machinist |
| C11 | FULL-ATTEND-4H then HAND-WORK | tomorrow | Chase added to Final Assemble roster; Sid expired (restore + reschedule for part 2) |
| C12 | NO-WELDER ×1 | tomorrow | — (empty roster is the trigger) |
| C13 | TENDED-SHORT ×1 (NOT NO-HUMAN — it books nobody, can't conflict) | tomorrow | expire all CNC entries; then future-date them + reschedule |
| C14 | FULL-ATTEND ×1 | tomorrow | only Anshul (shiftless) CNC-qualified |
| D15 | CHAIN ×1 | **today**, release after ~14:00 (op 2 rolls past 16:00 shift end to tomorrow → inherited delay) | — |
| D16 | LIGHTS-OUT ×1 | **today**, release 09:00 (finishes ~05:05 tomorrow → no-runway; no need to bump to 30 h) | machine free |
| D17 | OUTSIDE ×1 | tomorrow (2-day anodize → outside-processing conflict) | Anodize name fixed + re-imported |
| D18 | pin a CNC op to Router 1, then TENDED-SHORT ×2 | tomorrow | — |
| E20–23 | reuse existing jobs | — | per test text |

**Cancel/complete each group's jobs before the next group** — leftover
reservations queue later tests and shift every expected clock time.

## Invariants and inspection queries

### Invariant SQL — run after EVERY test group; must always return 0 rows

Machines never double-booked (manual pins excluded — a pinned op is allowed to
overlap because the engine schedules *around* it coarsely):

```sql
SELECT r1.id, r2.id FROM "capacityReservation" r1
JOIN "capacityReservation" r2 ON r1."resourceKind"='WorkCenter' AND r2."resourceKind"='WorkCenter'
 AND r1."resourceId"=r2."resourceId" AND r1.id<r2.id AND r1."startAt"<r2."endAt" AND r2."startAt"<r1."endAt"
JOIN "jobOperation" o1 ON o1.id=r1."operationId" AND NOT o1."manuallyScheduled"
JOIN "jobOperation" o2 ON o2.id=r2."operationId" AND NOT o2."manuallyScheduled"
WHERE r1."scenarioId" IS NULL AND r2."scenarioId" IS NULL;
```

People never in two places at once (any ability, any work center — this is the
cross-ability double-booking regression check):

```sql
SELECT r1.id, r2.id FROM "capacityReservation" r1
JOIN "capacityReservation" r2 ON r1."resourceKind"='Employee' AND r2."resourceKind"='Employee'
 AND r1."resourceId"=r2."resourceId" AND r1.id<r2.id AND r1."startAt"<r2."endAt" AND r2."startAt"<r1."endAt"
WHERE r1."scenarioId" IS NULL AND r2."scenarioId" IS NULL;
```

### Bookings inspector — your main microscope

Shows every live reservation per job: which machine, which person, exactly when,
and the schedule note explaining any wait:

```sql
SELECT j."jobId", cr."resourceKind", cr."resourceId", cr."startAt", cr."endAt", cr."scheduleNote"
FROM "capacityReservation" cr JOIN job j ON j.id=cr."jobId"
WHERE cr."scenarioId" IS NULL ORDER BY j."jobId", cr."startAt";
```

### UI surfaces

- **Schedule → Dates** — job cards with red conflict flags (hover for the
  reason) and the **amber "Schedule outdated" stale badge**.
- **Job page timeline** — per-op bars, **wait ghosts** (hatched span showing the
  waited stretch before an op), schedule notes, and the op tree.
- **Scheduling → Resources** — resource lanes: one lane per machine and one lane
  per person, so you can see a person's bookings across machines side by side.

---

## A — attended window & lights-out

**A1 — the lights-out baseline.** Create a LIGHTS-OUT job due tomorrow and
release it around 09:00.
*Expect:* the op spans 09:00 → ~05:05 the next morning (5 min setup + 20 h
machine on calendar time — it runs straight through the night because the
unattended remainder ignores shifts). The bookings inspector shows exactly two
rows: a WorkCenter row on a mill for the full 20 h 05 m span, and an Employee row
for **Chase, 09:00–09:05 only** (the attended window). No wait ghost, no schedule
note — nothing was waited for. This is the headline feature: 5 minutes of human
time buys 20 hours of machine output.

**A2 — machine queueing + wait attribution.** With A1 still holding its mill,
make the other mill unavailable (deactivate it or point the item's op at a single
work center), then release a second LIGHTS-OUT job.
*Expect:* the second op starts when A1's machine frees (~05:05 next day). Its
schedule note reads **"Waited ~20h for the work center — queued behind J{A1's
jobId} (1 op)"** — machine wording, correctly attributing the wait to the machine
queue, not to labor. The job timeline draws a **wait ghost** covering the waited
stretch before the op bar.

**A3 — pause when the only person's shift ends.** Make Chase the only CNC person:
expire Naveen's and Anshul's roster entries (set training expiry in the past).
Release a FULL-ATTEND job (12 h with `labor = machine`, so Chase must be present
the whole time) around 09:00.
*Expect:* Chase is booked 09:00–16:00 (7 h of the 12), then the op **pauses
overnight** — the machine reservation continues unbroken (the workpiece is still
in the machine, nothing else can take it) but there is **no Employee reservation
between 16:00 and 08:00**. Chase resumes 08:00–13:00 next day (remaining 5 h).
The op's elapsed span reads as ~12 h of work spread across ~1.2 days. Verify the
Employee rows never extend one minute past 16:00 — the engine must never assume
overtime.

**A4 — shift relay.** Restore Naveen's CNC qualification (clear the expiry), then
reschedule the A3 job (drag its card on the dates board) or release a fresh
FULL-ATTEND job.
*Expect:* the relay kicks in — **Chase 09:00–16:00, then Naveen 16:00–21:00**, op
done at 21:00 **the same day** instead of 13:00 the next day. The bookings
inspector shows two Employee rows with different `resourceId`s that meet exactly
at the 16:00 shift boundary, no gap and no overlap. This is the
proof-of-feature comparison against A3: a second shift saves ~16 h of elapsed
time with zero configuration.

**A5 — gated but zero attended window.** Release a NO-HUMAN job (CNC process is
gated, but setup = 0 and labor = 0).
*Expect:* the op schedules at any time of day — including outside all shifts —
with a WorkCenter reservation only and **no Employee reservation**. This is the
approved "respect the data" default: zero attended time means nobody needs to be
there, so no phantom operator hold.

**A6 — labor-bound op (old behavior preserved).** Release a HAND-WORK job
(Assembly, 4 h labor, 0 machine).
*Expect:* the person (Chase or Sid) is booked for the **entire 4 h** — attended
window = 4 h, remainder = 0. Pure hand work degenerates to exactly the old hold-
the-person-throughout behavior; nothing regressed for labor-only shops.

## B — one person, many machines

**B7 — parallel mills, staggered loads (the marquee test).** Make Chase the sole
CNC-qualified person (Naveen/Anshul expired). Both mills active. Release two
TENDED-SHORT jobs (0 setup, 5 min labor, 1 h machine) back to back around 09:00.
*Expect:* job A takes Mill 1 with Chase booked 09:00–09:05, machine running to
10:00. Job B takes **Mill 2** with Chase booked **09:05–09:10** (immediately after
he finishes loading Mill 1), machine running to 10:05. Both machines run **in
parallel**; Chase's two Employee reservations are back-to-back 5-minute windows
that never overlap. Job B's schedule note uses **operator** wording ("Waited 5m
for a qualified operator — …") because what it waited for was Chase, not a machine.
Under the old pool model Mill 2 would have sat dark until 10:00.

**B8 — same jobs, one machine: attribution flips.** Deactivate Mill 2 (or
restrict the op to Mill 1) and release two more TENDED-SHORT jobs.
*Expect:* now the jobs **queue on the machine**: 09:00–10:00 and 10:00–11:00.
The second job's note reads **"Waited ~1h for the work center — queued behind
…"** — *machine* wording. Compare directly with B7: identical items, and the
engine correctly names a different binding constraint (operator in B7, machine
in B8). This proves wait attribution is real analysis, not a canned string.

**B9 — ungated ops need nobody.** Release three UNGATED jobs (Deburr, 4 h
machine, process not ability-gated).
*Expect:* they queue purely on the Deburr Station: 09:00–13:00, 13:00–17:00,
17:00–21:00 — note the third one runs past every shift end, because ungated ops
run on calendar time and no Employee reservations exist for any of them.

## C — people constraints

**C10 — operator is the bottleneck across machines.** Chase sole machinist, both
mills active. Create an item with `labor = machine = 4 h` (a 4-hour fully-
attended variant of FULL-ATTEND) and release two jobs of it at 09:00.
*Expect:* job 1 gets Mill 1 with Chase 09:00–13:00. Job 2's mill (Mill 2) is
**free the whole time**, but Chase isn't — so it starts at **13:00** on the free
mill, with an operator-queue note ("Waited 4h for a qualified operator — queued
behind J{job1}"). If Naveen is qualified, expect a relay tail instead of the op
pausing at 16:00.

**C11 — cross-ability double-booking is dead (regression).** Chase dual-skill
(CNC + Assembly), Sid expired. Release a 4 h fully-attended CNC job (Chase
09:00–13:00), then release a HAND-WORK job (Assembly, 4 h labor).
*Expect:* the Assembly op **waits for Chase** and starts 13:00 — even though the
Bench is free and the two ops need *different abilities*, Chase is one person.
Hours 13:00–16:00 book on day one and the remaining 1 h relays to 08:00–09:00
next day. Run the Employee-overlap invariant SQL: **0 rows** — under the old
anonymous pool model this exact scenario double-booked Chase. Then restore Sid's
Assembly qualification and reschedule: the Assembly op now runs **in parallel**
via Sid, starting 09:00. Both behaviors must hold.

**C12 — zero qualified people → conflict, then reactive recovery.** Release a
NO-WELDER job (Welding process, empty roster).
*Expect:* the op gets a placement conflict — red flag on the dates board with
reason **"No qualified operator for Welding"**; the job still shows (scheduling
never hard-fails). Now qualify Chase for Welding: the affected jobs get the amber
**"Schedule outdated"** stale badge, and a debounced replan wave fires **~3
minutes after your last edit** (watch the Inngest dev UI). After the wave the
badge clears and the op is scheduled with Chase booked for the 1 h attended window.

**C13 — expiry semantics.** Expire **all** CNC roster entries (past expiry
dates) and release a CNC job.
*Expect:* the same "no qualified operator" conflict — an expired qualification is
no qualification. Then set the expiry dates to the **future** (but before long)
and reschedule: the job **schedules normally**. Eligibility is checked against
the op's start date (approved default) — a qualification expiring next month
doesn't block work today.

**C14 — shiftless person = 24/7 availability (documented default).** Expire
Chase/Naveen, leave only Anshul (who has **no shift assigned**) CNC-qualified.
Release a FULL-ATTEND job.
*Expect:* Anshul can be booked at any hour, including overnight — no shift
assignment means "always available" by design. This is the documented sharp
edge: real shops must assign shifts to every scheduling-relevant person, or the
engine will happily plan them at 3 a.m.

## D — structure & messages

**D15 — dependency chaining + inherited-delay message.** Release a CHAIN job
(CNC 1 h → After Previous → Assembly 2 h) due **today**, late enough in the day
that op 2 can't finish by the due date.
*Expect:* op 2 starts only after op 1 finishes. If op 2 finishes late, its
conflict reads the **inherited-delay** variant: "Finishes {date} but the job is
due {date} — starts late because it waits for \"{op 1 description}\" earlier in
this job; its own work center was free" — correctly blaming the predecessor, not
the Bench.

**D16 — impossible runway.** Release a job whose total work (~30 h — e.g. bump
LIGHTS-OUT's machine time) is due **today**.
*Expect:* it schedules anyway (finishing late) and carries the no-runway
conflict: "Finishes {date} but the job is due {date} — **not enough time remains
before the due date**". No machine/operator blame, because nothing was queued —
there simply wasn't runway.

**D17 — outside processing.** Release an OUTSIDE job (CNC 1 h → Anodize outside
op with 48 h lead → Assembly 1 h).
*Expect:* the Anodize step occupies 48 h of **calendar** on the job timeline but
creates **no capacityReservation rows** (a supplier isn't your capacity); the
Assembly op starts only after the 48 h. With a near due date the conflict uses
the outside-processing variant: "… — outside processing pushes it past the due
date".

**D18 — manual pin.** On some job's CNC op, set it manually scheduled (pin it)
onto Mill 1, then release other CNC jobs.
*Expect:* the other jobs **queue around** the pinned window. Note the pin is
coarse — it effectively holds the whole day, so don't expect other work to slot
into the same day's leftover hours on that machine. Pinned ops are excluded from
the machine-overlap invariant (that's the `NOT o."manuallyScheduled"` filter).

**D19 — With Previous now serializes on a shared work center.** Give an item
two ops marked **With Previous** targeting the **same** work center.
*Expect:* they run one after the other, not simultaneously. With Previous still
means "may run in parallel," but capacity 1 on a single machine wins — two ops
can't physically share one mill. This is intended behavior, not a bug.

## E — reactive replanning & lifecycle

**E20 — staleness → debounced wave.** Edit a shift's hours or a person's
qualification while jobs are scheduled.
*Expect:* affected jobs immediately grow the amber **"Schedule outdated"** badge
on the dates board. **One** replan wave fires ~3 minutes after your **last**
edit (make several edits in a row — verify in the Inngest UI that they coalesce
into a single wave, not one run per edit). After the wave, badges clear and
schedules reflect the new reality. Run both invariant SQLs afterward.

**E21 — dates-board drag.** Drag a job card to a new date column on
Schedule → Dates.
*Expect:* that job reschedules **immediately** with sticky work centers (ops
keep their machines; only timing moves), followed by a company-wide wave so
other jobs react to the freed/claimed capacity. The board's card order within a
column is the capacity priority — the order jobs claim contested machines.

**E22 — cancellation releases capacity.** Cancel a job that holds reservations.
*Expect:* its reservations stop constraining other placements **immediately** —
this is a read-time filter, so no replan of the cancelled job is needed. Drag
another job that was queued behind it: it should now claim the freed window.

**E23 — MES execution wins over the plan.** Start an op in MES, then trigger a
replan (drag another job's card).
*Expect:* the started op **does not move** — execution reality pins it.
Separately confirm the MES qualification gate (who may start an op) behaves
exactly as before this branch; the named-person plan is a *suggestion*, not a
lock — any qualified person can still start the op on the floor.

---

## Proof-of-feature comparisons (the "was this worth building" checks)

- **B7 vs old behavior** — two mills running in parallel off one person's
  back-to-back 5-minute loads. The old pool model held Chase for the full hour and
  kept Mill 2 dark.
- **A1** — a 20 h run finishing overnight with only 5 minutes of booked human
  time. The old model paused the run at 16:00 and resumed Monday.
- **A4 vs A3** — the relay turns a 1.2-day single-person op into a same-day
  two-person op (~16 h saved) with zero configuration.
- **C11** — cross-ability double-booking is provably dead (Employee-overlap SQL
  returns 0 where the pool model booked Chase twice).

Run **both invariant SQLs after every group** — a double-booking that appears
only after a particular sequence of replans is exactly the kind of bug this
playbook exists to catch.
