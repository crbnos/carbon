// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

// Modal and Drawer hide their close button when they are held open with no
// `onOpenChange`. A handler that does nothing defeats that: the dialog still
// cannot be closed, and the X is back, clickable and dead.
const NOOP_HANDLER =
  /onOpenChange=\{\s*(?:\(\w*\)\s*=>\s*(?:\{\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)?\s*\}|undefined|null|void 0)|noop)\s*\}/g;

export const noNoopOpenChange: ConformanceCheck = {
  id: "no-noop-open-change",
  description:
    "A dialog that cannot be dismissed omits onOpenChange instead of passing a handler that does nothing",
  provenance: {
    deprecates: "onOpenChange={() => {}} on a Modal or Drawer",
    replacedBy:
      "leaving onOpenChange off, which also removes the close button (@carbon/react)",
    since: "2026-10-04"
  },
  scan(file: string, contents: string): Violation[] {
    const violations: Violation[] = [];
    for (const match of contents.matchAll(NOOP_HANDLER)) {
      violations.push({
        file,
        line: contents.slice(0, match.index).split("\n").length,
        snippet: match[0].replace(/\s+/g, " "),
        message:
          "Remove onOpenChange: a dialog with no handler cannot be dismissed and shows no close button"
      });
    }
    return violations;
  }
};
