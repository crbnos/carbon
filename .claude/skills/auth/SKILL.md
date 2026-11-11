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
AGENT_BROWSER_IDLE_TIMEOUT_MS=600000 agent-browser open ${ERP_URL}/login && agent-browser wait --load networkidle && agent-browser snapshot -i
```

The first command starts the agent-browser daemon, and the daemon reads
`AGENT_BROWSER_IDLE_TIMEOUT_MS` only then: it closes Chrome and exits after 10
idle minutes instead of running until reboot. Needs agent-browser 0.27 or later.

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
for the caller. The idle timeout reaps it once nothing has used it for 10
minutes.

## Second Admin

Some flows need a second Admin — one who did not make the request (a purchase
order force delete, approved by an Admin other than the requester). The seed
adds `test+admin2@carbon.ms` ("Second Admin") to the same company, and the
bypass accepts any plus-addressed alias of `DEV_BYPASS_EMAIL`
(`isDevBypassEmail`, `@carbon/auth`). Sign in as it in step 3.

To keep both sessions at once, use two hosts: the session cookie is per host,
so `http://localhost:<port>` and `http://127.0.0.1:<port>` hold separate
sessions. A stack seeded before the second Admin existed gets it on the next
`crbn up`, or now with
`pnpm --filter @carbon/database db:seed:dev:admin -- --email test@carbon.ms`.

## MES

The MES app is a separate URL: read `MES_URL` from `.env.local` and navigate
there. The same cookies apply — no separate login.
