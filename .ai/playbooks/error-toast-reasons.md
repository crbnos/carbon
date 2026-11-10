# Error toast reasons

Last tested: 2026-10-29
Route: /x/purchasing/supplier-types, /x/sales/customer-types, /x/part/new, /x/customer/new

Checks that an error toast says why it failed: a title, and the reason as a
second line.

## Prerequisites
- A seeded company (`pnpm db:seed:dev -- --email test@carbon.ms --dataset satellite`)
- `psql` on the stack's `PORT_DB` (`.env.local`), password `postgres`, for the
  cases that change the database behind the page

## Reading a toast
Run in the page right after the submit, before the toast closes:
`JSON.stringify([...document.querySelectorAll('[data-sonner-toast]')].map(t=>({type:t.getAttribute('data-type'),title:t.querySelector('[data-title]')?.textContent,description:t.querySelector('[data-description]')?.textContent})))`

Also take a screenshot: text can be in the page but invisible (a white second
line on the white toast was caught that way).

## Steps
### 1. Duplicate name
`/x/purchasing/supplier-types/new`, field "Supplier Type" = an existing name
("Electronics"). requestSubmit the form whose button reads "Save" (the text
includes the keycap: match with `startsWith("Save")`).
Expect: "Failed to insert supplier type" / "A record with these values already exists."
Row count unchanged.

### 2. Record gone after the dialog opened
Insert a supplier type with psql, open `/x/purchasing/supplier-types/delete/<id>`,
delete the row with psql, then requestSubmit "Delete".
Expect: "Failed to delete supplier type" / "You don't have permission to change
this record, or it no longer exists."

### 3. A database rule's own text
Create a BEFORE UPDATE trigger on `customerType` that raises an exception with a
sentence, edit a customer type at `/x/sales/customer-types/<id>`, Save, then drop
the trigger and its function.
Expect: "Failed to update customer type" / the trigger's sentence.

### 4. Duplicate part number
`/x/part/new`, "Part ID" = an existing part's readableId, "Short Description"
filled, Save.
Expect: "Failed to insert part" / "A record with these values already exists."

### 5. Duplicate customer
`/x/customer/new`, "Name" = an existing customer's name, Save.
Expect: "Failed to insert customer" / "A record with these values already exists."

## Selector Notes
- Submit buttons read "Save" + keycap text ("Savemod+enter"); match by prefix.
- Editing an open form for a record deleted underneath shows the page reload's
  "Failed to get supplier type" instead of the save's error: the flash cookie
  holds one message and the loader's redirect writes last. Use the delete dialog.

## Common Failures
- A unit of measure in use cannot be deleted from the page: the dialog explains
  why and disables Delete, so no toast appears.
- Duplicate messages never name the field: Postgres leaves the key detail out
  for tables with row-level security.
