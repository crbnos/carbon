# @carbon/account

The account settings modal — Profile, Appearance, Notifications, Security — shared by the ERP, the MES
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
- **A modal that is a sheet on phones.** `AccountSettings` is one `Modal`: on phones `ModalContent` renders a full-height bottom sheet (`@carbon/react`), whose header is the modal's title (`ModalHeader className="md:sr-only"`: screen-reader only on desktop, where the sidebar is the chrome) and whose sidebar becomes a strip of tabs above the pane. A dialog opened from a pane (signature, avatar picker, the Security dialogs) is a plain `Modal` too, so on phones it is a sheet stacked above the settings.
- **Open it through the store**: `useAccountSettings((s) => s.open)(tab?)`. `?account=<tab>`
  on any URL also opens it (the host drops the param at once); the ERP's old
  `/x/account/<tab>` pages redirect to `/x?account=<tab>`.
- **Mount with the app's config** (`AccountSettingsConfig`, `src/ui/context.tsx`): `api`
  (`/api` in the ERP, `/x/proxy/api` elsewhere), `user`, `companyId`. Only the ERP passes
  `renderBrowserNotifications` (the push service worker is on its origin) and `twoFactor`
  (the plan gate + upgrade dialog) and `transitionMode` (the view-transition mode wipe, whose
  CSS is in the ERP's stylesheet) — see `apps/erp/app/modules/users/ui/AccountSettings.tsx`.
- **Appearance is the one pane that does not call the ERP.** Mode, theme, text size and density
  are per-browser cookies on the HOST app, so the pane posts `mode` / `theme` / `textSize` /
  `density` to the host's own root action (`/`), which every app's `root.tsx` handles
  (`modeValidator` / `themeColorValidator` / `textSizeValidator` / `densityValidator` from
  `@carbon/utils`). Every save (the MES quick mode toggle too) uses `ROOT_ACTION_SAVE` (`@carbon/utils`): it passes
  `defaultShouldRevalidate: false`, so only the root loader re-runs (the ERP and MES roots use
  `rootShouldRevalidate`; a shell or page with its own `shouldRevalidate` wraps it in
  `deferRootActionPost`), and `/` is in the
  cache-invalidation `skipPaths`, since it writes cookies only. Text size and density are separate on purpose (browser zoom moves both):
  `uiScaleStyle` sets the root `font-size` and Tailwind's `--spacing` on `<html>`, and
  `useUiScale` reads a pending pick first so it shows at once. `useOptimisticMode` only counts a `/`
  submission carrying `mode`, so the two never read each other's in-flight value.
  The **Theme** section (`ThemeSettings`) is one choice, one `theme` post. With `themePresets`
  in `AccountSettingsConfig` it has 2 tabs in its header: "Themes" (the color themes from
  `pickableThemes()`, the seasonal theme first while one is in season, then the gradient and
  solid `presetThemes`) and "Custom theme" (the editor
  for a `custom:<base>:<highlight>:<g|s>` theme); it opens on the tab of the theme in use.
  Without it (the starter) it is the color grid alone. Picking an everyday theme while a
  seasonal one is in season switches the seasonal one off for this browser.
  Only the ERP and the MES pass it: their shells paint the frame with `useThemeStyle` and hand it down through `ThemeStyleProvider`; the
  starter's shell has no `NavRail`. A pick (a theme card, a custom color, Surprise me, the
  Gradient switch) is a draft in the section's own state, previewed across the app but posted only
  by **Save**. **Discard** drops it, and so does closing the pane (both previews end on unmount).
  The frame and page tint preview through `setThemePreview`; the accent through
  `useThemePreview` on `<body>`, which skips the variables a theme's `colors` tint (or the tint
  would drop under them) and keeps showing the theme being saved until the root reloads. A pick is
  compared with `useSavedThemeValue` (the theme in use or being saved, without the preview), and
  stops being a draft in the render its save is posted, so the preview hands over to the pending
  save with no frame of the old theme. On the Appearance tab the modal's content carries
  `data-clear-backdrop`, so the page behind it is not dimmed or blurred and the preview shows.
- Panes read with `useLoaderQuery` (`@carbon/query`), so the host app needs a
  `QueryClientProvider`, `window.clientCache` and `createInvalidationMiddleware` in its root.
  Strings use Lingui macros, so it also needs a `LocaleProvider`; the package is in the erp
  and mes catalogs (`lingui.config.js`), and the starter loads the erp catalog.
- **Signature** (`SignatureForm`, Profile pane only — not `ProfileForm`, so nobody edits another
  person's signature from the person page): one dialog with Draw / Upload tabs. Draw is
  `SignaturePad` (plain canvas, speed- or pen-pressure-weighted ink, undo with `SHORTCUTS.undo`,
  exported as a trimmed PNG); Upload previews the file after `prepareImageUpload` (`height: 200`). The browser uploads a NEW file to the private
  `signatures` bucket at `{userId}/{uuid}.{ext}` (owner INSERT/SELECT only, no UPDATE), then posts
  `intent=signature`; the ERP's `updateOwnSignature` saves `user.signaturePath` and deletes the
  replaced file only when no `approvalRequest.decisionSignaturePath` names it. The profile loader
  returns a 5-minute signed `signatureUrl`. Every reader checks a path with `isOwnSignaturePath`
  (`@carbon/utils`): a user can write any text into their own row.

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
