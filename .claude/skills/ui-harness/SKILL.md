---
name: ui-harness
description: Screenshot MES or ERP UI changes without a backend. Use when a change touches the rail, headers, menus or other shell UI and you need screenshots (PR drafts, long-name and dark-mode checks) fast, and the change does not depend on real data. Not for loaders, auth, or anything that needs the database.
---

# UI harness

`apps/mes/harness` and `apps/erp/harness` render the app's real components in a
small Vite page with stubbed data. No Supabase, no Docker, no login. Use it for
layout, truncation, dark mode and menu behavior. Do not use it to prove loaders,
auth or data flows: those need the full stack (`pnpm dev`).

## Take the standard screenshots

```bash
node scripts/harness-shot.mjs --app mes     # or --app erp
```

About 20 seconds. It starts the harness if it is not running, writes PNGs to
`.harness-shots/<app>/` (gitignored) and stops it. Pass `--out <dir>` to write
elsewhere. The set: expanded, menu open, collapsed, long names, dark mode.

One custom shot:

```bash
node scripts/harness-shot.mjs --app mes --url 'open=1&long=1&dark=1' --name my-shot --click --width 640
```

`--click` opens the company/location menu first.

## Harness query parameters

`open=1` expanded rail (default collapsed) · `long=1` very long company and
location names · `multi=0` one company · `dark=1` dark mode · `loc=N` current
location index (MES only).

## Interactive

```bash
pnpm --filter mes harness     # http://localhost:3999
pnpm --filter erp harness     # http://localhost:3998
```

## Adding a scene

Edit `apps/<app>/harness/main.tsx`: render the component inside the existing
providers and add stub data. If it throws `useX must be used within…`, add the
provider or route data it names. The ones already there: OS, viewport, locale,
query client, Carbon, and a route at `/x` carrying `company` and `user`.
Add screenshots to `SETS` in `scripts/harness-shot.mjs`.

## Needs

`playwright` resolvable from Node, with Chromium. Cloud sessions have it.
Locally: `npm i -g playwright && npx playwright install chromium`.

## Gotchas already solved (don't rediscover)

- The app injects its theme as CSS variables at runtime; the harness does too (`themeByName`). Without them popovers are transparent.
- Tailwind scans from the harness root, so `harness.css` adds `@source` lines for `app/` and `packages/react`. Without them, classes used only in `app/` are missing.
- `window.env` is stubbed in `index.html`; the Supabase client throws at import without it.
- A stale Vite server holding the port serves old files. `pkill -f vite.js` before debugging a blank page.
