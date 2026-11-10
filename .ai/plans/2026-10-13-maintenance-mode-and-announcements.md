# Maintenance mode + announcement bar

## Context

Carbon has no way to take the apps offline cleanly (a deploy or database
migration just produces errors) and no way to tell signed-in users something
("maintenance at 22:00 UTC", "new release"). Nothing like either exists in the
repo today — no banner in either shell, no version check, no phone-home.

Two features, deliberately independent:

1. **Maintenance mode** — an env flag that makes every app answer 503 with a
   maintenance screen.
2. **System status + announcement** — the app fetches a remote JSON document
   (latest version, announcement, …) and shows the announcement as a bar at the
   top of the shell.

Decisions already made with the user:

- Remote payload is hosted by us elsewhere; this work builds only the consumer and the contract.
- No phone-home by default: the fetch happens only when the URL variable is set. Cloud sets it; self-hosters may opt in.
- Maintenance blocks everything except `/health` (API, MCP, webhooks, Inngest all get 503 so providers retry).
- Dismissal is per browser (localStorage), keyed by announcement id and user.

On execution, copy this plan to `.ai/plans/2026-10-13-maintenance-mode-and-announcements.md` (repo convention).

## Part 1 — Maintenance mode

**Env:** `MAINTENANCE_MODE` (boolean, server-only, default false). Same shape as
the existing `CONTROLLED_ENVIRONMENT = parseBoolean(getEnv(...), false)` in
`packages/env/src/index.ts:116`. Server-only keeps it out of `getBrowserEnv()`
and the four root-loader `env` objects.

**Gate:** new `packages/auth/src/middleware/maintenance.server.ts`, next to
`security.server.ts`, exporting `maintenanceMiddleware`:

- flag off → `next()`
- `/health` → `Response.json({ status: "maintenance" })` with 200, without probing the database. The ALB and the Swarm healthcheck need a 2xx; the normal health route returns 503 when the database is down, which would make ECS kill tasks in a loop during a migration.
- anything else → `throw data({ message: "maintenance" }, { status: 503, headers: { "Retry-After": "300" } })`

Throwing (not returning) gives three behaviours from one line: a document
request renders the root `ErrorBoundary`, a client navigation (`.data`) surfaces
the same boundary in an already-open tab, and a resource route (`api+`,
webhooks, Inngest) returns the bare 503.

**Wire it** after `security` in each root `middleware` (so the CSP nonce and
security headers still apply): `apps/erp/app/root.tsx:75`,
`apps/mes/app/root.tsx:74`, `apps/academy/app/root.tsx:50`,
`apps/starter/app/root.tsx`.

**Screen:** add a 503 case to `resolveConfig` in
`packages/react/src/ErrorBoundary/RootErrorBoundary.tsx` (it already maps 404 /
other / 500 to `ErrorScreen` props): "Carbon is down for maintenance", a single
`retry` action, no "return home". Reuses the existing design; assets are served
ahead of the React Router catch-all (`packages/serve/src/index.ts:166`, Vercel
CDN), so the page styles load.

**Logging:** `handleError` in `apps/{erp,mes}/app/entry.server.tsx` logs every
5xx; return early when `MAINTENANCE_MODE` is on so a maintenance window does not
log an error per request.

**First execution step is a spike:** confirm a Response thrown from root
middleware renders the root ErrorBoundary with status 503 for documents and
`.data` requests. If React Router does not do that, fall back to *returning* a
small self-contained HTML 503 for `Accept: text/html` and JSON otherwise — same
file, nothing else in the plan changes.

**Operational note:** an env change only takes effect on restart — a redeploy on
Vercel, a service update on ECS, a `docker service update` on self-host. That is
minutes, not instant.

## Part 2 — System status and announcement bar

**Env:** `SYSTEM_STATUS_URL` (string, server-only, optional). Unset → no fetch,
endpoint returns `null`, no bar. No URL is hardcoded for Cloud, because the host
does not exist yet; Cloud sets the variable in its deployment env.

**Contract** (the remote must return this; zod schema in a client-safe file):

```ts
{
  latestVersion?: string,
  announcement?: {
    id: string,                               // changes → bar reappears for everyone
    message: string,                          // plain text, rendered as text
    severity?: "info" | "warning" | "critical", // default "info"
    href?: string,                            // http(s) only
    linkLabel?: string,
    dismissible?: boolean                     // default true
  } | null
}
```

`latestVersion` is parsed and returned but drives no UI: Carbon has no app
version to compare it against (no `version` field anywhere, only commit SHAs).

**Server:** `packages/lib/src/system-status.server.ts` → `getSystemStatus()`
(`@carbon/lib` already depends on `@carbon/kv` and both apps import it):

- no URL → `null`
- Redis `system-status`, TTL 300 s — same get/parse/`set EX` pattern as `getCachedChangelogPanelEntry` (`apps/erp/app/modules/account/account.server.ts:12`)
- `fetch(url, { signal: AbortSignal.timeout(3000) })`, `safeParse`; any failure logs a warning, caches `null` for 60 s and returns `null`. A dead remote must never slow or break the app.

**Endpoint:** `apps/erp/app/routes/api+/system-status.ts` and the same file in
`apps/mes`: require a session, return `getSystemStatus()`, export
`clientLoader = cachedClientLoader<typeof loader>({ staleTime: 5 min })`. Add
`path.to.api.systemStatus` to each app's `path.ts`.

**UI:**

- `packages/react/src/AnnouncementBar.tsx` — presentational (`announcement`, `onDismiss`), severity mapped to the existing `Alert` variants (`info` / `warning` / `destructive`), `IconButton` with `aria-label` for dismiss, link opens in a new tab. Exported from the barrel (an added export; `packages/react/AGENTS.md` lists barrel changes as ask-first — covered by approving this plan).
- Per app, a small `useAnnouncement()` hook: `useLoaderQuery(path.to.api.systemStatus)` + `useLocalStorage` (`packages/react/src/hooks/useLocalStorage.ts`) under `announcement-dismissed:<userId>` holding the dismissed id.
- Placement (changed during the build): the bar sits inside each shell's content card — under the Topbar / mobile app bar in the ERP, above the page in MES — not above the whole shell. The nav rail and ~118 ERP pages size themselves from `100dvh`; while shown the bar sets `--announcement-height` on `<html>`, the ERP's `--content-inset` includes it, and the four MES viewport-sized pages subtract it.

## Env registration (both variables)

Traced from `CARBON_EDITION`; server-only variables skip the browser sites.

- `packages/env/src/schema.ts`, `packages/env/src/index.ts`
- `.env.example`, `contrib/deploying/simple-docker-caddy/{.env.example,docker-compose.prod.yml}` (ERP + MES)
- `sst.config.ts` (ERP ~:58, MES ~:171). `ci/src/deploy.ts` is not changed: its values come from `workspaces` columns, and neither variable has one
- Docs: `.claude/rules/environment-configuration.md`, `.claude/rules/sst-deployment-infrastructure.md` (also fix its stale claim that ERP's health route is under `_public+/`), `packages/env/AGENTS.md`, `packages/react/AGENTS.md` (503 case + `AnnouncementBar`)

## Left out on purpose

- Announcement scheduling (`startsAt`/`endsAt`), per-company targeting, rich text — the host decides what it serves; add fields when there is a need.
- "Update available" UI — needs an app version first.
- Staff bypass during maintenance, custom maintenance message env.
- Announcements on login / public share pages — shell only.
- Driving maintenance from the remote payload (would make it instant with no redeploy, but adds a Redis read to every request). Worth revisiting if redeploy latency hurts.

## Verification

1. Tests: one for `maintenanceMiddleware` (off → passes through; on → `/health` 200, other path throws 503 with `Retry-After`), one for the schema + `getSystemStatus` (bad JSON / timeout → `null`; `javascript:` href rejected).
2. `pnpm --filter @carbon/checks license-headers` for new files; `pnpm run lint`; typecheck one package at a time with `--concurrency=1`: `@carbon/env`, `@carbon/auth`, `@carbon/lib`, `@carbon/react`, `erp`, `mes`.
3. Maintenance, against the running dev stack with `MAINTENANCE_MODE=true`: `command curl -i` on `/` (503 HTML + `Retry-After`), `/api/v1/...` and `/api/inngest` (503), `/health` (200); in the browser, the maintenance screen on a fresh load and on a client navigation from an already-open tab; then flag off → app normal.
4. Announcement: serve a JSON file locally, set `SYSTEM_STATUS_URL`, check the bar in ERP and MES at each severity, dismiss → gone after reload, change `id` → back, `dismissible: false` → no close button; stop the JSON server → no bar, no errors, page load not slowed. Screenshot desktop + phone widths with the bar on and off to confirm nothing in the shell clips or double-scrolls.

## Status (2026-10-13)

- [x] Maintenance mode: built; tests, typecheck and a live ERP dev server with the flag on (503 page, 503 `.data`, 503 API with `Retry-After`, 200 `/health`)
- [x] System status fetch, endpoint, bar: built; tests and typecheck
- [ ] Announcement bar in the browser, ERP and MES, desktop and phone — needs the dev stack and a `SYSTEM_STATUS_URL`
- [ ] `Retry-After` is on resource-route 503s only; React Router drops the thrown headers on the document and `.data` responses
