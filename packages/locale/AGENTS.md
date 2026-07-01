# @carbon/locale

i18n runtime — Lingui integration, locale resolution, language config, and the `LocaleProvider` that activates translations.

## Always

- **Use `useLingui` from `@lingui/react/macro`** in components: `const { t } = useLingui();` then `` t`string` ``. Use `<Trans>` from `@lingui/react/macro` for JSX. Use `msg` from `@lingui/core/macro` only for `MessageDescriptor` creation (breadcrumbs, glossary terms).
- **Keep `supportedLanguages` in sync** — adding a locale requires updating both `lingui.config.js` (root) and `packages/locale/src/config.ts` (`supportedLanguages` + `languageNativeLabels`).
- **Run extraction after adding strings**: `pnpm lingui:extract` then `pnpm translate` to LLM-fill translations, then `pnpm lingui:clean` to strip diff-noisy headers.
- **`LocaleProvider` is the only active i18n instance** — it creates a per-render Lingui runtime via `setupI18n()`. The global `@lingui/core` singleton is never activated.

## Ask First

- Adding a new supported language
- Changing `resolveLanguage` fallback logic or `defaultLanguage` behavior
- Modifying `LocaleProvider` rendering (it's mounted in every app's `root.tsx`)

## Never

- `import { t } from "@lingui/core/macro"` in app code — this calls the global singleton which is never activated, causing SSR crashes
- Commit compiled `.mjs` files — they're gitignored (`packages/locale/locales/**/*.mjs`) and regenerated at build
- Hardcode locale strings — always use `msg`/`t`/`<Trans>` so extraction picks them up

## Validation Commands

```bash
pnpm --filter @carbon/locale typecheck
pnpm lingui:check          # extract + compile (root script)
pnpm lingui:extract        # update .po files
```

## Key Exports

```typescript
import { LocaleProvider, supportedLanguages, resolveLanguage, defaultLanguage,
         languageNativeLabels, localeCookieName } from "@carbon/locale";
```

- `LocaleProvider` — wraps app in Lingui `I18nProvider` with per-render runtime
- `resolveLanguage(locale)` — normalizes locale string to `SupportedLanguage`
- `supportedLanguages` — `["en","fr","de","es","it","ja","pl","pt","ru","zh","hi","tr"]`
- Catalogs live at `packages/locale/locales/{locale}/{erp,mes}.po`

## Cross-References

- `.ai/rules/i18n-lingui-system.md` — full i18n system docs, marking patterns, gotchas
- `lingui.config.js` (root) — catalog config, source paths, locale list
- `@carbon/glossary` — terms use `msg` descriptors for i18n
- `apps/{erp,mes}/app/services/lingui.server.ts` — server-side catalog loading
