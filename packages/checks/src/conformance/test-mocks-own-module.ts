// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

// A test that mocks its own module's neighbours pins the wiring between them:
// it passes while the rule is wrong and fails when the code is reorganised.
// Package specifiers (`@carbon/...`, `node:...`) are not matched here.
const OWN_MODULE_MOCK =
  /\bvi\.(mock|doMock)\(\s*(?:import\(\s*)?(["'`])((?:\.{1,2}|~)\/[^"'`]*)\2/g;

export const testMocksOwnModule: ConformanceCheck = {
  id: "test-mocks-own-module",
  description: "Tests do not vi.mock a first-party module by relative path",
  provenance: {
    deprecates:
      "vi.mock of ./, ../ or ~/ modules to reach the logic under test",
    replacedBy:
      "a pure function tested by value, or a database test (.claude/rules/testing.md)",
    since: "2026-10-25"
  },
  scan(file: string, contents: string): Violation[] {
    return [...contents.matchAll(OWN_MODULE_MOCK)].map((match) => ({
      file,
      line: contents.slice(0, match.index).split("\n").length,
      snippet: `vi.${match[1]}("${match[3]}")`,
      message:
        "Do not mock our own modules; extract the decision into a pure function and test it by value (.claude/rules/testing.md → Mocks)"
    }));
  }
};
