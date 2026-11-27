# Tables and lists lessons

List tables, paging and infinite scroll, columns, CSV export and import.

## A server export mapping cannot add a column the browser omitted

```scope
id: a-server-export-mapping-cannot-add-a-column-the-browser-omit
paths: ["apps/erp/app/components/Table/utils.ts"]
triggers: ["buildColumnMaps","exportValue"]
```

**Context:** Verifying sales-invoice customer names in the CSV (TCK-60).
**Problem:** The registry resolved both names, but the table's Customer columns had only `id` and `cell`. `buildColumnMaps` excluded them, so the export request never asked for either name.
**Rule:** Check the actual request's column list and the generated file; a registry mapping alone does not prove the column exports. The rest is in `.claude/rules/table-csv-export.md`.
**Applies to:** ERP Table display columns, `buildColumnMaps`, and list-registry `exportValues`.

## Aging CSV exports must follow open documents

```scope
id: aging-csv-exports-must-follow-open-documents
paths: ["apps/erp/app/routes/x+/reports+/aging.server.ts","apps/erp/app/routes/x+/reports+/a?-aging*"]
triggers: ["getArOpenByCustomer","getApOpenBySupplier","agingCsv"]
```

**Context:** Exporting AR/AP aging from a summary RPC and a separate open-document RPC.

**Problem:** A counterparty with offsetting open documents can have a zero net balance and disappear from the summary RPC while its documents remain open. Looking up names and building CSV rows only from summary parties silently drops those documents.

**Rule:** Union counterparty IDs from the summary, open-document, and unapplied-payment RPCs. Export one row per open document or payment with the counterparty repeated, including parties whose net summary is zero. Resolve CSV headings from the request locale. Include any RPC migration in the tracked change before relying on regenerated types.

**Applies to:** AR/AP aging CSV routes and report helpers.

## An import wizard enum Default fills every blank cell before the server sees it

```scope
id: an-import-wizard-enum-default-fills-every-blank-cell-before
paths: ["apps/erp/app/modules/shared/imports.models.ts","apps/erp/app/modules/shared/shared.method-import-append.test.ts"]
triggers: ["fieldMappings"]
```

**Context:** The method import (#1977) was made to fill a blank BOM Unit of Measure with the material's own unit and a blank Operation Type with the process's type, as the BOM and BOP editors do.

**Problem:** `fieldMappings` in `imports.models.ts` preset `default: "EA"` and `default: "Process"`. The wizard writes an enum's Default into every blank and unmapped cell before the import runs, so the server never saw a blank and its fallbacks never ran. The server-side change and its tests looked right; only a run through the wizard showed every line still in EA.

**Rule:** When the server derives a value for a blank cell, remove that field's `default` from `fieldMappings`, and pin the absence in a test (`shared.method-import-append.test.ts` → "presets no BOM unit and no operation type"). A wizard Default and a server fallback cannot both apply.

**Applies to:** every table in `fieldMappings` (`apps/erp/app/modules/shared/imports.models.ts`) whose importer has a fallback for a blank cell.

## Inline-editable table cells commit on blur — the container must own navigation keys in the capture phase

```scope
id: inline-editable-table-cells-commit-on-blur-the-container-mus
paths: ["apps/erp/app/components/Table/Table.tsx","apps/erp/app/components/Grid/Grid.tsx","apps/erp/app/components/Editable/**"]
triggers: ["useMovingCellRef","onKeyDownCapture","setSelectedCell"]
```

**Context:** Inventory count table (PR #1135 follow-up): typed Counted Qty values were lost on Tab/Enter (only click-away saved), Enter never navigated, arrows stepped the number instead of moving the selection, and keyboard nav went dead after a commit.

**Problem:** Editable cells (`~/components/Editable/*`) persist via the input's native `onBlur`, but three things prevent that blur from ever firing on keyboard navigation: (1) the Table's key handler `preventDefault()`s Tab/Enter, so the browser never moves focus; (2) React unmounts the still-focused input when the selection moves, and browsers fire no blur on a removed element; (3) react-aria's NumberField swallows Enter entirely (`onKeyDownEnter` commits internally without `continuePropagation()`) and consumes ArrowUp/Down as spinbutton steps, so a bubble-phase table handler never sees those keys. Blurring at the input level without navigating drops `document.activeElement` to `body`, after which the table wrapper hears no further keys.

**Rule:** The table container owns the Excel keyboard model: attach the handler with `onKeyDownCapture` (so it beats react-aria to Enter/arrows), `stopPropagation()` for handled keys while editing, blur `document.activeElement` to commit *before* `setSelectedCell`, and let the roving-tabindex cell ref (`useMovingCellRef`) refocus the newly selected cell. Skip events targeting portaled overlays (`[data-radix-popper-content-wrapper]`, `[role=menu|listbox|dialog]`) — those own their keys. Editors must keep blur as their *single* commit path (no keydown commits — they double-fire the mutation, as `EditableText` did in Grid). Match Enter by `key`, not `code`: the number pad's Enter has `code` `NumpadEnter`, and react-aria's commit and the browser's implicit form submission both still treat it as Enter (`gridKeyCode`). `Grid` takes only Tab and Enter in the capture phase, and only while a cell is being edited (`takesKeyFromEditor`); every other key stays in the bubble phase, so a combobox list still selects on Enter before the grid moves on. Until it did, Enter in a Grid number cell inside a form submitted the form without the typed value.

**Applies to:** `apps/erp/app/components/Table/Table.tsx`, `apps/erp/app/components/Grid/Grid.tsx`, `apps/erp/app/components/Editable/*`, any future inline-editable cell editor.

## Aging summary tables keep document headers inside the expansion

```scope
id: aging-summary-tables-keep-document-headers-inside-the-expans
paths: ["apps/erp/app/modules/invoicing/ui/Workbench/ARAPWorkbench.tsx","apps/erp/app/routes/x+/reports+/ar-aging.tsx","apps/erp/app/routes/x+/reports+/ap-aging.tsx"]
triggers: ["ARAPWorkbench"]
```

**Context:** Showing AR/AP aging totals by customer or supplier with document details beneath each party.

**Problem:** Putting transaction date, type, and original amount in the shared table header leaves blank cells across every party row and makes the report look unfinished.

**Rule:** On aging report pages, show only party-level fields in the outer table. Render open documents and unapplied payments in an expanded table with its own column headers. Keep the receivables/payables workbench layout unchanged unless that page is explicitly in scope.

**Applies to:** `ARAPWorkbench` on the AR/AP aging report routes.

## Localized CSV exports must translate row values as well as headings

```scope
id: localized-csv-exports-must-translate-row-values-as-well-as-h
paths: ["apps/erp/app/routes/x+/reports+/*csv.tsx","apps/erp/app/routes/x+/reports+/aging.server.ts"]
triggers: ["agingCsvResponse","text/csv"]
```

**Context:** The AR/AP aging CSV translated its column headings, while the document
type column still contained raw `Invoice`, `Credit Memo`, and `Debit Memo` values.

**Problem:** In a non-English locale, the downloaded report mixed translated
headings with English document types even though the on-screen workbench and
catalogs already translated those values.

**Rule:** Resolve fixed display values through the same per-request catalog used
for CSV headings, while retaining raw values for data logic and falling back to
the raw value for an unknown type. Assert the exported row values with labels
that differ from the source strings.

**Applies to:** Server-generated localized CSV reports, including AR/AP aging.

## `setGenericQueryFilters` erases a query's row type

```scope
id: setgenericqueryfilters-erases-a-query-s-row-type
paths: ["apps/erp/app/utils/query.ts"]
triggers: ["setGenericQueryFilters"]
```

**Context:** Inventory → Receiving read a view through `setGenericQueryFilters` and its route annotated the rows with a hand-written type (2026-10-26).

**Problem:** The helper's signature is typed loosely (it carries `@ts-expect-error`), so whatever it returns awaits to rows of type `any`. An annotation on those rows is an unchecked cast: renaming a column in the select string, or dropping it from the view, compiles clean and renders blank. Types in `types.ts` derived through `ReturnType<typeof getX>` are `any` the same way.

**Rule:** Keep the typed builder. Assign the helper's result back to the query variable (`query = setGenericQueryFilters(query, { filters })`), which keeps the variable's declared type, then apply the sort and `.range()` on it directly. Derive the row type from that function in `types.ts`, and narrow a view's never-null keys once at the loader boundary rather than guarding them in components.

**Applies to:** list reads in `apps/erp/app/modules/*/*.service.ts` that call `setGenericQueryFilters`, and the `types.ts` row types derived from them.

## Table cells in @carbon/react highlight on row hover by default

```scope
id: table-cells-in-carbon-react-highlight-on-row-hover-by-defaul
paths: ["packages/react/src/Table.tsx","apps/erp/app/modules/production/ui/Schedule/People/PeopleCapacity.tsx"]
triggers: ["rowSpan","group-hover:bg-muted"]
```

**Context:** The people Capacity view needed a hover-free (then row-scoped-hover) table; removing every hover class in the feature file changed nothing — cells still tinted on row hover, and a rowSpan name cell lit up whenever its first row was hovered.

**Problem:** `packages/react/src/Table.tsx` bakes the hover in at the primitive level: `Tr` carries the Tailwind `group` class and `Td`/`Th` ship `group-hover:bg-muted`. No amount of feature-level class removal turns it off, and a `rowSpan` cell belongs to its first row, so that row's hover tints it.

**Rule:** To opt a table out of (or customize) hover, override per cell with `group-hover:bg-transparent` (tailwind-merge lets the passed className win) — a local `<Td>` wrapper keeps it tidy. For a rowSpan cell that must stay static, also give it an opaque `bg-card` so sibling-row tints can't bleed through. If more tables need this, promote a `static` prop into `packages/react` instead of copying wrappers.

**Applies to:** any table built on `@carbon/react` `Tr`/`Td`/`Th`, especially with `rowSpan` cells or custom hover semantics (`PeopleCapacity.tsx` is the reference).
