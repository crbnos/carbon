// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

/**
 * Code that runs in the browser — components, hooks, a module's `ui/`, and
 * the client-safe module files (`*.models.ts`, `*.utils.ts`, `types.ts`) —
 * never imports a module's `.service`, `.server` or `.pdf` file. All three are
 * server-only (a `.pdf.tsx` renders with `@react-pdf/renderer` in Node):
 * a service file may import server-only packages, and React Router refuses a
 * `.server` module in the client graph only at build time. A function the UI
 * calls lives in `<module>.utils.ts`. Type-only imports are erased and allowed.
 */
const CLIENT_FILE =
  /^apps\/erp\/app\/(?:components\/|hooks\/|stores\/|modules\/[a-z-]+\/(?:ui\/|[A-Za-z0-9.-]+\.(?:models|utils)\.tsx?$|types\.ts$))/;

const SERVER_IMPORT =
  /^(?:import|export)\s+(?!type\s)[^;]*?\sfrom\s+"([^"]+\.(?:service|server|pdf))";/gm;

export const noServerCodeInClient: ConformanceCheck = {
  id: "no-server-code-in-client",
  description:
    "Components, hooks, ui/, models, utils and types never import a .service or .server file.",
  provenance: {
    deprecates:
      "a browser-side file importing a module's service or server file",
    replacedBy:
      "the client-safe function in <module>.utils.ts, or data from the route's loader"
  },
  scan(file, contents) {
    if (!CLIENT_FILE.test(file)) return [];
    const violations: Violation[] = [];
    for (const match of contents.matchAll(SERVER_IMPORT)) {
      violations.push({
        file,
        line: contents.slice(0, match.index).split("\n").length,
        snippet: match[1]!,
        message: `"${match[1]}" is server-only: move what this file calls into the module's .utils.ts, or pass it from the route's loader.`
      });
    }
    return violations;
  }
};
