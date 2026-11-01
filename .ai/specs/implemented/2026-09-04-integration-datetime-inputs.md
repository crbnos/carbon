# Generic date + time inputs for integration steps

> Status: implemented
> Author: Aashu
> Date: 2026-09-04

## TLDR

An Activepieces `DATE_TIME` property renders as a date-only picker in the workflow
builder, so "Start date time of the event" on Google Calendar's Create Event cannot
be given a time. The piece requires one. Carry the vendor's own distinction between
a *date* and a *date-time* through the catalog as a presentation flag
(`precision: "datetime"`), and render `DateTimePicker` — already in `@carbon/react`
— for any input carrying it. The stored value becomes a full ISO instant resolved
against the **company timezone**, per `.claude/rules/date-handling.md`. This is a
generic catalog capability: every current and future piece `DATE_TIME` prop adapts
with no allowlist edit, and Carbon's own date inputs are untouched.

## Problem Statement

`google_calendar.create_google_calendar_event` declares:

```js
start_date_time: q.DateTime({ displayName: "Start date time of the event", required: true })
```

`toValueType` maps `DATE_TIME` to `t.date`
([properties.ts:92](packages/jobs/src/workflows/integrations/properties.ts#L92)), and
`LiteralControl`'s `date` branch renders `<DatePicker>`
([LiteralControl.tsx:215-224](apps/erp/app/modules/workflows/ui/Builder/fields/LiteralControl.tsx#L215-L224))
writing `YYYY-MM-DD` via `date.toString()`. There is no way to enter a time.

Two consequences, both live today:

1. **The author cannot express what the vendor requires.** A calendar event has a
   start *moment*, not a start day.
2. **What we do send is ambiguous.** The piece runs
   `dayjs(start_date_time).format("YYYY-MM-DDTHH:mm:ss.sssZ")`, which parses in the
   **worker's** local timezone. `"2026-09-10"` becomes midnight in whatever zone the
   job happens to run in — so the same workflow produces a different moment
   depending on infrastructure. The bug is not only the missing time picker; it is
   that a date-only literal is an underspecified instant.

The information was never missing — the piece told us the property was a
`DateTime` and we discarded that when mapping it to `t.date`.

## Proposed Solution

Carry the vendor's distinction through as a **presentation flag**, exactly as
`template?: boolean` already carries "this prose wants the multiline editor".

### Why not a new `PrimitiveKind`

A `"datetime"` primitive would ripple through `OPERATORS_BY_TYPE`, `operatorsForType`,
`compare.ts`, `values.ts`, `describeType`, `build.ts`'s `propertyType`, every
`switch` over `PrimitiveKind`, and would make a piece's datetime incomparable with a
Carbon `dueDate` in a condition. It buys nothing: the runtime already treats a
`date` value as an arbitrary `Date.parse`-able string
([types.ts:278](packages/workflows/src/definition/types.ts#L278),
[compare.ts:14-19](packages/workflows/src/runtime/compare.ts#L14-L19)), and
`fromColumn` already normalises a date column to a full ISO instant via
`parsed.toISOString()`
([values.ts:105-109](packages/workflows/src/runtime/values.ts#L105-L109)).

So a value carrying a time is **already legal** in the type it has. Only the
*control* was wrong. This is a presentation problem and gets a presentation fix.

### The flag

```ts
/** The input is a moment, not a calendar day: the builder renders a date AND time
 *  picker, and stores a full ISO instant. A vendor's DATE_TIME; never a Carbon
 *  business date, which is a day on the company's calendar and has no time. */
precision?: "datetime";
```

An optional string literal rather than a boolean (`datetime: true`) so a future
`"time"`-only or `"month"` vendor property extends the same field instead of
adding a second flag that can contradict the first. Absent means date-only —
every existing input keeps its exact behaviour, and the generated catalog diff is
limited to the props that actually changed.

Derived in one place:

```ts
// properties.ts
case "DATE_TIME":
  return { ...base, type: DATE, precision: "datetime" };
```

That single line is what makes this generic. Any piece we allowlist later —
Outlook Calendar, Calendly, Notion — gets a working time picker with no further
edit, because every piece declares its date-times as `DATE_TIME`.

### Timezone: the company's, per the existing documented handling

`.claude/rules/date-handling.md` already settles this: *"a form default that will be
persisted as a business date must use `useCompanyToday()` — the stored value belongs
to the company's calendar, not to whichever zone the person filling the form happens
to be in."* The same reasoning applies to a moment.

`useCompanyTimeZone()`
([useCompanyTimeZone.tsx:12](apps/erp/app/hooks/useCompanyTimeZone.tsx#L12)) reads
`company.timezone` (a NOT NULL column) off the authenticated root loader
synchronously. The builder routes live under `x+/workflows+/`, so it is available.

The conversion copies the existing wall-clock→instant pattern from
[ShiftsTable.tsx:82-85](apps/erp/app/modules/people/ui/Shifts/ShiftsTable.tsx#L82-L85):

```ts
toZoned(calendarDateTime, companyTimeZone).toAbsoluteString()
// → "2026-09-10T15:00:00.000-05:00"
```

Reading back for display is the inverse: `parseAbsolute(stored, companyTimeZone)`
→ `toCalendarDateTime`, so re-opening a saved node shows the same wall clock the
author typed. No JS `Date` anywhere on the path.

The vendor then receives an unambiguous instant, and `dayjs(...).format(...)`
reproduces that same moment regardless of which zone the worker runs in — which
also fixes the second half of the problem statement.

**Rejected: resolving the timezone server-side.** `runIntegrationAction` has
`client` and `companyId` in scope and could resolve it at run time
([integration.ts:49-56](packages/jobs/src/workflows/actions/integration.ts#L49-L56)).
But "3 PM" is the author's intent, known only at authoring time; resolving late
would mean reinterpreting a value that is already a stored instant, and would give
a ref from an upstream step (already an instant) different treatment from a literal.
Resolve once, at the point the human expresses the intent.

**Rejected: the browser's timezone.** Two admins in different offices editing the
same workflow would store different moments for the same typed time, and the value
would silently depend on who last touched the node.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Represent a datetime | Presentation flag on the input, keep `t.date` | Runtime already accepts a full ISO string for `date`; a new `PrimitiveKind` ripples through operators/compare/coercion and would make a vendor datetime incomparable with a Carbon date |
| Flag shape | `precision?: "datetime"` | Extensible to `"time"`/`"month"` later without a second contradicting boolean; absent = today's behaviour, so the catalog diff stays minimal |
| Where derived | `toValueType`'s `DATE_TIME` case, one line | Generic by construction — every piece declares date-times as `DATE_TIME`, so future pieces need no allowlist edit |
| Which props get it | Every `DATE_TIME` prop, automatically | The vendor already told us the type; mapping it to date-only is discarding information |
| Carbon-native date inputs | Unchanged | `dueDate`/`orderDate`/`postingDate` are business days with no meaningful time; they carry no flag and keep `DatePicker` |
| Timezone | Company timezone via `useCompanyTimeZone()` | The documented rule for persisted business values; `company.timezone` is NOT NULL and already on the authenticated root loader |
| Stored format | Full ISO instant with offset | Unambiguous for `dayjs` in the piece; identical in shape to what `fromColumn` already produces for refs |
| Control | `DateTimePicker` from `@carbon/react` | Already exists with calendar + time field; no new component. `@internationalized/date` is already a dependency of both `erp` and `packages/workflows`, so no new dependency anywhere |
| Allowlist override | None | Nothing to override — the vendor's own type is the signal. Adding an override would reintroduce the per-piece edit this fix removes |

## Data Model Changes

N/A — no migration. The flag lives in the generated workflow catalog (a committed
TypeScript file), and the stored node value keeps its existing
`{ kind: "literal", type: { kind: "primitive", of: "date" }, value: string }` shape.
`literalValueMatchesType` already accepts a full ISO string for `date`.

## API / Service Changes

No route, loader, action or service function changes. No server-side change at all:
the value arrives at `toPropsValue` already correct.

The flag is threaded through the catalog types and the generator:

| File | Change |
|------|--------|
| `packages/workflows/src/catalog/actions.ts` | declare `precision` on `ActionInputLike` |
| `packages/workflows/src/catalog/build.ts` | declare on `BuiltActionInput`; copy `spec.precision` in `buildDeclaredInputs` (a hand-written field list — an unlisted field is silently dropped); add a `validateCatalogInputs` rule that `precision` requires a `date` type |
| `packages/workflows/src/definition/catalog.ts` | declare on `CatalogInput` (what consumers read) |
| `packages/jobs/src/workflows/integrations/properties.ts` | declare on `MappedProperty`; set it in the `DATE_TIME` case |
| `packages/jobs/src/workflows/integrations/catalog.ts` | copy it into the emitted `declared` literal (also a hand-written field list) |
| `packages/workflows/src/catalog/actions.generated.ts` | regenerated — `generate-workflow-catalog.ts` emits via `JSON.stringify`, so the field carries automatically |

`scripts/check-workflow-catalog.ts` compares with `assert.deepStrictEqual` on whole
objects, so it picks the field up with no registration — and will fail loudly until
the catalog is regenerated.

## UI Changes

The builder's integration and action node forms. No new page, no new route.

| File | Change |
|------|--------|
| `fields/types.ts` | add `precision` to `ValueFieldProps` |
| `config/forms/StepInput.tsx` | forward `inputDef.precision` in the `ValueField` fallthrough (hand-picked prop list) |
| `fields/ValueField.tsx` | destructure and forward to `LiteralControl` (hand-picked prop list) |
| `fields/LiteralControl.tsx` | in the `date` branch, render `DateTimePicker` when `precision === "datetime"`, else the existing `DatePicker` |
| `config/forms/ComputeForm.tsx` | renders `ValueField` directly; passes nothing, so it keeps date-only — correct, as compute inputs are Carbon-typed |

`@internationalized/date` is already in `packages/workflows`' four-dependency runtime set and is
already imported by `LiteralControl` (`parseDate`), so `toZoned`/`toCalendarDateTime`/
`parseAbsolute` add nothing new to the browser bundle.

`pickControl` is untouched — it already returns `"literal"` for a date, and the
choice between the two pickers is internal to `LiteralControl`.

The variable path is unaffected: `{` still opens the variable menu, and a ref to an
upstream date still renders as a chip. Only the literal control changes.

**Copy**: `DateTimePicker`'s internal "Time" label and its `aria-label`s are the
component's own, and the field's own label comes from the vendor via the translated
label catalog. Any new user-facing string this change introduces goes through Lingui
(`t\`\``), consistent with the rest of `LiteralControl`.

## Acceptance Criteria

- [ ] On a Google Calendar "Create Event" node, "Start date time of the event"
      renders a picker with both a calendar and a time field; entering
      `2026-09-10` `3:00 PM` and saving stores an ISO instant whose offset is the
      company's timezone for that date.
- [ ] Re-opening that saved node displays `2026-09-10` and `3:00 PM` again — the
      same wall clock that was typed, not a shifted one.
- [ ] Running the node creates a Google Calendar event at 3:00 PM company time, and
      does so identically when the worker's `TZ` is set to something else
      (verifiable by running the mapping with two different `TZ` values).
- [ ] "End date time of the event" (optional, same `DATE_TIME` type) also renders a
      time picker; left empty, the event still defaults to start + 30 min.
- [ ] A Carbon-native action with a date input (e.g. a job's `dueDate`) still
      renders the date-only `DatePicker` and still stores `YYYY-MM-DD`.
- [x] `pnpm run check:workflow-catalog` passes after regenerating, and the generated
      diff shows `precision: "datetime"` on exactly the `DATE_TIME`-derived inputs
      and on nothing else.
- [x] A date value from an upstream step can still be dropped into a datetime input
      via `{`, and a datetime input still participates in conditions as a date.
- [x] `pnpm exec turbo run typecheck --filter=@carbon/workflows --filter=@carbon/jobs --filter=erp` and `pnpm run test` pass.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| An existing saved node holds a `YYYY-MM-DD` literal for a now-datetime input | Low | `parseAbsolute` fails on a date-only string, so the read-back helper falls back to parsing it as a calendar date at midnight company time — the same moment it effectively meant before, and the author can now set a real time. No migration; nothing crashes. |
| `buildDeclaredInputs` and the integrations `declared` literal are hand-written field lists | Med | Both are named explicitly in the plan; the catalog staleness check (`deepStrictEqual`) fails loudly if either is missed, so this cannot ship silently broken. |
| Company timezone unavailable before layout route data resolves | Low | `useCompanyTimeZone()` already falls back to `"UTC"`; the builder is deep inside `/x`, so the loader has run by the time a node form renders. |
| `DateTimePicker` is less exercised than `DatePicker` in this codebase | Low | It is an existing shipped component built on the same `@react-aria` primitives; verify in the real builder before calling this done. |
| DST: a wall time that does not exist (spring-forward gap) | Low | `toZoned`'s default `"compatible"` disambiguation shifts forward rather than throwing, per `.claude/rules/date-handling.md`. A 2:30 AM event on transition day resolves to 3:30 AM instead of failing. |

## Open Questions

> All resolved before this spec was written.

- [x] Whose timezone does a picked wall-clock time mean? — **Answer:** The company's,
      via the existing documented handling the user pointed to:
      `useCompanyTimeZone()` reading `company.timezone` off the authenticated root
      loader, with `toZoned(...).toAbsoluteString()` as in `ShiftsTable`, per
      `.claude/rules/date-handling.md`. Not the browser's (two admins in different
      offices would store different moments) and not UTC (the author types 3 PM and
      the meeting appears at 8 AM).
- [x] Every `DATE_TIME` prop, or opt-in per prop via the allowlist? — **Answer:**
      Every one, automatically. The piece already declared the type; an opt-in list
      would leave the default broken and require a manual edit per new piece, which
      is exactly what this fix removes.
- [x] Should Carbon's own date inputs (`dueDate`, `orderDate`, `postingDate`) change?
      — **Answer:** No. They are business days on the company's calendar with no
      meaningful time-of-day, and adding one would change what is written to those
      date columns.
- [x] New `PrimitiveKind` or a presentation flag? — **Answer:** Presentation flag.
      Settled by the codebase: the runtime already accepts a full ISO string for a
      `date` (`literalValueMatchesType`, `compare.orderable`, `fromColumn`), so a new
      kind would add ripple across operators/compare/coercion for no capability, and
      would break comparing a vendor datetime with a Carbon date in a condition.
- [x] Boolean `datetime: true` or `precision?: "datetime"`? — **Answer:** `precision`.
      A future `"time"`-only or `"month"` vendor property extends the same field
      instead of adding a second flag that could contradict the first.

## Changelog

- 2026-09-04: Created. Research: `.ai/research/datetime-input-plumbing.md`.
- 2026-09-04: Implemented per `.ai/plans/2026-09-04-integration-datetime-inputs.md`.
  `precision?: "datetime"` added to `ActionInputLike`, `BuiltActionInput` and
  `CatalogInput`; copied through `buildDeclaredInputs`; validated by a new
  `validateCatalogInputs` rule (precision requires a `date` type); derived in
  `toValueType`'s `DATE_TIME` case and carried through the integrations
  `declared` literal. Catalog regenerated — exactly four integration inputs
  gained the flag (`start_date_time`, `end_date_time` on Create Event;
  `start_date`, `end_date` on the events action), all inside
  `WORKFLOW_INTEGRATION_CATALOG`; no Carbon-native action input changed.
  `LiteralControl` renders `DateTimePicker` for a flagged input, resolving the
  wall clock against `useCompanyTimeZone()` and storing
  `toZoned(...).toAbsoluteString()`; a legacy `YYYY-MM-DD` literal falls back to
  midnight on the company calendar rather than throwing.
  Verified: scoped typechecks, `check:workflow-catalog`, full `pnpm run test`
  (696 jobs tests among them), `pnpm run lint`, and a round-trip proof that
  3:00 PM America/Chicago stores as `2026-09-10T20:00:00.000Z` and reads back as
  `15:00`, resolving to the same instant under TZ=UTC and TZ=Asia/Kolkata.
  Browser verification in the running builder still outstanding.

## Addendum — time-picker UX (2026-09-04)

The first implementation reused `@carbon/react`'s `DateTimePicker` as-is. Its
time slot was `TimePicker`, a **segmented spinner**: hh / mm / AM-PM as three
separate cells, each accepting only digits or arrow keys, with nothing to pick
from. Tabbing through segments to enter a meeting time is poor UX, so the time
slot was replaced.

`packages/react/src/Date/TimeCombobox.tsx` — a plain text input plus a popover
list of quarter hours:

- **Type freely.** The input holds raw text while focused and is interpreted only
  when the person is done (blur or Enter), so nothing fights the keystrokes.
- **Validate then revert.** `parseTypedTime` (`@carbon/utils`) reads `3`, `3p`,
  `3 pm`, `3:07pm`, `15:30`, `1530`, `930`. Text that is not a time — `25:00`,
  `3:75`, `13pm`, `abc` — reverts to the last valid value **silently**, and is
  never clamped: a silently corrected time is a meeting at the wrong hour that
  nobody notices. Escape abandons an edit the same way.
- **Pick from a list.** All 96 quarter hours on a **24-hour clock**, filtered as
  you type — `15` shows 15:00–15:45, `3` also reaches 03:00–03:45 (labels are
  zero-padded, so the filter matches unpadded too), `1530` finds 15:30 and `3pm`
  still lands on 15:00. Opens scrolled to the current value, or 09:00 when empty. Selection uses `onMouseDown`, because the input's blur
  would otherwise fire first and commit the half-typed draft over the choice.

### Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where the fix lands | The shared `@carbon/react` `DateTimePicker` | One implementation. MES job steps, API key expiry and the 4 Maintenance forms get the same improvement instead of Carbon growing a second time picker that drifts |
| List granularity | 15 minutes (96 entries) | What calendar apps offer; 30-minute steps miss the :15 and :45 people actually book. Free text still accepts any minute |
| Clock | 24-hour (`15:30`), via a new opt-in `hour24` argument on `formatTimeOfDay` | A dropped AM/PM is a meeting twelve hours out; `15:30` cannot be misread. Opt-in rather than global — Shifts, PeopleCard and PeopleHoursModal share `formatTimeOfDay` and keep their locale-driven 12-hour display. The parser still ACCEPTS `3pm`, so nobody's typing habit breaks |
| Invalid input | Revert silently to the last valid value | What the user asked for, and it matches how Carbon's number inputs already behave on blur |
| Parser location | `@carbon/utils` beside `formatTimeOfDay` | It is the inverse of that function and is unit-testable without a DOM; 6 new test cases cover the accepted and refused forms |

`TimePicker` is left exported and untouched — it is still the right control where
a bare time-of-day field is wanted, and removing it is not this change's business.

**Note:** `no-raw-rounding` (a real conformance check, not a style rule) rejected a
`Math.floor(minutes / 60)` in the first draft of the option list. It is built by
counting hour and minute instead — there was nothing to round in the first place.

Verified: `pnpm run test` (25/25 tasks, `@carbon/checks` conformance included),
`pnpm run lint` (33/33), and typechecks for `@carbon/react`, `@carbon/utils`,
`@carbon/form`, `erp`, `mes`, `@carbon/workflows`, `@carbon/jobs`.
Browser verification still outstanding.

## Addendum 2 — three picker bugs (2026-09-04)

Reported after the first UX pass. Two shared one root cause.

### 1 + 2. The main field showed 12-hour, and picking a date cleared the time

`useDatePickerState` **derives** granularity from the value
(`@react-stately/datepicker` `utils.mjs:167`: `v && 'minute' in v ? 'minute' : 'day'`).
Carbon passed no `granularity`, so an **empty** picker fell back to `"day"` and
its `hasTime` was false. In `selectDate` that takes the else branch —
`setValue(newValue)` with a bare `CalendarDate` — so a time the person had
already entered was discarded. `selectTime` meanwhile only parks the value in
`selectedTime` until a date exists, which is why the order mattered.

The same missing settings caused the 12-hour display: `hourCycle` was never
passed, so `DateField` rendered the locale's clock (12-hour for en-US) while the
popover list was already 24-hour — one field showing a time two ways.

Fixed by pinning both on the state **and** on `useDatePicker` (the latter builds
`fieldProps`, so the state alone would leave the visible field unchanged):

```ts
granularity: "minute",
hourCycle: 24,
```

Safe for every consumer: `packages/form`'s wrapper, `ApiKeysForm` and
`LiteralControl` all pass `CalendarDateTime`. (react-stately throws when a
declared granularity is absent from the value, so a `CalendarDate` caller would
have to be converted first — there is none today.)

Pinned by `packages/react/src/__tests__/DateTimePickerState.test.tsx`, which
asserts the upstream default that caused the bug as well as the fix, so the
reason the settings exist survives a future cleanup.

### 3. The dropdown flashed open and shut

`TimeCombobox`'s anchor IS its input, so Radix counted the same click that
focused the input as an outside press and closed the list immediately. Guarded
with `onInteractOutside`, which ignores an interaction whose target is the anchor
itself.

| Bug | Cause | Fix |
|---|---|---|
| Field showed 12-hour | No `hourCycle` on the picker | `hourCycle: 24` on state and `useDatePicker` |
| Time cleared by picking a date | Derived granularity `"day"` on an empty picker → `hasTime` false | `granularity: "minute"` |
| Dropdown flashed | Radix read the focusing click as an outside press | `onInteractOutside` ignoring the anchor |

Verified: typechecks for react/utils/form/erp/mes/workflows/jobs, `pnpm run test`
(25/25 tasks, 18 `@carbon/react` tests incl. 3 new), `pnpm run lint` (33/33),
`check:workflow-catalog`. Browser verification still outstanding.

## Addendum 3 — review fixes (2026-09-04)

A thermo-nuclear review found two correctness bugs, a scope overreach and a
single-source-of-truth violation. All were fixed before commit.

### Correctness

- **Clearing the time was a silent no-op.** `TimeCombobox`'s empty branch called
  `onChange(null)`, which is react-stately's `setTimeValue`. Verified by running
  the real hook: with a full value held, `setTimeValue(null)` emits **no
  `onChange` at all** — so the field blanked and the sync effect snapped it back.
  The clear branch is gone; empty text now reverts like any other unreadable
  draft, and clearing belongs to whoever owns the whole date-time value (the
  picker's own Clear button).
- **`state.timeValue` is a `CalendarDateTime`, not a `Time`.** It is only a bare
  `Time` in the transient time-before-date state. `toTimeString` now takes the
  narrowest shape both share (`{ hour, minute }`) instead of pretending
  otherwise, and the `as` cast in `DateTimePicker` is deleted.

### Scope: `hourCycle` is now the caller's choice

The previous pin forced a 24-hour clock on **15 call sites across 8 files** —
timecards, production events, MES job steps, maintenance dispatches and API keys
— none of which asked for it. Worse, the in-code justification was circular: it
claimed to fix a field "showing a time two different ways", but the old popover
was locale-aware; the new `TimeCombobox` created that mismatch and it was then
used to justify propagating 24-hour everywhere.

`hourCycle` is now an ordinary prop, defaulting to the locale. Only
`LiteralControl` passes `24`, because a workflow step's time is read by a machine
in another system. `granularity: "minute"` stays pinned for every caller — that
one is a genuine bug fix with a regression test behind it, and the review
confirmed it independently.

### Reuse: built on `Command`, not hand-rolled

The first version re-implemented filtering, popover wiring, scroll anchoring and
option rendering that `Combobox`/`Command` already own — including duplicating
the drawer `stopPropagation` workaround verbatim. It also declared
`role="combobox"` while providing none of that contract: no arrow-key
navigation, no `aria-activedescendant`, no option roles, and 96 option buttons
in the tab order.

Rewritten on `Command` + `CommandInputTextField` + `CommandList`/`CommandItem`,
following `apps/erp/app/components/Form/AddressAutocomplete.tsx`, the existing
in-repo precedent for a typeable field with a filtered list. cmdk supplies the
keyboard navigation and ARIA. Deleted outright: every `useRef`, the
`scrollIntoView` anchoring (which would have scrolled the whole Drawer), the
Radix `PopoverAnchor`/`onInteractOutside`/`onWheel` handling, and the
open-on-focus behaviour that threw a 96-row list over the calendar on tab-in.
An empty result now renders "No matching time" rather than silently falling back
to the full list.

Verified: typechecks for react/utils/form/erp/mes/workflows/jobs, `pnpm run test`
(25/25 tasks, 19 `@carbon/react` tests), `pnpm run lint` (33/33). Browser
verification still outstanding.
