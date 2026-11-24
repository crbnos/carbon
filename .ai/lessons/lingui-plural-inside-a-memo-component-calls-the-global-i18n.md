---
paths: []
triggers: []
promoted: null
---
# Lingui: `plural()` inside a `memo(…)` component calls the global i18n

**Context:** The jobs table's bulk-release toast needed "Released 1 job" / "Released N jobs". The table is `memo((props) => { … })`, and the toast text was written as `` t`${plural(count, { one: "Released # job", other: "Released # jobs" })}` `` with `t` from `useLingui()` and `plural` from `@lingui/core/macro`.

**Problem:** Lingui 6.9.0's macro transform folds a nested `plural()` into the surrounding `t` only when the component or hook is a function declaration or a plain `const X = () => …`. When the function is an inline ARGUMENT of a call (`memo((props) => …)`), the `plural()` is expanded on its own into `i18n._(…)` on the global `@lingui/core` instance, and the outer `t` becomes `{0}` with that call as its value. The global instance is never activated here (see `.claude/rules/i18n-lingui-system.md`), so the string throws "Attempted to call a translation function without setting a locale" the first time it is built. Typecheck, Biome and `lingui:extract` all pass: the catalog shows a normal ICU plural msgid. Only the compiled output shows it.

**Rule:** Do not call `plural()` (or `select()`) from `@lingui/core/macro` inside a component passed inline to `memo(…)` or any other call. Use `<Plural>` in JSX. For a string (a toast), either build it in a function-declaration hook (`function useX() { const { t } = useLingui(); return (n: number) => t`${plural(n, …)}`; }`), or choose between two whole `t` phrases (``n === 1 ? t`Released 1 job` : t`Released ${n} jobs` ``) — both phrases are extracted and translated, but a locale with more plural forms gets only two. When in doubt, read the compiled module (Vite `transformRequest` on the file) and check for an import of `i18n` from `@lingui/core`.

**Applies to:** every `memo(…)` component in `apps/{erp,mes}/app` and `packages/{react,form}/src` (most ERP tables); any new use of `plural` / `select` from `@lingui/core/macro`.
