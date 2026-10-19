# Page-level permissions (levels, overrides, API keys)

Last tested: 2026-10-19 (the editor is a module accordion since 2026-10-19; one-page roles over single fetch)
Routes: /x/users/employee-types, /x/users/employees/<userId>, /x/settings/api-keys

## Prerequisites
- A running `crbn up` stack, logged in with the `auth` skill (the dev user is on the Admin type).
- The dev company has only the dev user. Every test below changes that user, so record its
  `employee.employeeTypeId` first and restore it at the end.

## Steps
### 1. Role grid (employee type)
- Open /x/users/employee-types/new. Each module is a row with an `aria-expanded` button, an
  "N/M pages" badge and a checkbox labelled "Select all in <Module>". Expanding it shows a
  table of its pages; each page has four checkboxes labelled "<Page>: View|Create|Update|Delete".
  Checking a box sets that level; unchecking one drops to the level below it
  ("Inventory: Create" unchecked on Edit → View).
- On a type, key or bulk edit, the column headings of an expanded module are buttons that set
  every page of that module to that level (again: clear).
- The hidden `input[name=data]` holds the grants JSON; check it before submitting.
- requestSubmit the form that contains `input[name=data]` (NOT a click on Save).
- Verify: redirect to /x/users/employee-types; `permission` rows with the type's
  `employeeTypeId`; reopening the type shows the levels; the log has `auth.role_access_changed`.
- "Who has access" (bottom of the edit dialog) lists holders for a module and "X or more".

### 2. Person Access tab (override, role reach)
- Open /x/users/employees/<userId>. The first combobox is the Employee Type select. Rows
  without an override show the type's level as lighter checkboxes, with the type's name under From; an
  override is filled, says Override and has a "Role default" button. An Admin sees a notice
  and no grid, so switch the select to another type to see the grid.
- Change the type and/or override a row, then requestSubmit the form with `input[name=data]`.
- Check access from the page: `fetch(path, { redirect: "manual" })` — an `opaqueredirect`
  means Access Denied, 200 means allowed.
- To test that a role edit reaches the person, give the test type Users Edit so the editors stay
  reachable, put the user on it, then change only the type's level.

### 3. API key grid
- Open /x/settings/api-keys/new. 13 module rows (no Printing, Workflows). "Select all" gives
  Full everywhere except Accounting at Edit (Accounting's Delete cell stays empty).
- After saving, a second dialog shows the key once; close it with Escape without reading it.
- To call the API, insert a separate test key in SQL (sha256 hex of a generated `crbn_…`
  value in `apiKey.keyHash`, plus a `permission` row with `apiKeyId`) and call
  `POST http://127.0.0.1:<PORT_ERP>/api/v1/<module>/<fn>` with the `carbon-key` header.
  Inventory View: `inventory/getReceipts` 200, `inventory/createReceipt` 403 (body
  `{}` parses; the gate runs after input parsing), `sales/getCustomers` 403.

### 4. One-page roles (every page, over HTTP)
Use this to test all 159 pages in minutes. A browser loop takes hours, and headless
Chrome crashes its page after about 80 navigations here.
1. Make one employee type per page from `PAGES`, named `Only <page id>`, with one `permission`
   row: Edit on that page (its `maxLevel` when lower). A throwaway script in `scripts/.tmp/`
   that writes the SQL and pipes it to `psql` is enough; delete the types at the end.
2. Copy the `carbon` cookie from the logged-in browser: `agent-browser cookies get --json`.
3. For each page, put the user on its role in SQL and clear the claims cache in one call:
   `redis-cli -n 12 EVAL "for _,k in ipairs(redis.call('keys', ARGV[1])) do redis.call('del', k) end" 0 'permissions:*:<userId>'`.
4. Request `<path>.data` with the cookie and `redirect: "manual"`: the page's first path, one
   record (take its path from a list as Admin), and the module's nav link, in parallel.
5. Read the result:
   - `202` with `["SingleFetchRedirect"…,"redirect","/x"` is Access Denied (the flash rides the cookie).
   - `500`, or `["SanitizedError"` / `["ErrorResponse"` in a `200` body, is a loader error or a
     failed deferred promise (an error boundary in the browser).
   - Follow a redirect to any other path once: some detail routes redirect to themselves.
6. Run the pass as Admin first. A difference from that baseline is a finding.
7. To name the gate behind a silent failure, log `forbidden()` (`packages/api/src/service-fn.server.ts`)
   and the denial branch of `requirePermissions` to a scratch file with the request URL and
   `new Error().stack`. The stack's first `routes/` frame is the loader; its line number is the
   transformed module's, so match the refused page against the `api.*` calls of that file.
   Remove the logging before you commit.
8. Use the browser only for the sidebar and nav (client-side) and for writes.

Common causes found on 2026-10-19:
- A module dashboard (`/x/sales`, `/x/purchasing`, `/x/invoicing`, `/x/production`) calls a
  function gated on one page. The loader checks `holdsGate(permissions, …)` and skips the section.
- A lookup on a table every employee reads is gated on its owner page. It gates on `"employee"`.
- A page reads a restricted table of a sibling page. The page lists the table in `readers`, the
  function gates on `{ anyOf: [owner, reader…] }`, and `authz migration` ships the rule.
- A module's nav link opens one fixed page. `useModules` opens the first page the person can view.

### 5. Restore
- Set the user's type back (UI or SQL), delete their `permission` rows, and if done in SQL
  clear the claims cache: `docker exec carbon-redis redis-cli -n 12 del permissions:<hash>:<userId>`.
- Delete test types through /x/users/employee-types/delete/<id> (requestSubmit the Delete form)
  and test keys with `DELETE FROM "apiKey"` (grants cascade).

## Selector Notes
- Click checkboxes by `aria-label` through `eval`; refs change after every click. Expand a
  module first: its page checkboxes are not in the DOM while it is closed.
- The Access tab needs ~7 s after `open` before the type select is clickable.

## Common Failures
- An SQL loop in zsh that assigns `path=` replaces `PATH`: use another variable name.
- Five quick edits to ERP files can leave the dev server answering nothing after its SSR
  "program reload" (2026-10-19). Make edits in one batch while a pass runs.
- Two "New API Key" dialogs: `ApiKeysTable` rendered its own `<Outlet />` beside the route's
  `<RecordOutlet />` (fixed 2026-10-18).
- Demoting the dev user removes Users access: revert by SQL, then clear the Redis claims key.
- Dark mode: `agent-browser set media dark`. A full-page `open` of /x/users/employee-types/<id>
  can land on the list; click the type's link from the list instead.
