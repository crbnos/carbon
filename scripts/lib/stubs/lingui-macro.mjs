// Inert stand-in for the Lingui macro packages (`@lingui/react/macro`,
// `@lingui/core/macro`, `@lingui/macro`), aliased in by `validator-loader.ts`.
//
// Those are COMPILE-TIME macros: the real transform runs in the app's Vite
// pipeline. The validator loader pulls a module's `{module}.models.ts`, which
// transitively reaches UI components that import them — but it only ever reads
// zod validator objects, never renders. Without this the SSR loader externalizes
// the real (CJS) macro packages and dies on `Named export 'Trans' not found`.
export const useLingui = () => ({ t: (s) => String(s), i18n: {} });
export const Trans = () => null;
export const Plural = () => null;
export const Select = () => null;
export const SelectOrdinal = () => null;
export const msg = (s) => s;
export const t = (s) => String(s);
export const plural = (s) => s;
export const select = (s) => s;
export const selectOrdinal = (s) => s;
export default {};
