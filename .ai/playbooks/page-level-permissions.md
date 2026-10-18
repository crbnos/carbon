# Page-level permissions (levels, overrides, API keys)

Last tested: 2026-10-18 (grid rebuilt to the mockup the same day)
Routes: /x/users/employee-types, /x/users/employees/<userId>, /x/settings/api-keys

## Prerequisites
- A running `crbn up` stack, logged in with the `auth` skill (the dev user is on the Admin type).
- The dev company has only the dev user. Every test below changes that user, so record its
  `employee.employeeTypeId` first and restore it at the end.

## Steps
### 1. Role grid (employee type)
- Open /x/users/employee-types/new. Each module row is a `radiogroup` (labelled with the module)
  of four `radio` steps labelled "<Module>: View|Create|Update|Delete" (`aria-checked` = the
  level). Clicking a step sets that level; clicking the highest filled step steps down one
  ("Inventory: Update" → Edit). Arrow keys move the level from the focused step.
- On a type, key or bulk edit, the column headings are buttons that set every module to
  that level (again: clear).
- A module with pages has an `aria-expanded` button; its page rows have their own steps.
- The hidden `input[name=data]` holds the grants JSON; check it before submitting.
- requestSubmit the form that contains `input[name=data]` (NOT a click on Save).
- Verify: redirect to /x/users/employee-types; `permission` rows with the type's
  `employeeTypeId`; reopening the type shows the levels; the log has `auth.role_access_changed`.
- "Who has access" (bottom of the edit dialog) lists holders for a module and "X or more".

### 2. Person Access tab (override, role reach)
- Open /x/users/employees/<userId>. The first combobox is the Employee Type select. Rows
  without an override show the type's level lighter, with the type's name under From; an
  override is solid, says Override and has a "Role default" button. An Admin sees a notice
  and no grid, so switch the select to another type to see the grid.
- Change the type and/or override a row, then requestSubmit the form with `input[name=data]`.
- Check access from the page: `fetch(path, { redirect: "manual" })` — an `opaqueredirect`
  means Access Denied, 200 means allowed.
- To test that a role edit reaches the person, give the test type Users Edit so the editors stay
  reachable, put the user on it, then change only the type's level.

### 3. API key grid
- Open /x/settings/api-keys/new. 13 module rows (no Printing, Workflows). "Select all" gives
  Full everywhere except Accounting at Edit (Accounting's Delete step stays empty).
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
- Click steps by `aria-label` through `eval`; refs change after every click.
- The Access tab needs ~7 s after `open` before the type select is clickable.

## Common Failures
- Two "New API Key" dialogs: `ApiKeysTable` rendered its own `<Outlet />` beside the route's
  `<RecordOutlet />` (fixed 2026-10-18).
- Demoting the dev user removes Users access: revert by SQL, then clear the Redis claims key.
