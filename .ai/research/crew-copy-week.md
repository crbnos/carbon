# Copy-Week (Crew Schedule) Research: Best Practices Survey

## Summary

Surveyed how workforce-scheduling and manufacturing tools let a supervisor copy a
crew/shift schedule from one period onto another. The headline finding contradicts
the obvious design instinct: **almost nobody offers a symmetric "pick any source
week → pick any target week" dialog.** The near-universal shape is *source = the
period you are currently viewing*, *target = an arbitrary date (often plus a repeat
count)*, and **saved templates are the industry's actual answer to arbitrary
week-to-week reuse** — When I Work says so explicitly in its own docs. Only **Sling**
offers arbitrary source *and* target ranges; **Shiftboard** comes closest to a real
wizard (source range → preview → target *start date*, span derived from the source).
Two enterprise tools — **UKG** and **Workday** — have no week-copy dialog at all and
route everything through patterns.

The second major finding is a safety pattern Carbon does not have: nearly every
product lands copied shifts in **draft/unpublished** state, which substitutes for the
preview and post-commit undo almost none of them provide. The exceptions are
instructive: **Shiftboard ships an explicit `Preview` step** listing every shift that
will be created, and **Workday's Edit Mode** is a staging buffer with real `Ctrl+Z`.
Carbon's copy applies immediately and irreversibly with no draft state, so it needs a
compensating control — a pre-apply preview count is the cheapest, and Carbon's service
already computes the numbers.

Carbon's existing conservative semantics (skip people who already have an
assignment, never overwrite an absence, never copy overtime) match the industry
norm and should be kept.

## Competitors Surveyed

- **SAP** (PT-SP shift planning / PP61, S/4HANA work-center capacity, SuccessFactors
  Time Tracking) — the enterprise reference; also the closest to Carbon's
  manufacturing domain.
- **Infor WFM** (Multi-view Scheduler) — enterprise WFM with the richest
  template/rotation model.
- **Microsoft Shifts** — the canonical "Copy schedule" dialog most users have seen.
- **Deputy** — best-in-class mid-market scheduler; has the arbitrary-target option.
- **When I Work** — the clearest documented conflict-resolution model in the field.
- **Sling** — the only product with fully arbitrary source *and* target ranges.
- **Homebase**, **Connecteam** — SMB tools; template-first.
- **Shiftboard / ScheduleFlex** — the only product with a true source-range →
  preview → target-date copy **wizard**.
- **UKG Pro WFM / Dimensions** (ex-Kronos) — enterprise WFM; pattern-first.
- **Workday Scheduling** — enterprise; generation-first, and the only product with a
  real undo.
- **Manufacturo**, **First Resonance ION** — MES peers; surveyed and found to have
  **no** crew copy-schedule feature (negative result, see below).

## Key Consensus Patterns

### 1. Source is implicit (the period you're viewing); target is what you pick

- **Deputy**: navigate to the week you want to copy *from*, then `Copy` →
  `Copy Shifts`. Defaults to next week; an **`Advanced`** option lets you "select the
  specific date range you wish to copy to". Also offers the reverse entry point
  `Copy from previous week` when you're sitting on an empty future week.
- **Microsoft Shifts**: source *is* an explicit start/end range, but the target is a
  single anchor date plus a repeat count — target extent is derived, not picked.
- **When I Work / Connecteam / Homebase**: adjacent only (`Copy Previous Week`,
  "copy shifts from the previous period", "copy the current week to a future week").
- **Sling**: "choose the dates you would like to copy **from** and the dates you want
  to copy **to**."
- **Shiftboard**: the most complete implementation — `Duplicate/Copy Existing` takes a
  source range (**one day up to four weeks**), a team/position filter, a `Preview`
  step, then **only a future start date** — the target span is derived from the source
  span. Target must be forward; day-of-week alignment is the user's job.
- **UKG**: no week-copy dialog at all — copying is a **cell-level** `Copy/Paste` quick
  action (pick what to carry: shift, paycode, schedule tag, availability, or All), one
  target cell at a time.
- **Workday**: no copy-week task exists. The nearest is `Mass Change Shifts Event`,
  which propagates forward from **one shift for one worker** (matched by day-of-week +
  times), up to 6 months.
- **Rationale**: the source is nearly always "the week I just built and am looking
  at". Making users pick both ends is extra work for a case that rarely happens.

### 2. Multi-period reuse is a repeat count, not a multi-select

- **Microsoft Shifts**: "choose the date you want to copy your selection to and **how
  many times** the existing schedule should be copied".
- **Homebase**: a separate `Repeat Schedule` feature — repeat "up to 4 weeks in
  advance", offered right after publishing.
- **Sling**: "You can choose to copy more than one week at a time" (range-to-range).
- **Connecteam**: `Multi duplicate` — "duplicate the shift any number of times you
  choose"; plus recurring shifts capped at 90 occurrences.
- **SAP / Infor / UKG / Workday**: no N-times copy; repetition is expressed as a
  **shift sequence cycle** (SAP), **Master Rotation** (Infor), **Schedule Pattern**
  (UKG, up to 52 weeks) or **Work Schedule Calendar** patterns (Workday, up to 53
  weeks). Workday's bulk lever is generation instead — `Mass Generate Schedules` takes
  a **Number of Weeks 1–8**.
- **Shiftboard**: no repeat field; multi-week comes from making the *source* range
  multi-week (4-week cap).

### 3. Templates are the industry's real answer to arbitrary week-to-week reuse

Every consumer product has them, and one vendor says outright that templates — not
copy — are how you move any week onto any week.

- **When I Work**, verbatim: *"Use the templates feature to copy any week and paste
  it into any week."* `Save As New Schedule Template` (with an `Include Repeating
  Shifts` checkbox) / `Load Schedule Template`.
- **Deputy**: `Copy Shifts` → `Save Template` (name + description) / `Load Template`.
  Shared across schedulers at the location so managers maintain master templates.
- **Sling**: `Save schedule to template` with "automatically unassign the shifts" and
  "include unpublished shifts" options.
- **Connecteam**: three tiers — Shift / Day / **Week** templates.
- **Homebase**: `Tools` → `Templates`, and prompts to save one right after publishing.
- **Infor WFM**: **OTS templates** — "created to reduce the amount of information
  that must be manually re-entered for each schedule period" — plus **Master
  Rotation** and Schedule Rotation Templates consumed by `Generate Schedule`.
- **SAP**: requirements records by **requirements type**, **Requirements Profile**
  (PO17), **Entry Profile** (PP66), and S/4HANA **Shift Definition / Shift Sequence**.
- **UKG**: **Schedule Pattern** (saved Pattern Template, assigned with a start/end
  date) plus **Schedule Groups with inheritance** — applying a pattern to the group
  pushes it into every member's schedule and can be changed or removed for all at once.
- **Workday**: **Work Schedule Calendar** holding **Schedule Patterns** (multi-week
  rotations = one row per week); with **Static Scheduling** the calendar auto-populates
  the schedule, so no copy is needed.
- **Shiftboard**: **Saved Schedules** — notably **dateless templates** whose first
  column is a *day number* resolved against the start date at apply time, which
  sidesteps the day-of-week alignment problem its own copy tool warns about.
- **Rationale**: a recurring crew pattern is a reusable object, not a one-off copy.
  Copy handles "same as last week"; templates handle "our standard summer rota".

### 4. Conflict handling: skip/park is the norm; an explicit choice is best-in-class

- **When I Work** (gold standard — four documented options on copy *and* template
  load): `Allow Conflicts`, `Avoid Conflicts` (moves conflicting shifts, including
  those hitting **pending or approved time off**, into the OpenShifts row),
  `Overwrite Conflicts`, and `Copy … to OpenShifts`.
- **Connecteam**: on template load, "the system will let you choose to **replace them
  or to add the new shifts to the existing shifts**."
- **Infor WFM**: defers to publish time — publishing validates overlaps, compliance,
  and **conflicts with approved leaves**; conflicting rows are **withheld** while the
  rest publish, and the user resolves them in a **Manage Publish Conflicts** window.
- **Deputy / Sling / Microsoft Shifts**: additive, no documented option. MS Shifts has
  a reported defect where a multi-week copy *overwrote* target dates unintentionally,
  with no setting to control it — the clearest argument for defining this explicitly.
- **UKG**: user-selectable for patterns via an **`Override Other Patterns`** checkbox —
  and a principle worth stealing: *"shifts created manually (not part of a pattern) are
  **never** overwritten by a pattern, regardless of this setting."* Bulk operations
  never clobber hand edits.
- **Workday**: skip-and-protect throughout — `Mass Generate Schedules` "**skips**
  scheduling organizations that already have a schedule created"; `Mass Clear Schedules`
  "skips schedules that are not in Draft status". The single documented overwrite in the
  product is for labor *demand*, not shifts (`Copy from a Prior Week` clears the week
  first).
- **Shiftboard**: additive; its "conflict" options concern *assignability*
  (`Ignore Conflicts`, `Ignore Overtime`, `Honor availability`, `Ignore Time off`) and
  whether conflicted shifts land as `Open` or `Drafts`.
- **Nobody offers "clear the target week first"** for shifts as a documented control.

### 5. Draft/unpublished state substitutes for preview and undo

- Copies land **unpublished** in Deputy, When I Work, Sling, Connecteam, Homebase and
  Microsoft Shifts; **DRAFT** in Infor. Publishing is always a deliberate second step
  (`Publish`, `Publish & Notify`, `Share with team`).
- **Shiftboard is the exception and the model to follow**: an explicit **`Preview`**
  step lists every shift that will be duplicated before you commit, and you can
  `Download` that list as an upload file, edit it, and re-upload instead.
- **Workday** has the only real undo, and it is a *staging buffer*: **Edit Mode**
  supports `Ctrl/⌘+Z` undo, shows the change count on the Save button, and
  `Exit Edit Mode` discards. After commit there is no undo. **UKG** works the same way —
  unsaved shifts show a black border + red dot, and `Refresh` discards.
- Otherwise **no preview and no post-commit undo anywhere**. Only Connecteam shows a
  count, and only on the Publish button.
- **Rationale**: the unpublished window *is* the preview — you copy, eyeball, trim,
  then publish. Recovery is manual deletion.

### 6. Absence/time-off data is protected

When I Work honors pending and approved time off under `Avoid Conflicts`; Sling
excludes time off and unavailability from templates entirely ("must be added
separately"); Infor blocks rows conflicting with approved leaves; Homebase and
Connecteam surface unavailability as a conflict signal. Carbon already skips absent
people — this matches.

### 7. Selective element toggles on the copy

- **Microsoft Shifts**: `Shift notes`, `Activities`, `Time off`, `Open shifts`, plus a
  schedule-group multi-select.
- **Sling**: "copy unpublished shifts", "revert all the shifts to unassigned shifts",
  "skip conflicts and labor cost checks".
- **Infor** row copy: separate checkboxes for **Labor Metrics**, **Shifts (with day
  offset)**, **Skills** — the most transferable version of this idea.

## Answers to Research Questions

1. **Arbitrary source *and* target?** — Only **Sling**. Deputy gives an arbitrary
   target from the current-view source (`Advanced`); Microsoft Shifts gives an
   arbitrary source range but a derived target. When I Work, Connecteam and Homebase
   are adjacent-only and redirect users to templates. SAP has no period-to-period copy
   at all (PP61 works one planning period at a time; planners paste grid cells
   manually). Infor's `Copy Previous Period` takes an arbitrary source but the target
   **must** match the loaded period. **Shiftboard** is the closest to a real wizard
   (source range → preview → target start date), while **UKG** offers only cell-level
   paste and **Workday** has no copy-week task at all.
2. **Repeat for N periods?** — Yes, and it's the standard mechanism: Microsoft Shifts
   (repeat count), Homebase (`Repeat Schedule`, up to 4 weeks), Sling (multi-week
   range), Connecteam (`Multi duplicate`). SAP, Infor, UKG and Workday express
   repetition as rotations/patterns instead; Workday's bulk lever is
   `Mass Generate Schedules` with a 1–8 week window.
3. **Templates?** — Universal, and explicitly positioned as the answer to arbitrary
   reuse (When I Work). Present in all six consumer tools plus Infor (OTS
   template/Master Rotation), SAP (requirements/entry profiles, shift sequences), UKG
   (Schedule Patterns + inheriting Schedule Groups) and Workday (Work Schedule Calendar
   + Static Scheduling). Shiftboard's **dateless** day-numbered templates are the
   cleverest variant.
4. **Conflict semantics?** — Skip/park is the norm. **When I Work** is the only product
   with a full four-way user choice; UKG has `Override Other Patterns` (and never
   overwrites manual shifts); Connecteam offers replace-vs-add for templates; Infor
   withholds-and-reports at publish; Workday skips anything already scheduled or
   already published. Deputy, Sling, Shiftboard and MS Shifts are additive with
   undefined dedup behavior.
5. **What's excluded?** — Published state is reset **everywhere** (universal). Time
   off/unavailability is protected or excluded. Sling additionally excludes
   unpublished shifts by default and does **not** preserve recurrence ("those shifts
   will be applied as single shifts"). Overtime handling is undocumented across the
   board — Carbon's choice to never copy it is defensible and unopposed.
6. **Preview / count / undo?** — **Shiftboard has a genuine `Preview` step**; Workday
   and UKG provide pre-save staging buffers (Workday with real `Ctrl+Z`). Nobody has a
   post-commit undo, and only Connecteam shows a count. Deputy appears to silently drop
   shifts that fail its availability check without reporting how many.
7. **Terminology** — "Copy schedule" (Microsoft, Homebase), "Copy Shifts" (Deputy),
   "Copy Previous Week" (When I Work), "Schedule template" (universal noun),
   "OpenShifts" (When I Work's unassigned bucket), "Publish"/"Share with team".

## Competitor-Specific Details

### Microsoft Shifts
Dialog: source start+end dates → content checkboxes (`Shift notes`, `Activities`,
`Time off`, `Open shifts`) → schedule-group selection → target anchor date + repeat
count → `Copy`. Granularity is group-level only; you cannot copy for an individual
employee (Microsoft's own workaround is to create a dedicated schedule group).
Cross-team copy unsupported. Long copies run async ("Copying is taking longer than
expected…"). No documented limit on range or repeat count.

### When I Work
The four conflict options are the single most valuable design artifact found, and the
same set is reused for template loading (relabelled `Allow Duplicates`). `Avoid
Conflicts` parking shifts into **OpenShifts** rather than dropping them is a notably
better failure mode than silent skipping.

### Infor WFM
Status-driven safety: DRAFT → ACTIVE → PENDING PROCESS → published, with a dedicated
**Manage Publish Conflicts** window as the pre-commit review. `Create Bulk Version`
makes versioned copies of templates. Row copy's per-element checkboxes (Labor
Metrics / Shifts+offset / Skills) are the cleanest selective-copy model surveyed.

### SAP
No period-to-period shift-plan copy exists in PT-SP. The documented copy axis is
**Target plan → Actual plan**. Note a terminology correction: German *Sollplan* is the
**target plan** (a real plan for a period), **not** a template — do not adopt it as a
template term. PP6C (`Undo Completed Target Plan`) shows an explicit completed/locked
state, and PP6J/PP6K provide change audit trails by user and by person.

### Manufacturo / First Resonance ION (negative result)
Neither MES has a crew copy-schedule feature. Manufacturo publishes no
workforce-scheduling module (its `Dispatching` is assign-work-now, not plan-a-week).
ION schedules *runs and steps*, not crew; its nearest analogue is **Run Batching**,
which syncs assigned users, times and work centers across a batch — a template-sync
mechanism, not a date-range copy. **Implication: Carbon has no MES peer to copy from
here; the design must be borrowed from WFM tools.**

## Recommended Approach for Carbon

Carbon's `copyCrewWeek(fromWeekStart, toWeekStart)` already accepts arbitrary source
and target weeks and returns `{ copied, skipped }`. The gap is entirely UI.

1. **Keep source implicit, make target explicit** (Deputy's pattern). The dialog opens
   with source = the week on screen, shown as a read-only label with a "change" affordance;
   target is a week picker defaulting to the following week. Do not force the user to
   pick both — that is the case Deputy hides behind `Advanced` because it's rare.
2. **Add a repeat count** (Microsoft Shifts' pattern): "Repeat ___ times", default 1.
   This covers "crew the next 4 weeks the same" in one action and is the standard
   multi-period mechanism. Cap it (12 is a reasonable ceiling) and state the resulting
   date span in the dialog so the blast radius is visible before applying.
3. **Keep the current skip semantics as the default** — skip a person who already has
   an assignment on the target date, never overwrite an absence, never copy overtime.
   This matches the conservative industry norm and needs no change.
4. **Surface the counts Carbon already computes.** `{ copied, skipped }` is more than
   most competitors report; today it's discarded. Show "42 copied, 3 skipped" in the
   success toast, and — because Carbon has no draft state — show the *projected* counts
   **before** applying. This is not a novel invention — **Shiftboard ships exactly this
   `Preview` step**, and Workday/UKG achieve the same effect with a pre-save staging
   buffer. It is the compensating control that replaces the draft/unpublished window
   Carbon does not have.
5. **Explain skips rather than hiding them.** Deputy's silent drop is a documented
   pain point. When the preview shows skips, say why ("3 already crewed, 1 on time
   off") — the closest cheap analogue to When I Work's OpenShifts parking.
6. **Defer overwrite.** Do not build a "replace what's there" option in v1. It requires
   a delete path, it is the one behavior Microsoft Shifts is criticized for getting
   wrong, and skip-by-default is the norm (Workday skips outright). Add it later as an
   explicit radio (When I Work's `Overwrite Conflicts`) if users ask — and when you do,
   adopt UKG's rule that **a bulk copy never overwrites a hand-made assignment**.
7. **Defer templates, but design for them.** Templates are the consensus answer to
   arbitrary reuse and the obvious next step ("save this week as a template" →
   `crewWeekTemplate`). Not needed for this change, but the copy dialog's shape should
   not foreclose it.
8. **Do not adopt a draft/publish model** just for copy. It is how competitors buy
   safety, but it is a large architectural addition to Carbon's crew board; the
   pre-apply preview in (4) buys the same protection far more cheaply.

### Carbon-specific defects found while grounding this research

Not competitor findings — issues in the current implementation, since fixed:

- `copyCrewDayInTransaction` and `assignCrewWeek` built their skip sets from
  `companyId + date` with **no `locationId`**, so a person crewed at another site was
  silently dropped from the copy.
- Worse, `upsertCrewAssignment` and `setCrewDay` ran **DELETEs** without a
  `locationId` filter, so acting on one location's board destroyed that person's
  assignments at another location.
- Still open: the skip set ignores `shiftId`, so with a shift filter active a person
  working a *different* shift that day still counts as "already assigned". Decide
  whether the skip should be per-shift before shipping arbitrary target weeks, since
  aiming at already-populated weeks makes this fire far more often.

## Sources

- https://support.microsoft.com/en-us/office/copy-a-schedule-in-shifts-8bef2144-f448-4082-a37f-31b9dc0b52ed
- https://support.microsoft.com/en-us/teams/free/copy-a-schedule-in-shifts
- https://learn.microsoft.com/en-us/answers/questions/4441780/teams-shifts-reach-back-duplication-shifts-when-co
- https://learn.microsoft.com/en-us/answers/questions/5140720/ms-shifts-copy-schedule-function
- https://help.deputy.com/hc/en-au/articles/4688828103439-Copy-shifts-to-another-date-or-area-on-the-schedule
- https://help.deputy.com/hc/en-au/articles/4688863723791-Schedule-templates
- https://www.deputy.com/blog/deputys-new-schedule-templates-will-save-you-a-ton-of-time
- https://help.wheniwork.com/articles/copying-shifts-and-schedules-computer/
- https://help.wheniwork.com/articles/using-schedule-templates-computer/
- https://help.wheniwork.com/articles/publishing-the-schedule-computer/
- https://support.getsling.com/en/articles/511136-copying-shifts
- https://support.getsling.com/en/articles/511144-schedule-templates
- https://support.getsling.com/en/articles/1079012-recurring-shifts
- https://help.connecteam.com/en/articles/3524929-schedule-templates
- https://help.connecteam.com/en/articles/6453945-how-do-i-copy-shifts
- https://help.connecteam.com/en/articles/5936970-perform-bulk-actions-on-shifts-in-the-job-scheduler
- https://help.connecteam.com/en/articles/6081010-cross-schedule-conflicts
- https://support.joinhomebase.com/hc/en-us/articles/360029533231
- https://support.joinhomebase.com/hc/en-us/articles/360029533291-Create-schedule-templates
- https://support.joinhomebase.com/hc/en-us/articles/360035487051-Repeat-Schedule
- https://help.sap.com/doc/2df5dd5321e8424de10000000a174cb4/700_SFIN20%20006/en-US/6df4dd5321e8424de10000000a174cb4.html
- https://help.sap.com/doc/2df5dd5321e8424de10000000a174cb4/700_SFIN20%20006/en-US/c7f4dd5321e8424de10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/2bba750d1e124e1ea2a039bb1cd9b6c5/dc73b65334e6b54ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/2bba750d1e124e1ea2a039bb1cd9b6c5/74e3356c89914b1495667e7d1f76eb23.html
- https://answers.sap.com/questions/5938229/shift-planning---target-plan.html
- https://community.sap.com/t5/enterprise-resource-planning-q-a/shift-planning-pp61-in-sap-how-to-automate-the-process-of-entering-data/qaq-p/3421457
- https://www.sapdatasheet.org/abap/devc/pp08.html
- https://docs.infor.com/wfm/2026/en-us/wfmopolh/weekly_timesheet_on-premise/mtd1475662341581.html
- https://docs.infor.com/wfm/2026/en-us/wfmclolh/mvs_user_cloud/ngs1531852419661.html
- https://docs.infor.com/wfm/2026/en-us/wfmclolh/mvs_user_cloud/ckz1475662020478.html
- https://docs.infor.com/wfm/2026/en-us/wfmclolh/mvs_user_cloud/lli1529699564445.html
- https://docs.infor.com/wfm/2026/en-us/wfmclolh/mvs_implementation_cloud/prr1475662009977.html
- https://support.shiftboard.com/l/en/article/79pycvaz5y-duplicate-copy-forward-existing-schedule
- https://support.shiftboard.com/l/en/article/ubngr0c7un-copy-shifts-new-user-interface
- https://support.shiftboard.com/l/en/article/1i0j9guc67-saved-schedules
- https://library.ukg.com/docs/en-us/UKG_Pro_WFM/Timekeeping/Basic_Schedules/Use_Quick_Actions/Use_Quick_Actions.html
- https://library.ukg.com/docs/en-us/UKG_Pro_WFM/Timekeeping/Basic_Schedules/Schedule_Patterns/Schedule_Patterns.html
- https://communityfiles.ukg.com/support/KOL/OnlineHelp-WorkforceDimensions/en-us/Content/Scheduling_Manager/CreatePattern.htm
- https://doc.workday.com/admin-guide/en-us/human-capital-management/workday-scheduling/centralized-scheduling/mass-generate-schedules-for-organizations.html
- https://doc.workday.com/admin-guide/en-us/human-capital-management/workday-scheduling/schedule-management-communications-and-productivit/concept--mass-edits.html
- https://doc.workday.com/admin-guide/en-us/human-capital-management/workday-scheduling/schedule-management-communications-and-productivit/concept--edit-mode.html
- https://manual.firstresonance.io/features/runs/scheduling.md
- https://manufacturo.com/manufacturo-manufacturing-management-software/

## Verification caveats

- Deputy's availability-exclusion list (shifts silently dropped when a team member is
  "already working elsewhere, on leave, unavailable, stressed, or not added to the
  location") is consistently attested in Google's index of Deputy's help content but
  could not be reconciled with the live article body (help.deputy.com returns 403 to
  direct fetching). Treat as probable-but-unverified.
- Homebase's copy-dialog internals are unconfirmed — its help center returns 401 to
  programmatic fetch with no Wayback snapshot; all Homebase claims are second-hand
  from search extracts of its own articles.
- The "3-week repeat cap" for Microsoft Shifts comes from a third-party university KB,
  is not corroborated by Microsoft, and should be treated as unverified.
- No official SAP documentation of *any* period-to-period shift-plan copy could be
  located; the PP08 object inventory contains no copy transaction, which is suggestive
  but not conclusive.
- Shiftboard's live support URLs now 301 to library.ukg.com after the UKG acquisition;
  its article text was read from Wayback snapshots (2022–2025).
- Whether Shiftboard's copy tools detect or skip pre-existing shifts on the target dates
  is not documented — assume no dedup.
- UKG's library search is JS-gated and community.ukg.com requires login, so "no bulk
  source-range→target-range copy in UKG" is *not documented publicly* rather than proven
  absent. Same caveat for Workday's login-gated manager job aids.
- Oracle Fusion Cloud Workforce Scheduling shipped a "Copy a Published Workforce
  Schedule" feature in release 25C — surfaced late, not surveyed in depth, and often
  conflated with Workday in search results.
