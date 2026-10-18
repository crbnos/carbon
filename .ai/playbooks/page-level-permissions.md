# Page-level permissions (levels, overrides, API keys)

Last tested: 2026-10-18 (grid rebuilt to the mockup the same day)
Routes: /x/users/employee-types, /x/users/employees/<userId>, /x/settings/api-keys

## Prerequisites
- A running `crbn up` stack, logged in with the `auth` skill (the dev user is on the Admin type).
- The dev company has only the dev user. Every test below changes that user, so record its
  `employee.employeeTypeId` first and restore it at the end.

## Steps
### 1. Role grid (employee type)
- Open /x/users/employee-types/new. Each module is a collapsible row: a button with
  `aria-expanded` (the chevron and name), an "N/M pages" badge and a checkbox labelled
  "Full access to <Module>". Expanding shows page rows; until the registry has pages, one
  row named after the module.
- Each page row has four checkboxes labelled "<Page>: View|Create|Update|Delete". They are a
  ladder: clicking "Inventory: Update" sets Edit (View, Create, Update ticked); clicking a
  ticked box sets the level below it.
- Checkboxes exist only while their module is expanded: click the row's `aria-expanded`
  button first. On the person tab the first `aria-expanded` element is the Employee Type
  select, so pick rows by name, not index.
- The hidden `input[name=data]` holds the grants JSON; check it before submitting.
- requestSubmit the form that contains `input[name=data]` (NOT a click on Save).
- Verify: redirect to /x/users/employee-types; `permission` rows with the type's
  `employeeTypeId`; reopening the type shows the levels; the log has `auth.role_access_changed`.
- "Who has access" (bottom of the edit dialog) lists holders for a module and "X or more".

### 2. Person Access tab (override, role reach)
- Open /x/users/employees/<userId>. The first combobox is the Employee Type select. Rows
  without an override show the role's level faded; an override shows solid boxes and a
  "Role default" button that removes it.
- Change the type and/or override a row, then requestSubmit the form with `input[name=data]`.
- Check access from the page: `fetch(path, { redirect: "manual" })` — an `opaqueredirect`
  means Access Denied, 200 means allowed.
- To test that a role edit reaches the person, give the test type Users Edit so the editors stay
  reachable, put the user on it, then change only the type's level.

### 3. API key grid
- Open /x/settings/api-keys/new. 13 module rows (no Printing, Workflows). "Select all" gives
  Full everywhere except Accounting at Edit (Accounting's Delete box stays unticked).
- After saving, a second dialog shows the key once; close it with Escape without reading it.
- To call the API, insert a separate test key in SQL (sha256 hex of a generated `crbn_…`
  value in `apiKey.keyHash`, plus a `permission` row with `apiKeyId`) and call
  `POST http://127.0.0.1:<PORT_ERP>/api/v1/<module>/<fn>` with the `carbon-key` header.
  Inventory View: `inventory/getReceipts` 200, `inventory/createReceipt` 403 (body
  `{}` parses; the gate runs after input parsing), `sales/getCustomers` 403.

### 4. Restore
- Set the user's type back (UI or SQL), delete their `permission` rows, and if done in SQL
  clear the claims cache: `docker exec carbon-redis redis-cli -n 12 del permissions:<hash>:<userId>`.
- Delete test types through /x/users/employee-types/delete/<id> (requestSubmit the Delete form)
  and test keys with `DELETE FROM "apiKey"` (grants cascade).

## Selector Notes
- Click checkboxes by `aria-label` through `eval`; refs change after every click.
- The Access tab needs ~7 s after `open` before the type select is clickable.

## Common Failures
- Two "New API Key" dialogs: `ApiKeysTable` rendered its own `<Outlet />` beside the route's
  `<RecordOutlet />` (fixed 2026-10-18).
- Demoting the dev user removes Users access: revert by SQL, then clear the Redis claims key.
