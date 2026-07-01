---
name: login
description: Log into the local Carbon ERP dev server using agent-browser and DEV_BYPASS_EMAIL. Use before any browser automation that requires an authenticated session.
---

# Login

Authenticate against the local Carbon ERP dev environment using the `DEV_BYPASS_EMAIL` bypass. This skill is a building block — other skills (e.g. `/smoke-test`) invoke it before doing authenticated work.

## Prerequisites

- Dev server running (`pnpm dev` or `crbn up`)
- `DEV_BYPASS_EMAIL=test@carbon.ms` set in `.env.local` (added automatically by `crbn up`)
- The `test@carbon.ms` user seeded in the database (done automatically by `crbn up`)

## Procedure

### 1. Resolve the ERP URL

Read `.env.local` in the project root and extract the `ERP_URL` value. This varies per worktree.

### 2. Open the login page

```bash
agent-browser open ${ERP_URL}/login && agent-browser wait --load networkidle && agent-browser snapshot -i
```

### 3. Fill the email and submit

Find the email input and the sign-in button from the snapshot refs:

```bash
agent-browser fill @eN "test@carbon.ms"
agent-browser click @eN && agent-browser wait --load networkidle
```

### 4. Verify login succeeded

```bash
agent-browser snapshot -i
```

Confirm the page:
- Redirected to `/x` (the authenticated dashboard)
- Shows a greeting like "Good afternoon, Test" or "Good morning, Test"
- Displays module cards (Accounting, Sales, Inventory, etc.)

If the snapshot instead shows "Authentication Error" or remains on `/login`, login **failed** — stop and report the error.

## Output

After successful login the browser session is authenticated. Subsequent `agent-browser` commands in the same session will carry the auth cookies. Do **not** call `agent-browser close` — leave the session open for the caller.

## Navigating to the MES

The MES app is at a separate URL. Read `MES_URL` from `.env.local` to navigate there. The same auth cookies apply — no separate login is needed.
