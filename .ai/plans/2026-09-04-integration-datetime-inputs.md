# Generic date + time inputs for integration steps — implementation plan

**Spec / source:** `.ai/specs/2026-09-04-integration-datetime-inputs.md`
**Research:** `.ai/research/datetime-input-plumbing.md`
**Worktree:** `/Users/aashu/work/carbon/carbon-feat-active-pieces-integration`

## Progress
- [x] Task 1: Declare `precision` on the three catalog input types
- [x] Task 2: Derive `precision` from the piece's `DATE_TIME` property
- [x] Task 3: Regenerate the workflow catalog
- [x] Task 4: Render `DateTimePicker` for a `precision: "datetime"` input
- [x] Task 5: Verify end to end

## Dependencies

- Task 2 needs Task 1 (it sets a field Task 1 declares).
- Task 3 needs Tasks 1–2 (it regenerates from them) and MUST run before any typecheck that reads the generated catalog.
- Task 4 needs Task 1 (it reads `CatalogInput.precision`); it is otherwise independent of Tasks 2–3 and may be done in parallel with them.
- Task 5 needs everything.

## Background the executor needs

`precision?: "datetime"` is a **presentation-only** flag. The input's `ValueType`
stays `{ kind: "primitive", of: "date" }` — do NOT add a new `PrimitiveKind`, and do
not touch `compare.ts`, `values.ts`, `OPERATORS_BY_TYPE` or any `switch` over
`PrimitiveKind`. The runtime already accepts a full ISO instant for a `date`.

Two of the files on this path build their objects with **hand-written field lists**
rather than spreading, so an unlisted field is silently dropped:
`packages/workflows/src/catalog/build.ts` (`buildDeclaredInputs`) and
`packages/jobs/src/workflows/integrations/catalog.ts` (the `declared` literal).
Both are covered explicitly below.

**Never use JavaScript `Date`** anywhere in this work (`.claude/rules/date-handling.md`).
Use `@internationalized/date`, which is already a dependency of both `erp` and
`packages/workflows`.

---

## Task 1: Declare `precision` on the three catalog input types

**Depends on:** none
**Files:**
- Modify: `packages/workflows/src/catalog/actions.ts` — add `precision` to `ActionInputLike`
- Modify: `packages/workflows/src/catalog/build.ts` — add `precision` to `BuiltActionInput`, copy it in `buildDeclaredInputs`, add a validation rule
- Modify: `packages/workflows/src/definition/catalog.ts` — add `precision` to `CatalogInput`
- Copy from (precedent): the existing `template?: boolean` field in all three of those files

**Steps:**

1. In `packages/workflows/src/catalog/actions.ts`, in `interface ActionInputLike`,
   immediately after the `template?: boolean;` line (~line 13), add:

   ```ts
   /** The input is a moment, not a calendar day: the builder renders a date AND
    * time picker and stores a full ISO instant. Set from a vendor's `DATE_TIME`
    * property. Never set on a Carbon business date (`dueDate`, `orderDate`,
    * `postingDate`), which is a day on the company's calendar and has no time. */
   precision?: "datetime";
   ```

2. In `packages/workflows/src/catalog/build.ts`, in `interface BuiltActionInput`,
   immediately after its `template?: boolean;` line (~line 91), add the SAME field
   with the same doc comment.

3. In the same file, in `buildDeclaredInputs`, inside the `inputs[input] = { … }`
   object literal, immediately after the line
   `...(spec.template ? { template: true } : {}),` add:

   ```ts
   ...(spec.precision ? { precision: spec.precision } : {}),
   ```

   This literal does NOT spread `spec` — without this line the flag never reaches
   the generated catalog.

4. In the same file, in `validateCatalogInputs`, immediately after the existing
   `spec.template === true && …` block that pushes
   `` `${id}.${input} is a template but is not a string.` ``, add the parallel rule:

   ```ts
   if (
     spec.precision !== undefined &&
     !(spec.type.kind === "primitive" && spec.type.of === "date")
   ) {
     problems.push(`${id}.${input} declares precision but is not a date.`);
   }
   ```

5. In `packages/workflows/src/definition/catalog.ts`, in `interface CatalogInput`,
   immediately after its `template?: boolean;` line (~line 65), add the SAME field
   with the same doc comment. This is the shape the builder UI reads.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: exits 0. (The flag is optional and nothing sets it yet, so nothing breaks.)
```

**Out of scope:** `PrimitiveKind` / `primitiveKindSchema` in `definition/types.ts`;
`OPERATORS_BY_TYPE`; `compare.ts`; `values.ts`; any zod schema (none covers catalog
input declarations); `pickControl` in `fields/control.ts`.

---

## Task 2: Derive `precision` from the piece's `DATE_TIME` property

**Depends on:** Task 1
**Files:**
- Modify: `packages/jobs/src/workflows/integrations/properties.ts` — add `precision` to `MappedProperty`, set it in the `DATE_TIME` case
- Modify: `packages/jobs/src/workflows/integrations/catalog.ts` — copy it into the emitted `declared` literal
- Modify: `packages/jobs/src/workflows/integrations/properties.test.ts` — assert the new mapping
- Copy from (precedent): how `template: true` is set in `properties.ts`'s `LONG_TEXT`
  case and merged in `catalog.ts`

**Steps:**

1. In `packages/jobs/src/workflows/integrations/properties.ts`, in
   `interface MappedProperty`, after the `template?: boolean;` field (~line 41), add:

   ```ts
   /** The vendor declared a moment, not a day. The builder renders a date and time
    * picker; the stored value is a full ISO instant. */
   precision?: "datetime";
   ```

2. In the same file, in `toValueType`, change the `DATE_TIME` case from

   ```ts
   case "DATE_TIME":
     return { ...base, type: DATE };
   ```

   to

   ```ts
   // The vendor said DATE_TIME, not DATE. Dropping the time here is what left
   // Google Calendar's "Start date time of the event" with a date-only picker,
   // and made the value an underspecified instant the piece then read in the
   // WORKER's timezone.
   case "DATE_TIME":
     return { ...base, type: DATE, precision: "datetime" };
   ```

   This one line is what makes the fix generic — every piece declares its
   date-times as `DATE_TIME`, so future pieces need no further edit.

3. In `packages/jobs/src/workflows/integrations/catalog.ts`, inside the `declared`
   object literal, immediately after the existing block

   ```ts
   ...(mapped.template === true || override?.template === true
     ? { template: true }
     : {}),
   ```

   add:

   ```ts
   ...(mapped.precision === undefined
     ? {}
     : { precision: mapped.precision }),
   ```

   There is deliberately NO allowlist override for `precision` — the vendor's own
   type is the signal, and an override would reintroduce the per-piece edit this
   change removes. Do not add a field to `AllowlistPropOverride`.

4. In `packages/jobs/src/workflows/integrations/properties.test.ts`, find the
   existing assertion near line 52 that reads
   `expect(map({ type: "DATE_TIME" }).type).toEqual({ … })` and add a sibling
   assertion in the same test that
   `map({ type: "DATE_TIME" }).precision` equals `"datetime"`, plus one that a
   `SHORT_TEXT` property's `precision` is `undefined`. Match the file's existing
   test style — read the surrounding cases first and follow them.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-active-pieces-integration && pnpm exec turbo run typecheck --filter=@carbon/jobs && pnpm exec turbo run test --filter=@carbon/jobs
# Expected: typecheck exits 0; tests pass, including the new DATE_TIME precision assertions.
```

**Out of scope:** `allowlist.ts` (no override field); `visibility.ts`; `outputs.ts`
(a piece's `format: "datetime"` OUTPUT is a separate, already-working path — do not
touch it); `toPropsValue` (the value arrives already correct).

---

## Task 3: Regenerate the workflow catalog

**Depends on:** Tasks 1 and 2

**Files:**
- Modify (generated, do NOT hand-edit): `packages/workflows/src/catalog/actions.generated.ts`

**Steps:**

1. Run the generator:

   ```bash
   cd /Users/aashu/work/carbon/carbon-feat-active-pieces-integration && pnpm run generate:workflow-catalog
   ```

   `scripts/generate-workflow-catalog.ts` emits via `JSON.stringify`, so the new
   field carries automatically; the script then runs biome, which is why generated
   keys are unquoted.

2. Inspect the diff and confirm it is limited to `precision: "datetime"` appearing on
   integration inputs that came from a `DATE_TIME` property, and on nothing else:

   ```bash
   git diff --stat packages/workflows/src/catalog/actions.generated.ts
   git diff packages/workflows/src/catalog/actions.generated.ts | grep '^[+-]' | grep -v '^[+-][+-]'
   ```

   Expect `+` lines only, every one containing `precision: "datetime"`. Google
   Calendar's `start_date_time` and `end_date_time` must be among them.

   If any line changes something OTHER than adding `precision`, STOP and report —
   do not improvise.

3. Confirm no Carbon-native action input gained the flag: every `+` line must sit
   inside `WORKFLOW_INTEGRATION_CATALOG`, not `WORKFLOW_ACTION_CATALOG`. (Carbon's
   own `dueDate`/`orderDate`/`postingDate` are built from the database schema by
   `propertyType`, which never sets `precision`.) If an action-catalog input gained
   it, STOP and report.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-active-pieces-integration && pnpm run check:workflow-catalog
# Expected: exits 0. This uses assert.deepStrictEqual on the whole catalog, so it
# fails loudly if the generated file and the builders disagree.
```

**Out of scope:** hand-editing `actions.generated.ts`; `events.generated.ts`,
`labels.generated.ts`, `help.generated.ts` (this change adds no label or event).

---

## Task 4: Render `DateTimePicker` for a `precision: "datetime"` input

**Depends on:** Task 1 (may run in parallel with Tasks 2–3)
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/fields/types.ts` — add `precision` to `ValueFieldProps`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/config/forms/StepInput.tsx` — forward `inputDef.precision`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/fields/ValueField.tsx` — destructure and forward
- Modify: `apps/erp/app/modules/workflows/ui/Builder/fields/LiteralControl.tsx` — branch the `date` case
- Copy from (precedent): `packages/form/src/components/DateTimePicker.tsx:60-86` — the
  exact `parseAbsolute` → `toCalendarDateTime` read and
  `toZoned(...).toAbsoluteString()` write round-trip. Our version substitutes
  `useCompanyTimeZone()` for that file's `getLocalTimeZone()`.

**Steps:**

1. In `fields/types.ts`, in `ValueFieldProps`, immediately after the
   `choices?: readonly string[];` line, add:

   ```ts
   /** The input is a moment, not a calendar day: render a date AND time picker
    * and store a full ISO instant, resolved against the company's timezone. */
   precision?: "datetime";
   ```

2. In `config/forms/StepInput.tsx`, in the final `return (<ValueField … />)`
   fallthrough, add `precision={inputDef.precision}` immediately after the existing
   `choices={inputDef.choices}` line. This prop list is hand-picked — without this
   line `ValueField` never sees the flag.

3. In `fields/ValueField.tsx`:
   - add `precision` to the destructured props at the top of the component
     (alongside `choices`);
   - in the `<LiteralControl … />` call in the `else` branch, add
     `precision={precision}` immediately after `choices={choices}`.

4. In `fields/LiteralControl.tsx`:

   a. Extend the imports. From `@carbon/react` add `DateTimePicker` to the existing
      import list. Replace the current `@internationalized/date` import
      (`parseDate`) with:

      ```ts
      import {
        parseAbsolute,
        parseDate,
        toCalendarDateTime,
        toZoned
      } from "@internationalized/date";
      ```

      and add:

      ```ts
      import { useCompanyTimeZone } from "~/hooks";
      ```

   b. Beside the existing `asCalendarDate` helper, add a read helper. It must handle
      three cases: a full ISO instant (the new format), a legacy `YYYY-MM-DD`
      literal saved before this change, and anything unparseable.

      ```ts
      /** Stored datetimes are the full ISO instant the picker itself writes. A
       * value saved before datetime inputs existed is a bare `YYYY-MM-DD`, which
       * `parseAbsolute` rejects — read it as midnight on the company's calendar,
       * the moment it already effectively meant. Anything else leaves the picker
       * empty rather than crashing the node form. */
      function asCalendarDateTime(value: unknown, timeZone: string) {
        if (typeof value !== "string" || !value) return null;
        try {
          return toCalendarDateTime(parseAbsolute(value, timeZone));
        } catch {
          const date = asCalendarDate(value);
          return date ? toCalendarDateTime(date) : null;
        }
      }
      ```

   c. Add `precision?: "datetime";` to `LiteralControlProps` (next to `choices`) and
      destructure it in the component signature.

   d. Call the hook at the top of the component body, beside the existing
      `const { t } = useLingui();`:

      ```ts
      const companyTimeZone = useCompanyTimeZone();
      ```

      It must be called unconditionally at the top level — never inside the `date`
      branch, which would violate the rules of hooks.

   e. Replace the existing `case "date":` block with one that branches on the flag,
      keeping the date-only path byte-for-byte as it is today:

      ```ts
      case "date": {
        // A vendor's DATE_TIME. The picked wall clock is resolved against the
        // COMPANY's timezone, not the browser's — two admins in different offices
        // must not store different moments for the same typed time — and stored as
        // a full ISO instant, so the piece's own `dayjs(value).format(...)`
        // reproduces that moment whatever zone the worker runs in.
        if (precision === "datetime") {
          return shell(
            <DateTimePicker
              value={asCalendarDateTime(value, companyTimeZone)}
              onChange={(date) =>
                emit(
                  date
                    ? toZoned(date, companyTimeZone).toAbsoluteString()
                    : undefined
                )
              }
              aria-label={t`Date and time`}
              isDisabled={isReadOnly}
            />
          );
        }
        return shell(
          <DatePicker
            value={asCalendarDate(value)}
            onChange={(date) => emit(date?.toString() ?? undefined)}
            aria-label={t`Date`}
            isDisabled={isReadOnly}
          />
        );
      }
      ```

      Note `DateTimePicker`'s `onChange` may be typed loosely (the form wrapper casts
      it). If TypeScript objects to the handler or to `value`, mirror whatever cast
      `packages/form/src/components/DateTimePicker.tsx` uses at its own
      `onChange={handleChange as any}` call site rather than inventing a new one.

   f. The new `aria-label` string uses Lingui's `t` macro, consistent with every
      other label in this file. Do not introduce an untranslated English string.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-active-pieces-integration && pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0.
```

**Out of scope:** `fields/control.ts` `pickControl` (already returns `"literal"` for a
date — the choice between the two pickers is internal to `LiteralControl`);
`ComputeForm.tsx` (renders `ValueField` directly and passes no `precision`, so its
Carbon-typed date inputs correctly stay date-only); `TemplateField`,
`MultiChoiceField`, `PairsField`, `OptionsField`; `packages/react`'s
`DateTimePicker` itself (use it as-is).

If `useCompanyTimeZone` cannot be imported from `~/hooks` inside this file (a
circular import, or the builder rendering outside the `/x` layout), STOP and report —
do not fall back to `getLocalTimeZone()`, which would store a different moment
depending on who edited the workflow.

---

## Task 5: Verify end to end

**Depends on:** Tasks 1–4

**Steps:**

1. Full scoped verification:

   ```bash
   cd /Users/aashu/work/carbon/carbon-feat-active-pieces-integration
   pnpm exec turbo run typecheck --filter=@carbon/workflows --filter=@carbon/jobs --filter=erp
   pnpm run check:workflow-catalog
   pnpm run test
   pnpm run lint
   ```

   Expected: all four exit 0. (A whole-repo `pnpm run typecheck` OOMs per
   `AGENTS.md`, so it stays scoped.)

2. Confirm the round-trip logic directly, without a browser, by checking that a
   wall clock resolved in a company timezone reads back as the same wall clock:

   ```bash
   cd /Users/aashu/work/carbon/carbon-feat-active-pieces-integration && pnpm exec tsx -e '
   import { CalendarDateTime, parseAbsolute, toCalendarDateTime, toZoned } from "@internationalized/date";
   const tz = "America/Chicago";
   const typed = new CalendarDateTime(2026, 9, 10, 15, 0);
   const stored = toZoned(typed, tz).toAbsoluteString();
   const readBack = toCalendarDateTime(parseAbsolute(stored, tz));
   console.log("stored:", stored);
   console.log("reads back as:", readBack.toString());
   console.log("same wall clock:", readBack.toString() === typed.toString());
   '
   # Expected: "same wall clock: true", and `stored` ends in a -05:00/-06:00 offset
   # (NOT a bare date, and NOT Z unless the company timezone is UTC).
   ```

   If `same wall clock` is false, STOP and report — the read and write helpers
   disagree and every saved node would drift.

3. Browser check in the real builder (ask the user before driving the app, per
   `AGENTS.md`). Open a workflow, add an Integration node, pick Google Calendar →
   Create Event, and confirm each acceptance criterion in the spec:
   - "Start date time of the event" shows a calendar AND a time field;
   - entering a date and `3:00 PM`, saving, and re-opening the node shows `3:00 PM`
     again;
   - "End date time of the event" also shows a time field;
   - a Carbon-native action with a date input still shows the date-only picker.

4. Tick every box in the spec's Acceptance Criteria that now holds, and update the
   spec's changelog with an implementation line.

**Out of scope:** committing (the user commits — never run `git commit` without
explicit permission); moving the spec to `.ai/specs/implemented/`; running a
database migration (there is none).
