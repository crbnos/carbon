# Content and microcopy

## Contents
1. Casing
2. Tone
3. Copy patterns by surface
4. Lingui — every string translatable
5. Terminology and glossary
6. Formatting numbers, money, dates

---

## 1. Casing — Title Case names things, sentence case says things

| Title Case | Sentence case |
|---|---|
| column headers ("Start Date", "Unit of Measure") | toasts ("Updated quote line") |
| form labels ("Tax Amount") | empty states ("No lines yet") |
| buttons ("Add Note", "Mark Short") | descriptions, helper text |
| menu items ("Delete Line", "Export Lines to CSV") | confirmation bodies |
| page, table, card, modal and drawer titles ("Sales Orders", "New Payment Term") | placeholders ("e.g. Acme Manufacturing") |
| breadcrumbs, sub-nav entries | aria-labels ("Remove slide") |
| | modal titles phrased as questions ("Discard this import?") |

Minor words stay lower in Title Case ("Unit of Measure", "Copy Link to Sales Order"). Domain
nouns keep capitals inside sentences only when they're proper Carbon objects in context — be
consistent within a screen (don't mix "Copy link to issue" and "Copy link to Sales Order").

## 2. Tone

- **Terse and system-voiced for outcomes:** "Failed to update quote", "Supplier part deleted".
- **Consequence-first for risk:** "Are you sure you want to delete SO-0012? This cannot be
  undone." State side effects: "Any assignments referencing this printer will be cleared."
- **Plain questions on the shop floor:** "How many were actually picked?"
- **Definitional on create:** "A customer is a business or person who buys your parts or
  services." (one sentence, create mode only)
- **Toggle labels state the current state + consequence:** "Materials are included" /
  "Materials are not included", with one explanatory line.
- **Warmth only at the edges:** "Looks empty here 👀", "Search across your workspace...". No
  exclamation marks, no emoji in CTAs or confirmations, no "Oops!", no marketing voice.
- **Honest:** never claim a state you haven't confirmed ("pending" must mean pending).
- **Numbers carry context:** "12 of 40", "3d late", "Expires in 12d".

## 3. Copy patterns by surface

| Surface | Pattern |
|---|---|
| List title | plural noun: "Sales Orders" |
| List create | "Add <Entity>" |
| Overlay title | "New <Entity>" / "Edit <Entity>" (one `<Trans>` per title) |
| Record card title (edit) | "<Entity>" or "<Entity> Overview" |
| Submit | "Save"; a domain verb only if the submit is a domain action ("Post", "Register") |
| Lifecycle modal | title "<Verb> <Entity>"; body "Are you sure you want to <verb> this <entity>?" + consequences |
| Delete confirm | title "Delete {name}"; body "Are you sure you want to delete {name}? This cannot be undone." |
| Validation | "<Field> is required" |
| Success toast | "Updated <noun>" / "<Noun> created" / "<Noun> deleted" |
| Error toast | "Failed to <verb> <noun>" |
| Empty (lifecycle) | "No <things> yet" |
| Empty (search) | "No <things> found" / "No results found" |
| Empty selector | "No <plural> yet" + "Add your first <noun> so you can assign it here." |
| Access | "Access Denied" (toast) |
| Unsaved | "Unsaved changes" / "Stay on this page" / "Leave this page" |
| Loading | "Loading..." / "Loading <noun>..." |
| Placeholder | "Select", "Search...", "e.g. …" |

## 4. Lingui — every string translatable, as a whole

Rule (project memory + `.claude/rules/i18n-lingui-system.md`): **all new user-facing copy is
translatable from day one** — labels, buttons, titles, headers, menu items, toasts, empty
states, aria-labels, tooltips, placeholders, descriptions.

- Components: `const { t } = useLingui()` → `t\`…\``; JSX: `<Trans>…</Trans>`; static
  descriptors (breadcrumbs, module lists, glossary): `msg\`…\`` translated at render.
- **One message per sentence/title.** Never concatenate fragments (`<Trans>Edit</Trans>{" "}
  <Trans>Customer Type</Trans>`, `${t\`Add\`} ${label}`) — word order differs by language.
- **Plurals with `<Plural>`**, not "(s)" (`modules/sales/ui/Quotes/QuoteLeadTimeModal.tsx`
  shows the right way).
- **Status labels are translated** in their wrapper (older wrappers render the raw enum).
- **Labels in constants and config objects** (period options, chart `ChartConfig` labels,
  select options, column-group names) are `msg\`…\`` descriptors rendered with
  `i18n._(descriptor)` (from `useLingui()`), or built inside the component with `t`. A plain
  string passed to `t(variable)` is never extracted. Placeholder values like "N/A" are
  translated too (or use an em dash "—").
- Menu labels in bulk menus and row menus are `<Trans>` even when the surrounding sketch
  is "just a diff" — they're user-facing.
- Interpolate values into the message: `t\`Are you sure you want to delete ${name}?\``.
- After adding strings, the locale catalogs need extraction; see the `translate` skill for
  filling `.po` files.

Known gaps you must not copy: English defaults in `ConfirmDelete`/`Confirm`, `Copy`,
`ActionMenu`; raw status enums; English server flash strings; "(s)" plurals.

## 5. Terminology and glossary

- Carbon vocabulary: a **Method** = BoM + BoP; "Change Notice" (not ECO); method types "Make to
  Order | Purchase to Order | Pull from Inventory"; "Readable ID"/"Number" for human IDs.
  Check `docs/content/src/glossary/terms.ts` before naming a concept.
- Fields whose label is domain jargon get `termId` (→ `LabelWithHelp`). New terms: `msg` term +
  one-sentence definition + docs anchor, in `docs/content/src/glossary` (ask first).
- Name by the user's mental model, not the table name (`019fcf0a46`: "Procedure" →
  "Instructions" for operators). Order choices by likely use.

## 6. Formatting numbers, money, dates

| Kind | Use |
|---|---|
| Money | `useCurrencyFormatter()` (kinds: default, `rate`, `compact`, `wholeUnits`, `currency`); per-row currency `formatMoney` from `@carbon/utils` |
| Quantity | `useQuantityFormatter` |
| Number | `useNumberFormatter` (`@react-aria/i18n`) |
| Percent | `usePercentFormatter` |
| Duration | `formatDurationMilliseconds` |
| Date / time display | `<DateTime variant="date|absolute|relative|time">` (ERP wrapper adds company TZ) |
| Date in strings | `useDateFormatter()` from `~/hooks` (not the react-aria one) |

Dates in **labels and headers** (week columns, "Due Mar 4", period names) are formatted too —
`useDateFormatter().formatDate(value, options)` with `@internationalized/date` values, never
hand-built "Mar 4" strings or month-name arrays. Business "today" comes from the company or
location timezone passed down from the loader (`datetime.today(tz)` server-side,
`getLocationTimeZone`/`getCompanyTimeZone`), not the browser's zone, whenever it decides
which week/day a value falls in.

Never `toFixed`, `toLocaleString`, `new Date(...).toLocale…`, or `Date` arithmetic in UI
(`.claude/rules/date-handling.md`, `.claude/rules/numeric-precision.md`). Always
`tabular-nums` on displayed numbers.
