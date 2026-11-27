# Dates, numbers and i18n lessons

Time zones, @internationalized/date, numeric precision and rounding, currency, Lingui translations.

## A company with time zone UTC shifts every business day

```scope
id: a-company-with-time-zone-utc-shifts-every-business-day
paths: ["packages/database/src/datasets/bootstrap.ts"]
triggers: ["companyTimeZone","weekBounds","timesheetWeek","seedCompanyReferenceData"]
```

**Context:** The week views of My Time (ERP and MES) and the DCAA entry window compute the week in the company time zone (`timesheetWeek`, `datetime.weekBounds(companyTimeZone, offset)`).

**Problem:** The dev bootstrap inserted the company with no time zone, so `company.timezone` was `UTC` while its locations were `America/Chicago`. On a Sunday evening in Chicago the server's day was already Monday, and the timesheet opened on next week. It looked like a week-math bug; the math was correct for the wrong zone.

**Rule:** A company row always gets a real IANA time zone at creation (`seedCompanyReferenceData` now uses the default location's zone). When a date-bound view is off by one day or one week, check `company.timezone` and the location time zones before the date code.

**Applies to:** `packages/database/src/datasets/bootstrap.ts`, onboarding, every view that derives a business day or week from the company time zone.

## A Lingui placeholder is named after its expression, so a refactor can silently drop translations

```scope
id: a-lingui-placeholder-is-named-after-its-expression-so-a-refa
paths: ["packages/locale/locales/**/*.po"]
triggers: ["<Plural","<Trans","plural(","lingui:extract"]
```

**Context:** Strict backflush (2026-10-16) changed `<Plural value={methodsMissingPullFrom} …>` to `<Plural value={gaps.methods} …>`.

**Problem:** A member expression has no name, so the message id changed from `{methodsMissingPullFrom, plural, …}` to `{0, plural, …}`. `lingui:extract --clean` then deleted the old id and its 12 translations, and the new id came back untranslated.

**Rule:** Pass a plain, named variable to `Plural`, `t` and `Trans` placeholders, and keep the name when refactoring. If extract drops translations by mistake, restore the catalogs from git (`git checkout HEAD -- packages/locale/locales`), fix the name, and extract again.

**Applies to:** every `Plural` / `t\`…${x}\`` / `<Trans>` with an interpolation.

## Lingui: `plural()` inside a `memo(…)` component calls the global i18n

```scope
id: lingui-plural-inside-a-memo-component-calls-the-global-i18n
paths: []
triggers: ["plural(","@lingui/core/macro"]
```

**Context:** The jobs table's bulk-release toast needed "Released 1 job" / "Released N jobs". The table is `memo((props) => { … })`, and the toast text was written as `` t`${plural(count, { one: "Released # job", other: "Released # jobs" })}` `` with `t` from `useLingui()` and `plural` from `@lingui/core/macro`.

**Problem:** Lingui 6.9.0's macro transform folds a nested `plural()` into the surrounding `t` only when the component or hook is a function declaration or a plain `const X = () => …`. When the function is an inline ARGUMENT of a call (`memo((props) => …)`), the `plural()` is expanded on its own into `i18n._(…)` on the global `@lingui/core` instance, and the outer `t` becomes `{0}` with that call as its value. The global instance is never activated here (see `.claude/rules/i18n-lingui-system.md`), so the string throws "Attempted to call a translation function without setting a locale" the first time it is built. Typecheck, oxlint and `lingui:extract` all pass: the catalog shows a normal ICU plural msgid. Only the compiled output shows it.

**Rule:** `select()` from `@lingui/core/macro` inside a `memo(…)` component has the same defect as `plural()`. For a string (a toast), besides a function-declaration hook, you can choose between two whole `t` phrases (``n === 1 ? t`Released 1 job` : t`Released ${n} jobs` ``) — both phrases are extracted and translated, but a locale with more plural forms gets only two. The rest is in `.claude/rules/i18n-lingui-system.md` (Plurals).

**Applies to:** every `memo(…)` component in `apps/{erp,mes}/app` and `packages/{react,form}/src` (most ERP tables); any new use of `plural` / `select` from `@lingui/core/macro`.

## Typed quantities do not need Number wrappers

```scope
id: typed-quantities-do-not-need-number-wrappers
paths: []
triggers: [{"text":"Number(","minCount":3}]
```

**Context:** Showing issued quantities and current bin stock in MES and ERP.

**Problem:** New code wrapped `number` and nullable `number` values in `Number(...)`, adding noise around ordinary comparisons and arithmetic.

**Rule:** Use a typed quantity directly, with `?? 0` when it is nullable. Convert only at a boundary where the value can actually be a string.

**Applies to:** MES quantity displays, inventory RPC results, and ERP posting code using parsed numeric inputs.

## Lingui: a string literal with braces inside `<Trans>` loses its braces

```scope
id: lingui-a-string-literal-with-braces-inside-trans-loses-its-b
paths: ["apps/erp/app/modules/settings/ui/Sequences/*.tsx"]
triggers: ["{\"%{","%{yy}"]
```

**Context:** The sequence forms' week year warning named the tokens in its text: `<Trans>On 1 January 2027 {"%{yy}%{ww}"} gives 2753.</Trans>`.

**Problem:** Lingui inlines a string literal expression into the message, so the msgid became `On 1 January 2027 %{yy}%{ww} gives 2753.` The braces then parse as ICU placeholders `{yy}` and `{ww}` with no value, and the page showed "On 1 January 2027 %% gives 2753." Typecheck, oxlint and `lingui:extract` all pass.

**Rule:** Text that contains `{` or `}` goes into `<Trans>` or `t` as a named variable (`const token = "%{yy}"; … {token}`), which Lingui keeps as a placeholder and fills at runtime. Read the rendered text once after adding such a string.

**Applies to:** any `<Trans>` or `` t` ` `` that quotes sequence tokens, template syntax or JSON.

## Lingui `plural()` must be the whole message, with no variables in its branches

```scope
id: lingui-plural-must-be-the-whole-message-with-no-variables-in
paths: []
triggers: ["plural("]
```

**Context:** Accessibility labels like "3 jobs for SO000001, in progress" were written as `` t`${plural(n, { one: "# job for", other: "# jobs for" })} ${orderId}` `` and later with `${orderId}` inside the branches.

**Problem:** The macro only folds `plural()` into the ICU message when it is the entire `t` template and its branches are plain strings. Text around it, or template variables inside a branch, leave `plural()` to run at render through Lingui's global instance, which has no active locale on the server — the whole route throws ("Attempted to call a translation function without setting a locale"). Typecheck and unit tests pass; only rendering the cell shows it.

**Rule:** Use `` t`${plural(n, { one: "# job", other: "# jobs" })}` `` with literal branches and nothing else in the template, or phrase the string so the count needs no agreement (`` t`Jobs for ${orderId}: ${n}` ``). Load the page after adding any `plural()`.

**Applies to:** every `plural()` / `select()` from `@lingui/core/macro` inside `t`/`msg`, especially in table cell renderers.

## `.po` catalogs are committed only after `lingui:clean`

```scope
id: po-catalogs-are-committed-only-after-lingui-clean
paths: ["packages/locale/locales/**/*.po"]
triggers: ["lingui:extract","lingui:clean"]
```

**Context:** `pnpm run lingui:extract` alone leaves `#: path:line` origin comments and a
`POT-Creation-Date` header in all 26 catalogs — 170k diff lines for ~30 real strings.

**Rule:** always `pnpm run lingui:extract && pnpm run lingui:clean` (or `pnpm run translate`);
the commit hook normalises, but the working tree should never carry the noise.

## A tagged `t` only works in the component that called `useLingui`

```scope
id: a-tagged-t-only-works-in-the-component-that-called-uselingui
paths: []
triggers: ["TemplateStringsArray","MessageDescriptor) => string"]
```

- **Context:** a helper took `t` as a parameter and used it as a tagged template.
- **Problem:** the Lingui macro transforms `t` only where `useLingui` binds it. Typecheck passes, but `extract` drops the message and the call receives a template array at runtime.
- **Rule:** keep the tagged `t` in the component or a closure inside it. Pass finished strings to helpers. If a new message is missing after `lingui:extract`, look for this first.
- **Applies to:** every `t` passed through a function parameter.

## Lingui: a ternary inside t`` bakes the English words as runtime values

```scope
id: lingui-a-ternary-inside-t-bakes-the-english-words-as-runtime
paths: []
triggers: ["=== 1 ? \"","<Plural","plural("]
```

**Context:** Building the quote lead-time modal, plural labels were written as
`` t`${days} ${days === 1 ? "day" : "days"}` `` and
`` t`${n} ${n === 1 ? "operation has" : "operations have"} no time standards` ``.

**Problem:** Lingui extracts that as `{0} {1} no time standards` — the "day"/
"days"/"operation has"/"operations have" strings are computed at runtime and
passed in as PLACEHOLDER VALUES, never as translatable text. So every locale's
`msgstr` still contains the English word, `linguito check` stays green (nothing
is "missing"), and a French user reads "5 days", not "5 jours". The defect is
invisible to the missing-translation gate because the placeholder IS filled.

**Rule:** Never put a pluralizing (or any word-choosing) ternary inside a
`t` tagged template or `<Trans>`. Use the ICU plural macro: `<Plural value={n}
one="# day" other="# days" />` from `@lingui/react/macro` (or `plural()` in
non-JSX — but not inside a `memo(…)`-wrapped component, see "Lingui: `plural()`
inside a `memo(…)` component calls the global i18n" below). The whole phrase
with `#` goes in each branch
(`one="# operation has no time standards"`), so the words are extracted and
translated. After adding one, re-run `lingui:extract` + `/translate` — the new
ICU msgid needs its own filled `msgstr` per locale (locales with more CLDR
categories, e.g. Polish/Russian `few`/`many`, get the extra branches).

**Applies to:** any `apps/{erp,mes}/app` or `packages/{react,form}/src` string
with a count-dependent word; grep `? "` inside `` t` `` templates when reviewing
i18n.

## Lingui's `msg` macro forces generated translatable strings into their own file

```scope
id: lingui-s-msg-macro-forces-generated-translatable-strings-int
paths: ["packages/ee/src/workflows/catalog/**"]
triggers: ["labels.generated",".generated.ts"]
```

**Context:** The generated workflow catalog needs a human label per event, and
Carbon's convention outside React is `msg` from `@lingui/core/macro`.

**Problem:** `msg` is a **build-time babel macro**. A generated file containing
one can only ever be imported by Vite-built app code — importing it from plain
Node throws, which would break the phase-3 matcher in `packages/jobs`, every
`tsx` script, and any vitest run that touches the catalog.

**Rule:** Tooling that must read the labels reads `labels.generated.ts` as **text**
(regex the keys) rather than importing it — `scripts/check-workflow-catalog.ts`
does exactly that. The same split holds for any future generated file that needs
both translatable strings and a Node-side consumer. The rest is in
`.claude/rules/workflow-event-catalog.md` (Labels are a separate file).

**Applies to:** `packages/ee/src/workflows/catalog/`, `scripts/check-workflow-catalog.ts`,
and any future generated file that needs both translatable strings and a Node-side consumer.

## `useNumberFormatter()` with no argument is a new formatter on every render

```scope
id: usenumberformatter-with-no-argument-is-a-new-formatter-on-ev
paths: ["apps/erp/app/modules/**/PurchasingPlanningTable.tsx","apps/erp/app/modules/**/ProductionPlanningTable.tsx"]
triggers: ["useNumberFormatter()"]
```

**Context:** Opening or closing the order drawer on the planning pages stuttered. The drawer
itself was cheap; the table behind it was the cost.

**Problem:** react-aria memoizes the formatter on the options OBJECT
(`useMemo(() => new NumberFormatter(locale, options), [locale, options])`), and the default
`options = {}` is a new object on each call. So `useNumberFormatter()` returns a new formatter
every render. It was a dependency of the table's `columns` memo, so every render rebuilt the
columns; TanStack then sees new `cell` functions and React REMOUNTS every cell, and the
shared `Table` re-measures its column widths. Opening the drawer re-rendered the table six
times through fetcher state — 1,824 DOM nodes replaced, six main-thread blocks of 90–220 ms.
With a stable formatter: zero nodes replaced, and the drawer shows in ~100 ms instead of ~220.

**Rule:** A value that feeds a `useMemo`/`useCallback` dependency list must be stable. Pass
`useNumberFormatter` a module-level options constant (or use the `@carbon/utils` formatter
hooks), never the bare call. When a table feels slow, count DOM nodes replaced in its
`tbody` during the interaction before optimizing anything else — a non-zero count on an
interaction that changes no data means the columns are being rebuilt.

**Applies to:** `PurchasingPlanningTable.tsx`, `ProductionPlanningTable.tsx` (fixed), and the
other ERP files that still call `useNumberFormatter()` bare — it only costs where the
formatter reaches a memo dependency list (`InventoryTable`, `TrackedEntitiesTable`,
`JobMaterialsTable`, `DemandProjectionTable`, `JobOperationStepRecordsTable` are the
candidates to check).
