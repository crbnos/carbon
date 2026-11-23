# Research: presentation-flag plumbing for workflow catalog inputs

Traced 2026-09-04 against the `template?: boolean` flag, which is the exact
precedent for a new presentation-only input flag.

## Declaration points (must edit)

| # | File:line | What |
|---|---|---|
| 1 | `packages/workflows/src/catalog/actions.ts:13` | `ActionInputLike` — hand-written + generator-facing spec. `IntegrationDeclarationLike` (:56) reuses it via `Omit<ActionDeclarationLike, …>` |
| 2 | `packages/workflows/src/catalog/build.ts:91` | `BuiltActionInput` — the emitted shape. `BuiltIntegration` (:117) reuses `BuiltAction`'s inputs |
| 3 | `packages/workflows/src/catalog/build.ts:178` | `buildDeclaredInputs` (fn :155, literal :163-182) copies `spec.template` field-by-field — **does NOT spread `spec`**, so a new flag is silently dropped without a line here. Shared by actions, integrations and operations |
| 4 | `packages/workflows/src/definition/catalog.ts:65` | `CatalogInput` — the shape every consumer (validator, builder UI) reads |
| 5 | `packages/jobs/src/workflows/integrations/properties.ts:41` | `MappedProperty`; derived in `toValueType` (:79-113), `case "DATE_TIME"` at :92 |
| 6 | `packages/jobs/src/workflows/integrations/allowlist.ts:35` + `integrations/catalog.ts:82-84` | `AllowlistPropOverride` and the merge into the emitted `declared` literal (:63-101, also field-by-field) |
| 7 | `apps/erp/.../config/forms/StepInput.tsx:161-178` | `renderStepInput` fallthrough hand-picks props for `ValueField` (`type` :169, `required` :170, `choices` :171) |
| 8 | `apps/erp/.../fields/types.ts:17-47` | `ValueFieldProps`, shared by ValueField/TemplateField/MultiChoiceField/PairsField |
| 9 | `apps/erp/.../fields/ValueField.tsx:14-31`, `:119-137` | destructure + hand-written `LiteralControl` prop list |
| 10 | `apps/erp/.../fields/LiteralControl.tsx:37-51`, date branch `:215-224` | props type + the `<DatePicker>` branch |
| 11 | `packages/workflows/src/catalog/build.ts` ~`:510` | `validateCatalogInputs` — allowlist of consistency rules; `template` has one at :510-515 |
| 12 | `apps/erp/.../fields/control.ts:35-48` | only if the flag changes control SELECTION (it does not — `pickControl` already returns `"literal"` for a date) |

## Automatic — no edit needed

- `scripts/generate-workflow-catalog.ts:66-77` emits via `JSON.stringify(sorted(...))` → a new field carries automatically. Biome reformats afterwards, which is why generated keys are unquoted.
- `scripts/check-workflow-catalog.ts:200,216` uses `assert.deepStrictEqual` on whole objects → compared automatically, fails loudly until regenerated.
- `packages/workflows/src/catalog/catalog.ts:43-55` spreads (`{ id, ...action }`).
- `ActionForm.tsx:378-399` / `IntegrationNodeForm.tsx:374-400, 416-440` pass `inputDef` WHOLE into `renderStepInput`.
- No zod schema covers catalog input declarations — `CatalogInput`/`ActionInputLike`/`BuiltActionInput` are plain TS interfaces, and no `.strict()` exists in `definition/catalog.ts` or `definition/schema.ts`. TypeScript excess-property checking is the only strictness.

## Other facts

- There is NO `integrations.generated.ts`. `WORKFLOW_INTEGRATION_CATALOG` lives inside `actions.generated.ts:321`.
- `ComputeForm.tsx:210-212` renders `ValueField` directly, bypassing `StepInput` — a second call site.
- `LiteralControl.tsx:28-35` `asCalendarDate` parses `parseDate(value.slice(0,10))` — date-only.

## Timezone machinery (the documented handling to follow)

- `apps/erp/app/hooks/useCompanyTimeZone.tsx:12` — `useCompanyTimeZone(): string`
  reads `company.timezone` off `useRouteData(path.to.authenticatedRoot)`, falling
  back to `"UTC"`. Synchronous, client-side, available to any component under `/x`
  (the workflow builder routes are `apps/erp/app/routes/x+/workflows+/`).
  `useCompanyToday()` (:22) is the date-only sibling already used for business-date
  form defaults. Exported from `~/hooks` (`hooks/index.ts:50-51`).
- `company.timezone` is a NOT NULL column (`packages/database/src/types.ts:6715`).
- `.claude/rules/date-handling.md` is the rule: JS `Date` is banned for parsing,
  formatting and arithmetic; a form default that will be PERSISTED as a business
  value must use the company's timezone, not the browser's.
- **Wall-clock → instant, the pattern to copy**:
  `apps/erp/app/modules/people/ui/Shifts/ShiftsTable.tsx:82-85`
  ```ts
  toZoned(toCalendarDateTime(today(tz), parseTime(time)), tz).toAbsoluteString()
  ```
- `no-local-timezone` (`packages/checks/src/conformance/no-local-timezone.ts:18-42`)
  bans `getLocalTimeZone()` and friends in SERVER paths only. A client component
  using the company timezone is compliant; using `getLocalTimeZone()` for a
  persisted value would be wrong on the merits even where the check does not reach.

## Why the vendor value must be a full instant

`@activepieces/piece-google-calendar@0.10.3` `runCreateEvent` does:
```js
{ dateTime: dayjs(start_date_time).format("YYYY-MM-DDTHH:mm:ss.sssZ") }
```
dayjs parses the value and formats it with an OFFSET taken from the WORKER's
local zone. A naive wall-clock string (`2026-09-10T15:00`) would therefore be
interpreted in the worker's zone. A full ISO instant with an offset
(`2026-09-10T15:00:00.000-05:00`) is unambiguous and formats back to the same
moment regardless of worker zone. `end_date_time` is optional and defaults to
`dayjs(start).add(30, "m")`, so it inherits the same correctness.

## Storage format is already consistent

`packages/workflows/src/runtime/values.ts:105-109` coerces a `date` column value
via `parsed.toISOString()` — so a date-typed value from an UPSTREAM step is
already a full ISO instant. A literal storing a full ISO instant matches what
refs already produce, and `literalValueMatchesType`
(`definition/types.ts:278`) accepts any `Date.parse`-able string. `compare.ts`
`orderable()` (:14-19) likewise parses with `Date.parse`. So no schema, no
runtime and no new `PrimitiveKind` are needed.

## Server-side alternative considered

`packages/jobs/src/workflows/actions/integration.ts:49-56` `runIntegrationAction`
has both `client` and `companyId` in scope immediately before `toPropsValue`
(:117), so the company timezone COULD be resolved there instead. Rejected in the
spec: the author's intent ("3 PM") is only knowable at authoring time, and
resolving late would reinterpret an already-stored instant.
