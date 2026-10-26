// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

// No `runtimeConfigModule` is configured, so `t` from @lingui/core/macro
// compiles to a call on the global i18n instance, which is never activated:
// it throws "Attempted to call a translation function without setting a
// locale". `msg` from the same module is the right way to build a descriptor.
const CORE_T_IMPORT =
  /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*["']@lingui\/core\/macro["']/g;
// `i18n._(msg`Scrap`)` is the long way round to `t`Scrap``. Rendering a
// descriptor built elsewhere, `i18n._(descriptor)`, is fine and not matched.
const UNWRAPPED_MSG = /[._]\(\s*msg`|\bt\(\s*msg\(/g;

export const linguiMacroMisuse: ConformanceCheck = {
  id: "lingui-macro-misuse",
  description:
    "Translate with useLingui().t / <Trans>; never the global t, never i18n._(msg`...`)",
  provenance: {
    deprecates: "t from @lingui/core/macro, i18n._(msg`...`)",
    replacedBy:
      "useLingui().t or <Trans> from @lingui/react/macro (.claude/rules/i18n-lingui-system.md)",
    since: "2026-10-25"
  },
  scan(file: string, contents: string): Violation[] {
    const at = (index = 0) => contents.slice(0, index).split("\n").length;
    return [
      ...[...contents.matchAll(CORE_T_IMPORT)].map((m) => ({
        file,
        line: at(m.index),
        snippet: 'import { t } from "@lingui/core/macro"',
        message:
          "t from @lingui/core/macro calls the global i18n instance, which is never activated; use useLingui().t from @lingui/react/macro"
      })),
      ...[...contents.matchAll(UNWRAPPED_MSG)].map((m) => ({
        file,
        line: at(m.index),
        snippet: m[0],
        message: "Use t`...` instead of unwrapping a literal msg`...`"
      }))
    ];
  }
};
