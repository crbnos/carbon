// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck, type Violation } from "../../check";
import { typescript } from "../../sources/inputs";
import { maskClientCode } from "../../sources/server-files";
import { lineOf } from "../../sources/text";

/**
 * Code that runs in the browser — components, hooks, stores, a module's `ui/`,
 * and the client-safe module files (`*.models.ts`, `*.utils.ts`, `types.ts`) —
 * never imports a module's `.service`, `.server` or `.pdf` file. All three are
 * server-only (a `.pdf.tsx` renders with `@react-pdf/renderer` in Node):
 * a service file may import server-only packages, and React Router refuses a
 * `.server` module in the client graph only at build time. A function the UI
 * calls lives in `<module>.utils.ts`. Type-only imports are erased and allowed.
 *
 * A route module is server AND browser code. React Router strips its loader
 * and action, so a route may import a service file for them; it fails when a
 * name it imports from one is used in the browser half (the default export,
 * `clientLoader`, components and hooks — what `maskClientCode` blanks). That
 * is how `LOCK_PERIOD_TASK_NAME` in a close-period component pulled the
 * accounting service, and its `@carbon/auth/auth.server` import, into the
 * client build, and the build failed.
 *
 * See `.claude/rules/module-files.md`.
 */
export const noServerCodeInClient = defineCheck({
  files: typescript,
  id: "no-server-code-in-client",
  description:
    "Components, hooks, ui/, models, utils, types and a route's browser code never import a .service or .server file.",
  provenance: {
    deprecates:
      "a browser-side file importing a module's service or server file",
    replacedBy:
      "the client-safe function in <module>.utils.ts, or data from the route's loader"
  },
  rule() {
    const clientFile =
      /^apps\/erp\/app\/(?:components\/|hooks\/|stores\/|modules\/[a-z-]+\/(?:ui\/|[A-Za-z0-9.-]+\.(?:models|utils)\.tsx?$|types\.ts$))/;
    const serverImport =
      /^(?:import|export)\s+(?!type\s)[^;]*?\sfrom\s+"([^"]+\.(?:service|server|pdf))";/gm;
    const routeFile = /^apps\/erp\/app\/routes\//;
    const serverImportClause =
      /^import\s+(?!type\s)([^;]*?)\s+from\s+"([^"]+\.(?:service|server|pdf))";/gm;

    /** The local names a value import binds: `{ a, b as c, type T }`, `* as x`, `d`. */
    function importedNames(clause: string): string[] {
      const names: string[] = [];
      const named = clause.match(/\{([^}]*)\}/)?.[1];
      if (named !== undefined) {
        for (const part of named.split(",")) {
          const spec = part.trim();
          if (!spec || spec.startsWith("type ")) continue;
          const local = spec.split(/\s+as\s+/).pop() ?? spec;
          names.push(local.trim());
        }
      }
      const bare = clause
        .replace(/\{[^}]*\}/, "")
        .replace(/,/g, " ")
        .trim();
      const namespace = bare.match(/\*\s+as\s+(\w+)/)?.[1];
      if (namespace) names.push(namespace);
      else if (/^\w+$/.test(bare)) names.push(bare);
      return names;
    }

    /** The browser half of a route, comments removed. */
    function browserCode(contents: string): string {
      const masked = maskClientCode(contents).split("\n");
      return (
        contents
          .split("\n")
          .filter((line, i) => masked[i] !== line)
          .join("\n")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")
          // JSX text is prose: "Only authorize it" is not a use of `authorize`.
          .replace(/>([^<>{}()=;]*)</g, "><")
      );
    }

    /** `const name`, or `name` inside a destructuring: a local that shadows the import. */
    const declaresLocal = (code: string, name: string) =>
      new RegExp(
        `\\b(?:const|let|var)\\s+(?:${name}\\b|[[{][^=]*\\b${name}\\b[^=]*[\\]}]\\s*=)`
      ).test(code);

    function scanRoute(file: string, contents: string): Violation[] {
      const client = browserCode(contents);
      if (!client.trim()) return [];
      const violations: Violation[] = [];
      for (const match of contents.matchAll(serverImportClause)) {
        const clause = match[1] ?? "";
        const path = match[2] ?? "";
        for (const name of importedNames(clause)) {
          if (!new RegExp(`(?<![\\w.$])${name}\\b`).test(client)) continue;
          if (declaresLocal(client, name)) continue;
          violations.push({
            file,
            line: lineOf(contents, match.index),
            snippet: `${name} from ${path}`,
            message: `"${name}" from "${path}" is used in the route's browser code, which pulls the server-only file into the client build: move it into the module's .utils.ts, or pass it from the loader.`
          });
        }
      }
      return violations;
    }

    return (file, contents) => {
      if (routeFile.test(file)) return scanRoute(file, contents);
      if (!clientFile.test(file)) return [];
      const violations: Violation[] = [];
      for (const match of contents.matchAll(serverImport)) {
        const path = match[1] ?? "";
        violations.push({
          file,
          line: lineOf(contents, match.index),
          snippet: path,
          message: `"${path}" is server-only: move what this file calls into the module's .utils.ts, or pass it from the route's loader.`
        });
      }
      return violations;
    };
  }
});
