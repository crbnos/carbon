---
name: smoke-test
description: Quick e2e smoke test of the local Carbon ERP dev server — logs in via /auth, then loads each core module and verifies it renders without errors. Use after booting a stack, after wide-reaching changes, or when asked to "smoke test" the app. For feature-specific testing use /test instead.
---

# smoke-test — do the core modules load?

Verify every core module renders. This is breadth, not depth — it catches
broken routes and crashed loaders, not logic bugs.

**Announce at start:** "Using the smoke-test skill — sweeping the core modules."

## Prerequisites

- Dev server running (`crbn up` — seeds the test user and `DEV_BYPASS_EMAIL`)

## Steps

### 1. Login

Invoke `/auth`. If it fails, STOP and report — everything below needs auth.

### 2. Visit each module

Read `ERP_URL` from `.env.local`. For each route below:

```bash
agent-browser open ${ERP_URL}<path> && agent-browser wait --load networkidle && agent-browser snapshot -i
```

| Module | Path |
|------------|------------------------|
| Dashboard | `/x` |
| Sales | `/x/sales/orders` |
| Purchasing | `/x/purchasing/orders` |
| Inventory | `/x/inventory` |
| Items | `/x/items/parts` |
| Accounting | `/x/accounting/charts` |
| People | `/x/people/employee` |
| Resources | `/x/resources` |
| Production | `/x/production` |
| Settings | `/x/settings/company` |

A module **passes** if the snapshot shows real content (table, cards, headings)
and no error text. It **fails** on a blank page, an error message, or a failed
load. On failure: invoke `/error` to capture diagnostics, then continue to the
next module — never abort the sweep for one failure.

### 3. Report

| Module | Status | Notes |
|--------|--------|-------|
| Login | PASS/FAIL | |
| Sales | PASS/FAIL | {error capture paths if failed} |
| …      |        | |

### 4. Cleanup

```bash
agent-browser close
```
