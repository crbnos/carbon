// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SourceFile, Violation } from "./check";

/**
 * An optional `schema.` qualifier, discarded so `public.foo` and a bare `foo` key as the
 * same object — they ARE the same object, `public` being the default search path. Without
 * this the name group captured the SCHEMA, so every schema-qualified definition keyed as
 * `function:public`: two migrations defining unrelated `public.` functions were reported as
 * a clobber of each other, and two redefinitions of the SAME function were never keyed by
 * its name at all.
 */
const QUALIFIER = String.raw`(?:"?[a-zA-Z0-9_]+"?\s*\.\s*)?`;

/** Patterns that identify a FULL redefinition of a DB object. Add a row to grow coverage. */
const OBJECT_PATTERNS: { kind: string; re: RegExp }[] = [
  {
    kind: "view",
    re: new RegExp(
      String.raw`create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?${QUALIFIER}"?([a-zA-Z0-9_]+)"?`,
      "gi"
    )
  },
  {
    kind: "function",
    re: new RegExp(
      String.raw`create\s+or\s+replace\s+function\s+${QUALIFIER}"?([a-zA-Z0-9_]+)"?`,
      "gi"
    )
  }
  // Event triggers are not listed: a migration may no longer attach one
  // (`no-authz-ddl-in-migrations`). They are declared in the attachments
  // manifest, where two branches changing one table is an ordinary merge.
];

/** The set of `kind:name` objects redefined by a SQL string. */
export function objectRefs(sql: string): Set<string> {
  const refs = new Set<string>();
  for (const { kind, re } of OBJECT_PATTERNS) {
    for (const m of sql.matchAll(re)) {
      if (m[1]) refs.add(`${kind}:${m[1]}`);
    }
  }
  return refs;
}

function refMap(files: SourceFile[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of files) {
    for (const ref of objectRefs(f.contents)) {
      if (!map.has(ref)) map.set(ref, f.file);
    }
  }
  return map;
}

/** Objects redefined on BOTH sides since the merge-base = clobber risk. */
export function findClobbers(
  branch: SourceFile[],
  main: SourceFile[]
): Violation[] {
  const mainRefs = refMap(main);
  const violations: Violation[] = [];
  for (const [ref, branchFile] of refMap(branch)) {
    const mainFile = mainRefs.get(ref);
    if (mainFile) {
      violations.push({
        file: branchFile,
        line: 0,
        snippet: ref,
        message: `Clobber risk: "${ref}" is redefined on this branch (${branchFile}) and on main (${mainFile}) since the merge-base. Rebase and re-fork your redefinition from main's latest version.`
      });
    }
  }
  return violations;
}
