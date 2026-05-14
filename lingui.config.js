import { defineConfig } from "@lingui/cli";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "es", "de", "it", "ja", "zh", "fr", "pl", "pt", "ru", "hi"],
  fallbackLocales: {
    default: "en"
  },
  // Plain string format kept for tooling compat (linguito, weblate). Origin
  // refs (`#: path:lineno`) and POT-Creation-Date are stripped post-extract
  // in scripts/strip-po-headers.mjs — those metadata lines churn on every PR
  // and account for ~half of the diff in our .po files.
  format: "po",
  catalogs: [
    {
      path: "packages/locale/locales/{locale}/erp",
      include: ["apps/erp/app", "packages/react/src"],
      exclude: ["**/*.server.*", "**/*.test.*", "**/*.spec.*"]
    },
    {
      path: "packages/locale/locales/{locale}/mes",
      include: ["apps/mes/app", "packages/react/src"],
      exclude: ["**/*.server.*", "**/*.test.*", "**/*.spec.*"]
    }
  ]
});
