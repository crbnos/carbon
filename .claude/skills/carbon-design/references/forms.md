# Forms and inputs

Read with `.claude/rules/conventions-forms.md` (mechanics: `ValidatedForm`, zod validator,
route action). This file covers the **design** of forms: containers, layout, labels, save
model, copy.

## Contents
1. Principles
2. Which container a form lives in
3. Canonical skeletons (drawer, record card, settings card)
4. Field layout
5. Labels, optional, help, placeholders, validation
6. New vs edit
7. Save model — explicit submit vs autosave
8. Disabled, read-only, locked
9. Inputs — which field component

---

## 1. Principles

- **One form component, swappable shell.** The same `XForm` renders as a card on a page, a
  drawer over a list, or a modal from a picker; the provider (`ModalDrawerProvider` /
  `ModalCardProvider`) picks the shell and `<Hidden name="type" value={type} />` tells the
  action which one submitted.
- **Rank decides the container**, not taste (§2).
- **Save is explicit on forms; autosave only on property surfaces** (§7).
- **Mark optional, never required.** No asterisks anywhere.
- **Help lives in the label via the glossary** (`termId`), not in custom tooltips.
- **Flat forms.** Sections inside a form are rare; long text and uploads go below the grid.
- **Every selector can create what's missing** in place (domain selectors open the entity form
  as a modal, pre-filled with what was typed).

## 2. Which container

| Record rank | Container | Opened by |
|---|---|---|
| Primary record (customer, supplier, part…) and document **lines** | `ModalCard` — Card on the page; Modal (`xlarge`, lines `xxlarge`) when created inline | `/new` page, Explorer "Add Line Item" |
| Lookup / config record (types, reasons, terms, work centers) | `ModalDrawer` — Drawer (`md`, `lg` if complex) via nested route; Modal (`medium`) from a picker | list `Outlet`, selector "Create …" |
| Document header sections (payment, shipping, planning) and top-level new-document forms | plain `Card` with `CardFooter` Save | detail content pane, `new.tsx` |
| Company preference group | settings `Card`, one `intent` per card | settings page |
| A lifecycle transition that needs inputs | `Modal` form (see `actions-and-overlays.md`) | header button |

## 3. Canonical skeletons

### Drawer form (config row) — exemplar `modules/sales/ui/CustomerTypes/CustomerTypeForm.tsx`, `modules/accounting/ui/PaymentTerms/PaymentTermForm.tsx`

```tsx
<ModalDrawerProvider type={type}>
  <ModalDrawer open={open} onOpenChange={(open) => { if (!open) onClose?.(); }}>
    <ModalDrawerContent>
      <ValidatedForm validator={xValidator} method="post"
        action={isEditing ? path.to.x(initialValues.id!) : path.to.newX}
        defaultValues={initialValues} fetcher={fetcher} className="flex flex-col h-full">
        <ModalDrawerHeader>
          <ModalDrawerTitle>
            {isEditing ? <Trans>Edit Payment Term</Trans> : <Trans>New Payment Term</Trans>}
          </ModalDrawerTitle>
        </ModalDrawerHeader>
        <ModalDrawerBody>
          <Hidden name="id" />
          <Hidden name="type" value={type} />
          <VStack spacing={4}>
            <Input name="name" label={t`Name`} />
            {/* … */}
            <CustomFormFields table="x" />
          </VStack>
        </ModalDrawerBody>
        <ModalDrawerFooter>
          <HStack>
            <Submit isDisabled={isDisabled}><Trans>Save</Trans></Submit>
            <Button size="md" variant="solid" onClick={() => onClose()}><Trans>Cancel</Trans></Button>
          </HStack>
        </ModalDrawerFooter>
      </ValidatedForm>
    </ModalDrawerContent>
  </ModalDrawer>
</ModalDrawerProvider>
```
In modal mode the form closes itself and toasts on success via a `useEffect` on
`fetcher.state`/`fetcher.data` (see CustomerTypeForm). Route: `onClose={() => navigate(-1)}`;
the URL is the drawer's open state. Trivial one-field drawers add `hideShortcutKey` to Submit.

### Record form (card ↔ modal) — exemplar `modules/sales/ui/Customer/CustomerForm.tsx` (mirror `modules/purchasing/ui/Supplier/SupplierForm.tsx`)

```tsx
<ModalCardProvider type={type}>
  <ModalCard onClose={onClose}>
    <ModalCardContent size="medium">
      <ValidatedForm …>
        <ModalCardHeader>
          <ModalCardTitle>{isEditing ? <Trans>Customer Overview</Trans> : <Trans>New Customer</Trans>}</ModalCardTitle>
          {!isEditing && <ModalCardDescription><Trans>A customer is a business or person who buys your parts or services.</Trans></ModalCardDescription>}
        </ModalCardHeader>
        <ModalCardBody>
          <Hidden name="id" /><Hidden name="type" value={type} />
          <div className={cn("grid w-full gap-x-8 gap-y-4",
            type === "modal" ? "grid-cols-1" : isEditing ? "grid-cols-1 lg:grid-cols-3" : "grid-cols-1 md:grid-cols-2")}>
            {/* fields … */}
            <CustomFormFields table="customer" />
          </div>
        </ModalCardBody>
        <ModalCardFooter>
          <HStack><Submit isDisabled={isDisabled}><Trans>Save</Trans></Submit></HStack>
        </ModalCardFooter>
      </ValidatedForm>
    </ModalCardContent>
  </ModalCard>
</ModalCardProvider>
```
Card forms have **no Cancel** (navigation is the cancel). Line forms: exemplar
`modules/sales/ui/SalesOrder/SalesOrderLineForm.tsx` (`xxlarge`, locked by status).

### Settings card — exemplar `routes/x+/settings+/inventory.tsx`

```tsx
<SettingsSectionHeader><Trans>Kanban</Trans></SettingsSectionHeader>
<Card>
  <ValidatedForm method="post" validator={v} defaultValues={…} fetcher={fetcher}>
    <CardHeader>
      <CardTitle><Trans>Kanban Output</Trans></CardTitle>
      <CardDescription><Trans>Style of kanban output to show in the Kanban table</Trans></CardDescription>
    </CardHeader>
    <CardContent>
      <Hidden name="intent" value="kanbanOutput" />
      <div className="flex flex-col gap-8 max-w-[400px]">{/* fields */}</div>
    </CardContent>
    <CardFooter><Submit><Trans>Save</Trans></Submit></CardFooter>
  </ValidatedForm>
</Card>
```
A single boolean setting is a toggle card that saves on change (no footer) — exemplar
`routes/x+/settings+/items.tsx`.

## 4. Field layout

1. **Drawers:** single column, `VStack spacing={4}`. A small group of related numbers may sit in
   a `grid sm:grid-cols-3 gap-4` row (WorkCenterForm rates).
2. **Cards:** `grid w-full gap-x-8 gap-y-4`; create = `grid-cols-1 md:grid-cols-2`, edit =
   `grid-cols-1 lg:grid-cols-3`, modal = `grid-cols-1`.
3. **Order:** identity (ID, name) → classification (type, status) → relationships (customer,
   item, employee) → quantities / money → dates → location → `<CustomFormFields table=…/>`
   last in the grid. Long text (`TextArea`) and uploads **below** the grid, full width.
4. **Hidden fields first** in the body (`id`, `type`, FK context).
5. **Sections** (`Subheading variant="heavy"` between groups) only for genuinely long forms
   (WorkCenterForm: Basic Information / Costing / Scheduling). Prefer flat.
6. **Custom fields** — include `<CustomFormFields table="…"/>` on any entity that supports them.
7. **Boolean** in a form: `Boolean` (Switch). With `bordered` + `description` it becomes a toggle
   card: label + description left, switch right.
8. No field is wider than it needs to be in settings (`max-w-[400px]`).

## 5. Labels, optional, help, placeholders, validation

| Element | Rule | Example |
|---|---|---|
| Label | Title Case, translated `label={t\`…\`}`, rendered `text-xs font-medium text-muted-foreground` | "Customer Status", "Unit of Measure" |
| Optional | automatic "Optional" tag inferred from the zod schema; override with `isOptional` | — |
| Required marker | **none** — no asterisks | — |
| Help (domain term) | `termId="<entity>-<field>"` → `LabelWithHelp` info + HoverCard + "Learn more" | `termId="customer-status"` |
| Help (constraint/consequence) | `helperText` sentence under the field | "Customer ID cannot be changed after creation" |
| Placeholder | rare; "Select" for selectors, `e.g. …` for free text | `e.g. Acme Manufacturing` |
| Validation message | from zod: **"<Field> is required"**, sentence case | "Name is required" |
| Field error | below field, `text-destructive text-xs`; input `border-destructive`; first invalid field focused | automatic |
| Server failure | toast/flash "Failed to <verb> <noun>" — not inline | "Failed to create customer type" |
| Description on create | one definitional sentence "A <entity> is …" in the header, create mode only | CustomerForm |

New glossary terms: add to `docs/content/src/glossary` (`msg` term + one-sentence definition + docs
anchor) — ask first per `docs/content/AGENTS.md`.

## 6. New vs edit

| Aspect | New | Edit |
|---|---|---|
| Title | "New X" | "Edit X" (drawers) / "X" or "X Overview" (cards) — one `<Trans>` per title |
| Description | definitional sentence | usually omitted |
| ID field | `SequenceOrCustomId` | read-only `Input isReadOnly` (+ helperText) |
| Grid | 2 cols | 3 cols |
| Focus | `autoFocus={!isEditing}` on first field | none |
| Fields needing an id (contacts, jobs) | hidden | shown |
| Permission | `can("create")` | `can("update")` |
| Submit label | **Save** | **Save** |

Use a domain verb instead of "Save" only when the submit performs a domain action ("Submit
Inspection", "Register", "Post", "Dispose").

## 7. Save model

| Surface | Save model | Trigger | Feedback |
|---|---|---|---|
| Card / drawer / modal form | explicit `<Submit>` "Save" | click or ⌘↵ | page: flash via redirect; modal: toast |
| Properties panel field | autosave per field | `onChange` (select, date) / `onBlur` (text) → `fetcher.submit({ ids, field, value })` to a bulk-update route | toast on **error only** |
| Editable table/grid cell | autosave, optimistic | blur (Enter/Tab blur first) | revert + error |
| Single on/off setting | autosave | `Switch onCheckedChange` → `fetcher.submit({ intent, enabled })` | success toast |
| Multi-field setting group | explicit Save per Card | click | flash/toast |
| Canvas editors (workflow builder) | debounced autosave (~1s) | change | — |

**Rule:** autosave only when the change is a single reversible field on an existing record,
on a property/grid/toggle surface, with no cross-field validation. Anything that creates a
record, changes several fields together, or triggers a lifecycle event has an explicit button.
`Submit` guards unsaved changes by default ("Unsaved changes" / "Stay on this page" / "Leave
this page"); opt out with `withBlocker={false}` only inside tabs/modals where it misfires.

Properties panel fields still wrap each inline field in its own tiny `ValidatedForm` so field
components work; import those fields from `@carbon/form` directly (they use the `inline` mode).
Exemplar: `modules/quality/ui/Issue/IssueProperties.tsx`.

## 8. Disabled, read-only, locked

- **Read-only by nature** (IDs after creation, derived values): `isReadOnly`.
- **No permission:** `Submit isDisabled`; `isDisabled = isEditing ? !can("update", m) :
  !can("create", m)`. Menu items `disabled`, not hidden.
- **Document locked by status:** `ValidatedForm isDisabled={isEditing && isLocked}` with
  `isLocked = is{Entity}Locked(status)` from `{module}.models.ts`; server enforces with
  `requireUnlocked` (`apps/erp/app/utils/lockedGuard.server.ts`). Exit is "Reopen" in the ⋯ menu.
  No "locked" banner.

## 9. Inputs — which field component

**`~/components/Form` / `@carbon/form` fields only work inside a `ValidatedForm`** — they
call `useField`, which throws outside a form context. A control that lives outside a form
(a filter bar, a preview modal's parameters, a toolbar) uses the raw `@carbon/react` input
instead (`NumberField`, `DatePicker` with a `CalendarDate` value, `Select`, `Combobox`,
`ToggleGroup`), or the whole control group is wrapped in a `ValidatedForm` with a validator.

Inside forms import from `~/components/Form`: `Input`, `Number` (currency-aware in ERP),
`Select`, `Combobox`, `CreatableCombobox`, `MultiSelect`, `DatePicker`, `DateTimePicker`,
`Boolean`, `TextArea`, `Hidden`, `Submit`, `CustomFormFields`, `SequenceOrCustomId`, and domain
selectors (`Customer`, `Supplier`, `Item`, `Employee`, `Location`, `UnitOfMeasure`, `Currency`,
`Account`, … — check `apps/erp/app/components/Form/index.ts` before building a new one).
For a foreign key **always** use (or add) a domain selector; never a raw id input. A new domain
selector copies `apps/erp/app/components/Form/Customer.tsx` (creatable, opens the entity form as
a modal, permission-aware empty state via `useEmptyState` in
`apps/erp/app/components/Form/emptyStates.tsx`).

Selection widgets: see the Selects table in `components.md` §3.
