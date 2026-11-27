// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck, type SourceFile, type Violation } from "../../check";
import { sharedAppTypescript } from "../../sources/inputs";

// ERP and MES grew the same components and hooks by copying them, so a fix
// landed in one app and not the other — the login route's lost redirect was
// copied along with the route. A file needed by both lives in a package
// (@carbon/react, @carbon/auth, @carbon/utils); each app may keep a file of
// that name that only re-exports it.
export const noDuplicatedAppFile = defineCheck({
  id: "no-duplicated-app-file",
  description:
    "A component or hook needed by both ERP and MES lives in a package; each app may keep a file of that name that only re-exports it.",
  reads: { files: sharedAppTypescript },
  rule() {
    // Names every folder has; they hold different things in each app.
    const generic = new Set(["index.ts", "index.tsx", "types.ts", "utils.ts"]);
    const reExportOnly =
      /^(?:\s*\/\/[^\n]*\n|\s*\n|\s*export\s+(?:type\s+)?(?:\{[^}]*\}|\*)\s+from\s+["'][^"']+["'];?\s*\n?)*$/;
    const appOf = (file: string) => file.split("/")[1];
    const nameOf = (file: string) => file.slice(file.lastIndexOf("/") + 1);

    return ({ files }) => {
      const byName = new Map<string, SourceFile[]>();
      for (const source of files) {
        const name = nameOf(source.file);
        if (generic.has(name) || /\.test\.tsx?$/.test(name)) continue;
        if (reExportOnly.test(source.contents)) continue;
        byName.set(name, [...(byName.get(name) ?? []), source]);
      }

      const violations: Violation[] = [];
      for (const [name, sources] of byName) {
        if (new Set(sources.map((s) => appOf(s.file))).size < 2) continue;
        violations.push({
          file: name,
          line: 0,
          snippet: sources.map((s) => s.file).join(" + "),
          message: `${name} exists in both apps; move it to a shared package and re-export it`
        });
      }
      return violations;
    };
  }
});
