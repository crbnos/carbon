# Account settings as a shared package (`@carbon/account`)

The ERP's account settings modal (Profile, Notifications, Security) moves into a
package so the MES and the starter app open the same modal.

## Decisions (from the user)

- A new package, shaped like `@carbon/onboarding` — not `@carbon/react`, which
  cannot import `@carbon/form` (form depends on react).
- All three panes in every app.
- The MES and the starter use the ERP's loaders and actions — through the MES's
  existing `/x/proxy/*` route (extended to GET), and a matching proxy route in
  the starter. No auth API is ported.

## Shape

- `@carbon/account` → tab constants, `accountProfileValidator`, `Account`,
  the zustand store (`useAccountSettings`: open/close/tab).
- `@carbon/account/ui` → `AccountSettings` (host + modal), the panes, the
  section layout, `ProfileForm`, `TotpEnrollment` pieces.
- Per-app props: `user`, `companyId`, `api` (`/api` in the ERP,
  `/x/proxy/api` elsewhere), optional `renderBrowserNotifications` (ERP only:
  the push service worker is the ERP's) and `twoFactor` gate (ERP only: plan
  gate + upgrade dialog).
- `ColorPicker` moves to `@carbon/react` (the avatar picker needs it; the ERP
  keeps a re-export).

## Tasks

- [x] Create `packages/account` (package.json, tsconfig, AGENTS.md, CLAUDE.md).
- [x] Move panes/forms/TOTP pieces/store/models from the ERP into it; ERP files become imports or re-exports.
- [x] ERP: mount from the package; avatar menu + profile sheet open the package store; person page uses the package `ProfileForm`.
- [x] MES: proxy GET; mount the modal; UserNav + MoreSheet open it; MFA gate links to the ERP security pane.
- [x] Starter: proxy route, QueryClient + invalidation, Lingui provider (erp catalog), mount, avatar menu opens it.
- [x] Lingui: add `packages/account/src` to the erp and mes catalogs.
- [x] Verify: typecheck erp/mes/starter/account, Biome, tests, license headers. (Browser check pending — dev servers were down.)
