# i18n / Lingui System

## Architecture

- Lingui v5 with macros. Config at root `lingui.config.js`: locales en (source), es, de, it, ja, zh, fr, pl, pt, ru, hi; PO format; catalogs at `packages/locale/locales/{locale}/{erp,mes}` extracted from `apps/{erp,mes}/app`, `packages/react/src`, `packages/form/src` (excludes `*.server.*`, tests). PO origin refs/creation dates are stripped post-extract by `scripts/strip-po-headers.mjs` to reduce diff churn.
- **No `runtimeConfigModule`** is configured, so `t` from `@lingui/core/macro` compiles to `i18n._()` on the **global** singleton from `@lingui/core`.
- The global i18n singleton is **never activated** — there is no `i18n.activate()` call anywhere except inside `LocaleProvider`.
- `packages/locale/src/i18n.tsx` — `LocaleProvider` creates its own runtime per render via `setupI18n()`, loads the catalog, activates it, and provides it through `<I18nProvider>` (React context). This is the only working i18n instance.
- Server side: `apps/erp/app/services/lingui.server.ts` `loadLinguiCatalogForRequest()` lazily imports the compiled `erp.mjs` catalog for the resolved locale (via `import.meta.glob`); the root loader passes the catalog to `LocaleProvider`. It loads messages only — it does not (and must not) activate the global singleton.

## Critical pitfall (caused production SSR crashes)

Using the `t` backtick macro imported from `@lingui/core/macro` in render code throws
`"Lingui: Attempted to call a translation function without setting a locale"` during SSR
(and on the client), because it hits the never-activated global singleton.

**Correct patterns:**
- In components: `import { useLingui } from "@lingui/react/macro"; const { t } = useLingui();` then `t\`...\`` — context-bound, identical message IDs/extraction.
- `<Trans>` from `@lingui/react/macro` — context-bound, safe.
- Route `handle.breadcrumb: msg\`...\`` with `msg` from `@lingui/core/macro` — safe; `msg` only creates a MessageDescriptor (no i18n call). `Breadcrumb.tsx` resolves descriptors via the context `t`.
- If `t` is used inside `useMemo`/`useCallback`, include `t` in the dependency array (see `assignments.tsx` columns memo).

So: `msg` from core/macro is fine; **never import `t` from `@lingui/core/macro`** in app code.
