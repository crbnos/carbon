---
name: auth
description: Log into the local Carbon ERP dev server with agent-browser using the DEV_BYPASS_EMAIL bypass. Use before any browser automation that needs an authenticated session (/test, /smoke-test, manual verification). Requires a running dev stack (crbn up). Building block — it leaves the session open for the caller.
---

# auth — authenticate the local browser session

Authenticate against the local Carbon dev environment via `DEV_BYPASS_EMAIL`.
Other skills (`/test`, `/smoke-test`) invoke this before authenticated work.

## Prerequisites

- Dev server running (`crbn up`; plain `pnpm dev` also works)
- `DEV_BYPASS_EMAIL=test@carbon.ms` in `.env.local` and the `test@carbon.ms`
  user seeded — both are done automatically by `crbn up`

## Steps

### 1. Resolve the ERP URL

```bash
grep '^ERP_URL' .env.local
```

The value varies per worktree — always read it; never assume a URL or port.

### 2. Open the login page

```bash
agent-browser open ${ERP_URL}/login && agent-browser wait --load networkidle && agent-browser snapshot -i
```

(If `wait --load networkidle` times out — dev HMR keeps sockets open — use
`sleep 3` then `agent-browser snapshot -i` instead.)

### 3. Fill the email and submit

From the snapshot, find the email input ref and the sign-in button ref:

```bash
agent-browser fill @eN "test@carbon.ms"
agent-browser click @eM && agent-browser wait --load networkidle
```

### 4. Verify — do not assume

```bash
agent-browser snapshot -i
```

Login **succeeded** only if the page:
- redirected to `/x` (the authenticated dashboard), and
- shows a greeting ("Good morning, Test" / "Good afternoon, Test") and module cards.

If the snapshot shows "Authentication Error" or is still on `/login` → login
**failed**. STOP and report the snapshot content; do not retry blindly.

## Output

The browser session is authenticated; subsequent `agent-browser` commands carry
the auth cookies. **Do not run `agent-browser close`** — leave the session open
for the caller.

## MES

The MES app is a separate URL: read `MES_URL` from `.env.local` and navigate
there. The same cookies apply — no separate login.
