# Custom fields

> Company-defined extra fields that attach to core records like customers, parts, and orders.

Carbon ships a fixed schema for every entity, but your process almost always needs one more field the base tables don't have. A machine-shop customer might carry a "PPAP level"; a part might need a "RoHS status"; a job might track an internal "line number". Custom fields let each company add its own fields to a core record without a schema change. They surface on the record's form, save alongside the built-in fields, and are queryable through the API.

A custom field is defined once, per company, and attaches to a **table** (a core entity like `customer` or `part`). Every record of that entity then shows the field on its form. Define them under **Settings → Custom Fields**.

## How a custom field is defined

Each field has a name, a data type, and the table it attaches to. The definition lives in the `customField` table (`packages/database/supabase/migrations/20240311021818_custom-fields.sql:21`), and the form validator that governs the create/edit UI is `customFieldValidator` (`apps/erp/app/modules/settings/settings.models.ts:109`).

  - **Name**: The label shown on the record's form. Unique per table, per company.
  - **Data Type**: One of the nine types below. **Once saved, the data type can't be changed** (the form disables it on edit, `apps/erp/app/modules/settings/ui/CustomFields/CustomFieldForm.tsx:116`) — delete and re-create to switch types.
  - **List Options**: Required only for the **List** type: the set of choices the dropdown offers. Enforced by the validator (`settings.models.ts:121`).
  - **Required**: When on, the field must be filled before the form saves. Boolean fields are never treated as required (`CustomFormFields.tsx:31`).
  - **Tags**: Scopes the field to records carrying a matching tag. A tagged field only appears on records that share one of its tags — leave empty to show it on every record of the table.

## Data types

There are nine data types (`DataType` enum, `apps/erp/app/modules/shared/types.ts:83`). Each one renders a specific input on the form.

| # | Type | Renders as |
|---|------|------------|
| 1 | **Boolean** | A toggle |
| 2 | **Date** | A date picker |
| 3 | **List** | A dropdown of your defined options |
| 4 | **Numeric** | A number input with steppers |
| 5 | **Text** | A single-line text input |
| 6 | **User** | An employee picker |
| 7 | **Customer** | A customer picker |
| 8 | **Supplier** | A supplier picker |
| 9 | **File** | A file reference |

The `User`, `Customer`, and `Supplier` types store a reference to another Carbon record, so a custom field can point at an existing entity rather than just holding free text. The rendering switch lives in `CustomFormFields.tsx:75`.

Because existing values are stored as-is, Carbon locks the data type after creation. If you picked Text and need Numeric, create a new field and migrate the values — there's no in-place conversion.

## Which entities support custom fields

Custom fields attach to a curated set of core entities, not every table. The catalog of eligible tables is the `customFieldTable` table, grouped by module (`20240311021818_custom-fields.sql:2`), and it's seeded across migrations starting with `20240511125727_seed_custom_fields.sql`. On the **Settings → Custom Fields** page you'll see one row per eligible entity, showing its **Table**, **Module**, and how many **Fields** you've defined (`apps/erp/app/modules/settings/ui/CustomFields/CustomFieldsTable.tsx:32`).

The eligible entities span most modules:

- **Sales** — customer, sales order, sales invoice, RFQ, and their contacts and lines.
- **Purchasing** — supplier, purchase invoice, supplier quote, and RFQ lines.
- **Items** — part, tool, material, consumable, and item costing/planning records. See `docs/reference/items` for the base fields these extend.
- **Resources** — employee job, work center, equipment, department, location.
- **Inventory** — shipment, warehouse transfer, picking list.
- **Production** — job.
- **Accounting** — account, payment term, journal.

Because the list is code-managed, an entity that isn't in `customFieldTable` can't take custom fields. If the entity you want isn't listed on the settings page, it isn't supported yet.

## How fields save on a form

Every entity form that supports custom fields drops in the shared `` component (`apps/erp/app/components/Form/CustomFormFields.tsx`), passing its own table name. The component reads the company's field definitions and renders each one below the built-in fields.

The values don't get their own columns. They serialize into a single `customFields` JSONB column on the record — the same extensibility column every core table carries. On submit, the route action calls `setCustomFields(formData)` (`apps/erp/app/utils/form.ts`), which collects the custom inputs (each named with a `custom-` prefix) and writes them into that JSONB blob. `getCustomFields` reverses it to repopulate the form on edit.

A required custom field is enforced by an additional validator the form registers at runtime (`CustomFormFields.tsx:44`), separate from the entity's own zod schema — so requiredness lives with the field definition, not the base form.

## CSV import and export

Custom fields **do not participate in CSV import or export**. The `import-csv` edge function maps CSV columns to the entity's built-in fields only; it has no path for the `customFields` JSONB (`packages/database/supabase/functions/import-csv/index.ts`). Likewise, the table download does not emit custom-field columns. Import and export cover the base schema — populate custom fields on the record's form, or through the API. See `docs/reference/import-export` for what the CSV flow does cover.

## API access

The `customFields` JSONB column is exposed on the API. Because it's a real column on each core table, PostgREST surfaces it as a readable and filterable field on the entity's endpoint — the swagger schema references `rowFilter.<table>.customFields` for the tables that carry it (`packages/database/src/swagger-docs-schema.ts`). Reading a record returns the whole `customFields` object; the keys inside are the field IDs, not the display names, so pair an API read with the field definitions from the settings catalog to map IDs back to labels.

## Troubleshooting

Where the custom-field form and the import/API paths trip people up.

### "Required" (on a custom field that won't submit)
A required custom field is empty. Requiredness isn't in the entity's own schema — it's enforced by a runtime validator the form registers per table (`CustomFormFields.tsx:44`). Fill the field, or clear its **Required** flag in **Settings → Custom Fields**. Note **Boolean** fields are never treated as required, even with the flag on (`CustomFormFields.tsx:31`) — a Boolean that "must be filled" will never block a save.

### List custom field rejected on save
A **List**-type field saved with no options, an empty option, or no listOptions at all fails the validator's refine (`settings.models.ts:121-131`). Give the List at least one non-empty choice under **List Options** before saving.

### The Data Type dropdown is disabled when editing a field
Not a bug. The data type is locked once the field is saved — the form sets `isReadOnly` on the Data Type select while editing and shows "Data type cannot be changed" (`CustomFieldForm.tsx:110-116`). Existing values are stored as-is with no in-place conversion, so to switch (e.g. Text → Numeric) you delete the field and re-create it, then migrate the values.

### A custom field's values aren't in my CSV import or export
Expected. Custom fields don't participate in CSV import or export — the `import-csv` edge function maps only built-in fields and the table download omits the `customFields` JSONB. Populate custom fields on the record's form or through the API.

### The entity I want has no Custom Fields row
Only entities in the code-managed `customFieldTable` catalog support custom fields. If an entity isn't listed on **Settings → Custom Fields**, it isn't eligible yet — there's no way to add it from the UI.
