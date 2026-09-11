# @carbon/locale

Lingui runtime, locale selection, and per-render catalog activation for ERP and MES.

## Always

- MUST translate component strings with `useLingui()` or `<Trans>` from `@lingui/react/macro`.
- MUST use `msg` from `@lingui/core/macro` only to create `MessageDescriptor` values such as breadcrumbs.
- MUST update `lingui.config.js`, `supportedLanguages`, and `languageNativeLabels` together when adding a locale.
- MUST run extraction and translation after adding user-facing strings; commit `.po` catalogs, not compiled output.
- MUST keep `LocaleProvider` as the active Lingui runtime. It creates and activates a per-render `setupI18n()` instance.

## Ask First

- Adding/removing a supported language or changing `defaultLanguage`/`resolveLanguage()` fallback behavior.
- Changing `LocaleProvider`; every app mounts it from `root.tsx`.
- Changing catalog source globs because ERP and MES share React/form/printing messages.

## Never

- Never call `t` imported from `@lingui/core/macro`; it targets the unactivated global singleton and can crash SSR.
- Never hardcode translatable UI copy outside `msg`, `useLingui().t`, or `<Trans>`.
- Never commit `packages/locale/locales/**/*.mjs`; builds regenerate them.
- Never treat `locales/nl/` as supported. Dutch catalogs are orphaned until `nl` is added to both runtime and Lingui config.

## Validation Commands

```bash
pnpm --filter @carbon/locale test
pnpm --filter @carbon/locale typecheck
pnpm lingui:check
```

## Key Exports

| Subpath | Provides |
|---------|----------|
| `.` | `LocaleProvider`, `SupportedLanguage`, `supportedLanguages`, `languageNativeLabels`, `defaultLanguage`, `localeCookieName`, `resolveLanguage`, `getSortedLanguageSelectOptions` |

Supported runtime locales are `en`, `fr`, `de`, `es`, `it`, `ja`, `pl`, `pt`, `ru`, `zh`, `hi`, `tr`, and `ko`. Catalogs live at `packages/locale/locales/{locale}/{erp,mes}.po`.

## Catalog Workflow

1. Mark with `useLingui().t`, `<Trans>`, or `msg`.
2. Run `pnpm lingui:extract`.
3. Run `pnpm translate` to fill non-English catalogs using the approved glossary.
4. Run `pnpm lingui:clean` to remove diff-noisy headers/origin references.
5. Run `pnpm lingui:compile` or `pnpm lingui:check`; generated `.mjs` remains untracked.

## Cross-References

- `.claude/rules/i18n-lingui-system.md` — catalog sources, macro patterns, server loading, and gotchas.
- `lingui.config.js` — source paths and locale catalog definitions.
- `packages/locale/locales/glossary.json` and `@carbon/glossary` — approved manufacturing terminology.
- `apps/{erp,mes}/app/services/lingui.server.ts` — request-language resolution and catalog loading.
