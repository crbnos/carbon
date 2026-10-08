// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

// React Router keeps a route's components mounted when only its params change
// (part A to part B, one order line to the next). Whatever the page seeded once
// from its record — a form's default values, an editor's initial content, a
// `useState` copy — then belongs to the previous record: a notes editor showed
// record A's notes on record B and the first keystroke saved them there.
// `RecordOutlet` remounts the page when it is shown for a different record.
const ROUTES = /^apps\/(?:erp|mes)\/app\/routes\/x\+\//;
const OUTLET = /<Outlet(?=[\s/>])([^>]*)>/g;

export const noBareOutlet: ConformanceCheck = {
  id: "no-bare-outlet",
  description:
    "a route under /x renders RecordOutlet, which remounts its page when the record changes",
  provenance: {
    deprecates: "<Outlet />",
    replacedBy: '<RecordOutlet /> from "@carbon/react"',
    since: "2026-10-06"
  },
  scan(file: string, contents: string): Violation[] {
    if (!ROUTES.test(file)) return [];
    const violations: Violation[] = [];
    for (const match of contents.matchAll(OUTLET)) {
      // An outlet with its own key already says when its page remounts (the
      // shell keys on the company).
      if (/\bkey=/.test(match[1]!)) continue;
      const line = contents.slice(0, match.index).split("\n").length;
      const text = contents.split("\n")[line - 1]?.trim() ?? "";
      if (text.startsWith("//") || text.startsWith("*")) continue;
      violations.push({
        file,
        line,
        snippet: text,
        message:
          'Render `<RecordOutlet />` from "@carbon/react": a plain outlet keeps the page mounted when the record changes, with the previous record\'s form and editor state'
      });
    }
    return violations;
  }
};
