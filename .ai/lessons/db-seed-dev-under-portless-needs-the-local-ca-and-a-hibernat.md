---
paths: []
triggers: []
promoted: null
---
# `db:seed:dev` under portless needs the local CA, and a hibernated stack

**Context:** Seeding `motor-line` for the serial traveler (2026-11-12) on a portless stack (`https://api.<prefix>.dev`).

**Problem:** `pnpm db:seed:dev` failed with "Failed to create user: fetch failed". Two causes stacked: the stack had hibernated (gotrue and the API gateway were exited, `crbn status` shows "hibernated"), and Node's `fetch` refused the portless certificate (`SELF_SIGNED_CERT_IN_CHAIN`). `curl` worked, because it trusts the system store; Node does not. The dev servers get `NODE_EXTRA_CA_CERTS` from `packages/dev/src/services/apps.ts`, but a script run from a shell does not.

**Rule:** Before a script that calls the local Supabase API over portless, wake the stack (one request to the ERP URL), then run it with `NODE_EXTRA_CA_CERTS=$HOME/.portless/ca.pem`.

**Applies to:** `pnpm db:seed:dev`, and any `tsx` script that calls `SUPABASE_URL` on a portless stack.
