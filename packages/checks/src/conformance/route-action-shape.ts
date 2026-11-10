// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

// A write in a route is logic the API and MCP cannot reach: a tool named like
// the button does less than the button. Routes call one service function
// (`defineServiceFn`) and the write lives there. Only patterns that are
// certainly writes are matched: `.rpc(` reads as often as it writes.
const ROUTES = /^apps\/erp\/app\/routes\//;
const WRITES = [
  /\.from\(\s*["'`][^"'`]+["'`]\s*\)\s*\.(?:insert|upsert|update|delete)\(/g,
  /\.(?:insertInto|updateTable|deleteFrom)\(/g,
  // a posting body, run outside its service function
  /\binvoke(?:Posting(?:OrThrow)?|Create)\(/g
];

export const routeActionShape: ConformanceCheck = {
  id: "route-action-shape",
  description:
    "An ERP route writes only through a service function: no client, Kysely or posting writes in the route",
  provenance: {
    deprecates: "a route action that composes writes itself",
    replacedBy:
      "one `defineServiceFn` per operation, called through `carbon(request)`",
    since: "2026-10-15"
  },
  scan(file: string, contents: string): Violation[] {
    if (!ROUTES.test(file)) return [];
    const violations: Violation[] = [];
    for (const pattern of WRITES) {
      for (const m of contents.matchAll(pattern)) {
        violations.push({
          file,
          line: contents.slice(0, m.index).split("\n").length,
          snippet: m[0].replace(/\s+/g, ""),
          message:
            "Move this write into a service function (`defineServiceFn` in the module's .server.ts) and call it from the route"
        });
      }
    }
    return violations;
  }
};
