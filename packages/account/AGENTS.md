# @carbon/account

The account settings modal — Profile, Notifications, Security — shared by the ERP, the MES
and the starter. Each app mounts it once in its shell; it opens over any page.

## Always

- **Use the two-export structure**: `@carbon/account` (client-safe: `accountSettingsTabs`,
  `isAccountSettingsTab`, `accountProfileValidator`, the `useAccountSettings` store, the
  response types) and `@carbon/account/ui` (`AccountSettings`, `AccountSettingsPane` /
  `AccountSettingsSection`, `ProfileForm`, `OtpInput` / `useTotpEnrollment`).
- **The ERP owns the data.** Loaders and actions live in the ERP's
  `routes/api+/account.{profile,notifications,security}.ts` (plus `mfa.*` and
  `passkey.register.*`). The MES and the starter reach them through their `x+/proxy.$.tsx`
  route (`proxyToErp`, `@carbon/auth/erp-proxy.server`), so the package never ships a copy.
  The ERP loaders end in `satisfies Account*Data` — change a response shape in `types.ts`
  and the route together.
- **Open it through the store**: `useAccountSettings((s) => s.open)(tab?)`. `?account=<tab>`
  on any URL also opens it (the host drops the param at once); the ERP's old
  `/x/account/<tab>` pages redirect to `/x?account=<tab>`.
- **Mount with the app's config** (`AccountSettingsConfig`, `src/ui/context.tsx`): `api`
  (`/api` in the ERP, `/x/proxy/api` elsewhere), `user`, `companyId`. Only the ERP passes
  `renderBrowserNotifications` (the push service worker is on its origin) and `twoFactor`
  (the plan gate + upgrade dialog) — see `apps/erp/app/modules/account/ui/AccountSettings.tsx`.
- Panes read with `useLoaderQuery` (`@carbon/query`), so the host app needs a
  `QueryClientProvider`, `window.clientCache` and `createInvalidationMiddleware` in its root.
  Strings use Lingui macros, so it also needs a `LocaleProvider`; the package is in the erp
  and mes catalogs (`lingui.config.js`), and the starter loads the erp catalog.

## Never

- Import from an app (`~/…`). Anything app-specific comes in through `AccountSettingsConfig`
  or a prop.
- Make `ProfileForm` depend on the modal's context — the ERP's person page renders it
  outside the modal (`photo` and `action` are props for that reason).

## Validation Commands

```bash
pnpm --filter @carbon/account typecheck
pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=starter
```
