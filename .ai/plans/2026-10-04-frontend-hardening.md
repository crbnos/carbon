# Frontend hardening — 2026-10-04

Branch `refactor/architecture-hardening` (created as `refactor/frontend-hardening`), one commit per piece.
Out of scope (separate session): the TanStack Query caching layer (`cachedClientLoader`,
root invalidation middleware, `useLoaderQuery`/`useAction`) and the realtime list provider
rebuild that depends on it.

Verification per piece: `pnpm exec turbo run typecheck --filter=<pkg> --concurrency=1`
(one filter at a time), `pnpm exec biome check <paths>`, scoped tests where they exist.

## Pieces

- [x] 1. `framer-motion` → `motion` (imports, catalog, unused deps in starter/tiptap)
- [x] 2. Motion + UI polish in shared components
  - button press scale 0.98, page overscroll off
  - `Modal` broken exit class, `Drawer` exit animation + overlay blur
  - popovers scale from their trigger; tooltips share one provider
  - reduced motion: `MotionConfig reducedMotion="user"` + global CSS rule
  - summary-card `y: 50` entrance, `scale: 0`, `ease-in`, BoM/BoP row durations
- [x] 3. Accessibility: pinch-zoom, dialog titles, combobox ARIA state
- [x] 4. Redirects safe by default
  - `redirect` / `redirectExternal` / `safePath` in `@carbon/utils`; home-page fallback
  - codemod every `redirect` import; delete `safeRedirect`
  - `@carbon/checks` rule: no `redirect` import from `react-router`
- [x] 5. Redirect fixes: magic link, already-signed-in, dev bypass, verify, company switchers
- [x] 6. Error boundaries on the `x+` layouts so a failed loader keeps the shell
- [x] 7. Client state: client-only nanostores → zustand; jotai (tiptap) → zustand
- [x] 8. Shared ERP/MES code — first step
  - [x] `useIdle`, `Enumerable` → `@carbon/react`; apps keep re-exports
  - [x] `no-duplicated-app-file` check; the 20 remaining duplicates are baselined
  - [ ] auth routes (login, callback, mfa, unlock, refresh-session) → `@carbon/auth`
        — needs a running stack to verify each login path; not done blind
  - [ ] the 20 baselined files: each imports its app's `path`, `useUser` or stores,
        so sharing means passing those in — decide the shape before moving them
- [x] 9. Route modals close to their parent route instead of `navigate(-1)`
- [x] 10. Small leftovers: unused Radix deps, `h-dvh` in MES, lazy images, `@ts-ignore` → `@ts-expect-error`

## Added after the first pass

- [x] Stable `Card` / `ToggleGroup` context, `aria-sort`, modal overlay blur, three `transition-all`
- [x] PDF engine out of the client entry; PostHog web vitals
- [x] `downloadUrl` checks the response at the 12 file-download sites

## Verified in the browser (local, dev bypass login)

Redirect destinations, route modal close, in-shell error boundary, dialog and
drawer behaviour, overscroll and zoom, the hub nav item and home card.

## Still to check on staging

- Magic-link, OAuth, passkey, SSO and Stripe redirects
- The company switcher with a multi-company user
- Auth routes → `@carbon/auth` (not started)

## Needs its own plan (not in this branch)

- Bill of process / bill of material / make-method-tools triplication
- `Table` boolean flags → composed toolbar
- Filter components (71% overlap — reconcile before sharing)
- `root` / `entry.*` bootstrap sharing
- The 20 baselined duplicates: a per-app provider for `path` / user / stores
- Six components that sync state to their parent from an effect
