---
description: i18n via Lingui — how strings are marked, extracted, compiled, and loaded at runtime in ERP/MES.
paths:
  - "packages/locale/**"
  - "lingui.config.js"
  - "apps/erp/app/**"
  - "apps/mes/app/**"
---

# i18n / Lingui System

Lingui **v5.9.4** (versions in `pnpm-workspace.yaml` catalog). The macro transform
runs via `@lingui/vite-plugin` (`lingui()` plugin in `apps/erp/vite.config.ts` and
`apps/mes/vite.config.ts`) — no Babel macro config.

## Config & catalogs

- Root `lingui.config.js`: `sourceLocale: "en"`, format `po`, `fallbackLocales.default: "en"`.
- Locales: `en, es, de, it, ja, zh, fr, pl, pt, ru, hi, tr, ko` (13). The runtime
  list in `packages/locale/src/config.ts` (`supportedLanguages`) matches this set.
- Two catalogs, each extracted from app + shared package sources:
  - `packages/locale/locales/{locale}/erp` ← `apps/erp/app`, `packages/react/src`, `packages/form/src`, `packages/printing/src/ui`
  - `packages/locale/locales/{locale}/mes` ← `apps/mes/app` + the same three shared dirs
  - Both `exclude` `**/*.server.*`, `**/*.test.*`, `**/*.spec.*`.
- `.po` files are committed; **compiled `.mjs` are gitignored** (`.gitignore`:
  `packages/locale/locales/**/*.mjs`) and produced at build time.

## Scripts (root `package.json`)

- `lingui:extract` → `lingui extract --clean` (writes/prunes `.po`).
- `lingui:compile` → `lingui compile --namespace es` (compiles `.po` → `.mjs` as ES modules).
- `lingui:check` → extract + compile.
- `lingui:clean` → `node ./scripts/strip-po-headers.mjs`: strips `POT-Creation-Date`
  header and `#: path:lineno` origin refs from every `.po` to kill per-PR diff churn.
- `translate` → extract, then `pnpx linguito translate --llm` (LLM fills missing
  translations; origins must still exist for source context), then `lingui:clean`.

## Mark → extract → compile → load

1. **Mark** strings with macros (see patterns below).
2. **Extract** (`lingui:extract`) scans configured sources → updates `{locale}/{erp,mes}.po`.
3. **Compile**: `@lingui/vite-plugin` (wired in both apps' `vite.config.ts`) compiles a
   `.po` import into a JS module (`export const messages`) in every Vite environment —
   SSR and client — so the catalog is a hashed, immutable chunk per locale. The
   `lingui:compile` → `.mjs` step is no longer read by the apps; it stays only as the
   turbo build input that invalidates the build cache when a `.po` changes. Catalog
   paths in `lingui.config.js` use `<rootDir>/…` because the plugin resolves them
   against the config dir while Vite runs from `apps/<app>` — a bare relative path
   fails with "not matched to any of your catalogs paths".
4. **Load**: `apps/{erp,mes}/app/services/lingui.ts` (isomorphic, one per app because
   the glob names the app's catalog) — `import.meta.glob("…/*/{erp,mes}.po", { import: "messages" })`
   behind a module-level `Map`. `preloadCatalog(locale)` fills it; `getCatalog(locale)`
   reads it (`{}` if missing); `useCatalog(locale)` reads and, on a cache miss, preloads
   then re-renders — that is the live language switch (`/api/locale` → root revalidates
   with the new cookie → the new chunk is fetched).
   - Server: the root loader awaits `preloadCatalog(appLanguage)` so SSR is translated,
     and returns NOTHING about the catalog. It used to return the whole catalog as
     loader data — ~465 KB raw in every HTML and in every `.data` response, which
     single-fetch serves uncompressed (`text/x-script`), and the root loader re-ran on
     every action and search-param change. `root.tsx` now also has a `shouldRevalidate`
     that skips same-pathname GETs (`isSearchParamOnlyNavigation`); actions still
     revalidate because root carries the flash `result`.
   - Client: `entry.client.tsx` awaits `preloadCatalog(document.documentElement.lang)`
     BEFORE `hydrateRoot` — otherwise a non-`en` page hydrates against an empty catalog
     and mismatches the server markup. `<html lang>` is the resolved language, set by root.
5. **Provide**: `root.tsx` renders
   `<LocaleProvider locale={appLanguage} catalog={useCatalog(appLanguage)}>` from `@carbon/locale`.
   `LocaleProvider` (`packages/locale/src/i18n.tsx`) builds a per-render runtime with
   `setupI18n()`, `runtime.load(language, catalog)`, `runtime.activate(language)`, and
   wraps children in Lingui's `<I18nProvider>`. This is the only active i18n instance.

> Inside `LocaleProvider`, `root.tsx` also nests `<I18nProvider locale=…>` from
> **`@react-aria/i18n`** — unrelated to Lingui (ARIA/locale formatting). Don't conflate them.

## Marking strings — correct patterns

- **No `runtimeConfigModule`** is configured, so `t` from `@lingui/core/macro` would
  compile to `i18n._()` on the **global** `@lingui/core` singleton, which is never
  activated (only `LocaleProvider`'s per-render runtime is). Calling it throws
  *"Attempted to call a translation function without setting a locale"* during SSR/CSR.
- **Components:** `import { useLingui } from "@lingui/react/macro"; const { t } = useLingui();`
  then `` t`...` `` — context-bound, same message IDs as extract. (~741 files.)
- **JSX:** `<Trans>` from `@lingui/react/macro` — context-bound, safe. (~557 files.)
- **Route breadcrumbs:** `handle.breadcrumb: msg\`...\`` with `msg` from
  `@lingui/core/macro` — `msg` only builds a `MessageDescriptor` (no i18n call).
  `apps/erp/app/components/Layout/Topbar/Breadcrumbs.tsx` resolves descriptors via the
  context runtime (`i18n._(value)`).
- If `t` (from `useLingui`) is used inside `useMemo`/`useCallback`, add `t` to the deps
  (e.g. `assignments.tsx` columns memo, dep `[t]`).
- **Never `import { t }` from `@lingui/core/macro`** in app code (currently zero such
  imports — only `{ msg }` is imported from `core/macro`).

## Adding strings / locales

- **String:** wrap it with `<Trans>` / `useLingui().t` / `msg`, then run
  `pnpm lingui:extract` (and `pnpm translate` to LLM-fill other locales). Commit the
  `.po` changes; `.mjs` is regenerated at build.
- **Locale:** add the code to BOTH `lingui.config.js` `locales` AND
  `supportedLanguages` in `packages/locale/src/config.ts` (plus `languageNativeLabels`),
  then extract/translate.

## Gotchas

- `nl` (Dutch) `.po` files exist on disk under `locales/nl/` but `nl` is **not** in
  `lingui.config.js` or `supportedLanguages` — it's orphaned; extract won't update it
  and the runtime can't select it.
- Compiled `.mjs` are gitignored — a fresh checkout has no catalogs until a build/compile
  runs; the server loader falls back to `{}` (English source strings) if missing.
