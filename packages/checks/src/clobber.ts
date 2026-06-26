import type { Violation } from "./check";

export type SourceFile = { file: string; contents: string };

/** Patterns that identify a FULL redefinition of a DB object. Add a row to grow coverage. */
const OBJECT_PATTERNS: { kind: string; re: RegExp }[] = [
  {
    kind: "view",
    re: /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?"?([a-zA-Z0-9_]+)"?/gi
  },
  {
    kind: "function",
    re: /create\s+or\s+replace\s+function\s+"?([a-zA-Z0-9_]+)"?/gi
  },
  {
    kind: "event-trigger",
    re: /attach_event_trigger\(\s*'([a-zA-Z0-9_]+)'/gi
  }
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
