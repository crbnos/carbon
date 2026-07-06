---
name: smoke-test
description: Run an e2e smoke test against the local Carbon ERP dev server using agent-browser. Logs in via /login, then navigates through core modules to verify they load without errors.
---

# E2E Smoke Test

Run a quick end-to-end smoke test against the local Carbon ERP dev environment.

## Prerequisites

- Dev server running (`pnpm dev` or `crbn up`)
- `crbn up` seeds the smoke-test user and sets `DEV_BYPASS_EMAIL` automatically

## Procedure

### Step 1: Login

Invoke the `/login` skill to authenticate the browser session. If login fails, stop and report — all other steps depend on auth.

### Step 2: Navigate Core Modules

Read `ERP_URL` from `.env.local` in the project root.

Visit each module and verify the page loads without errors. For each module:

1. Navigate to the module URL
2. Wait for network idle
3. Take a snapshot
4. Verify the page rendered content (table, cards, or expected UI elements)
5. Check for error messages or blank pages

**Module routes to test (append to ERP_URL):**

| Module      | Path                  |
|-------------|-----------------------|
| Dashboard   | `/x`                  |
| Sales       | `/x/sales/orders`     |
| Purchasing  | `/x/purchasing/orders`|
| Inventory   | `/x/inventory`        |
| Items       | `/x/items/parts`      |
| Accounting  | `/x/accounting/charts`|
| People      | `/x/people/employee ` |
| Resources   | `/x/resources`        |
| Production  | `/x/production`       |
| Settings    | `/x/settings/company` |

For each module:
```bash
agent-browser open ${ERP_URL}/x/sales/orders && agent-browser wait --load networkidle && agent-browser snapshot -i
```

### Step 3: Report Results

After visiting all modules, report a summary table:

| Module | Status | Notes |
|--------|--------|-------|
| Login  | PASS/FAIL | ... |
| Sales  | PASS/FAIL | ... |
| ...    | ...    | ... |

A module **passes** if the snapshot shows expected content (tables, headings, cards) and no error messages. A module **fails** if the page is blank, shows an error, or fails to load.

## Failure Handling

- If a module fails, invoke the `/error` skill to capture a screenshot and snapshot, then continue to the next module.

## Cleanup

Close the browser session when done:
```bash
agent-browser close
```
