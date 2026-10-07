// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineConfig } from "@lingui/cli";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "es", "de", "it", "ja", "zh", "fr", "pl", "pt", "ru", "hi", "tr", "ko"],
  fallbackLocales: {
    default: "en"
  },
  // Default `po` format (linguito, weblate). Origin refs (`#: path:lineno`)
  // and POT-Creation-Date are stripped post-extract in
  // scripts/strip-po-headers.mjs — those metadata lines churn on every PR
  // and account for ~half of the diff in our .po files.
  catalogs: [
    {
      path: "<rootDir>/packages/locale/locales/{locale}/erp",
      include: [
        "apps/erp/app",
        "packages/react/src",
        "packages/form/src",
        "packages/printing/src/ui",
        "docs/content/src/glossary",
        "packages/onboarding/src",
        "packages/ee/src/workflows"
      ],
      exclude: ["**/*.server.*", "**/*.test.*", "**/*.spec.*"]
    },
    {
      path: "<rootDir>/packages/locale/locales/{locale}/mes",
      include: [
        "apps/mes/app",
        "packages/react/src",
        "packages/form/src",
        "packages/printing/src/ui"
      ],
      exclude: ["**/*.server.*", "**/*.test.*", "**/*.spec.*"]
    }
  ]
});
