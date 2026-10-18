# Page-level permissions (levels, overrides, API keys)

Last tested: 2026-10-18
Routes: /x/users/employee-types, /x/users/employees/<userId>, /x/settings/api-keys

## Prerequisites
- A running `crbn up` stack, logged in with the `auth` skill (the dev user is on the Admin type).
- The dev company has only the dev user. Every test below changes that user, so record its
  `employee.employeeTypeId` first and restore it at the end.

## Steps
### 1. Role grid (employee type)
- Open /x/users/employee-types/new. The form has a textbox (Name) and 15 level comboboxes in
  registry order: Accounting, Documents, Inventory, Invoicing, Items, People, Printing,
  Production, Purchasing, Quality, Resources, Sales, Settings, Users, Workflows.
- Fill the name, then per row: click the Nth combobox, snapshot, click the option ("View", "Edit", …).
- The hidden `input[name=data]` holds the grants JSON; check it before submitting.
- requestSubmit the form that contains `input[name=data]` (NOT a click on Save).
- Verify: redirect to /x/users/employee-types; `permission` rows with the type's
  `employeeTypeId`; reopening the type shows the levels; the log has `auth.role_access_changed`.
- "Who has access" (bottom of the edit dialog) lists holders for a module and "X or more".

### 2. Person Access tab (override, role reach)
- Open /x/users/employees/<userId>. The first combobox is the Employee Type select; the grid
  comboboxes follow (row N = combobox N+1). An empty row reads "Role default (<level>)".
- Change the type and/or set an override, then requestSubmit the form with `input[name=data]`.
- Check access from the page: `fetch(path, { redirect: "manual" })` — an `opaqueredirect`
  means Access Denied, 200 means allowed.
- To test that a role edit reaches the person, give the test type Users Edit so the editors stay
  reachable, put the user on it, then change only the type's level.

### 3. API key grid
- Open /x/settings/api-keys/new. 13 module rows (no Printing, Workflows). "Select all" gives
  Full everywhere except Accounting at Edit.
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
- Refs change after every option click; re-snapshot before each pick.
- The Access tab needs ~7 s after `open` before the type select is clickable.

## Common Failures
- Two "New API Key" dialogs: `ApiKeysTable` rendered its own `<Outlet />` beside the route's
  `<RecordOutlet />` (fixed 2026-10-18).
- Demoting the dev user removes Users access: revert by SQL, then clear the Redis claims key.
