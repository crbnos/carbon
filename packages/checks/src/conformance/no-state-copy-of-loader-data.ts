// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

// `useState(initial)` reads `initial` once. Seeded from loader or route data,
// the state is a copy that no reload updates: a quote's totals kept a deleted
// line until the page was reloaded, because they were summed from lines copied
// into state at mount. Loaded data changes under a mounted component all the
// time (a save's revalidation, a realtime reload, a layout that reloads after
// its page mounts).
//
// What to write instead:
// - a value computed from the data: compute it during render (`useMemo`);
// - the user's own choices over the data: keep only the choices in state and
//   combine them with the current data during render;
// - a draft the user edits: render it in a component keyed on what it drafts.
//
// This sees only a hook result used by name in the same file. A copy seeded
// from a prop is not found.
const SOURCE =
  /const\s+(\{[^}]*\}|\w+)\s*=\s*use(?:LoaderData|RouteData|RouteLoaderData)\b/g;
const STATE = /\buseState\s*(?:<[^;(]*?>)?\s*\(/g;

function boundNames(pattern: string): string[] {
  if (!pattern.startsWith("{")) return [pattern];
  return pattern
    .slice(1, -1)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      part
        .replace(/^\.\.\./, "")
        .split(":")
        .pop()!
        .split("=")[0]!
        .trim()
    )
    .filter((name) => /^\w+$/.test(name));
}

/** The text between the parenthesis at `open` and its match. */
function argument(contents: string, open: number): string {
  let depth = 0;
  for (let i = open; i < contents.length && i < open + 2000; i++) {
    const char = contents[i];
    if (char === "(") depth++;
    else if (char === ")" && --depth === 0) return contents.slice(open + 1, i);
  }
  return "";
}

export const noStateCopyOfLoaderData: ConformanceCheck = {
  id: "no-state-copy-of-loader-data",
  description:
    "state must not be seeded from loader or route data: it is a copy no reload updates",
  provenance: {
    deprecates: "useState(valueFrom(useLoaderData() | useRouteData()))",
    replacedBy:
      "a value computed during render, or a component keyed on what it drafts",
    since: "2026-10-06"
  },
  scan(file: string, contents: string): Violation[] {
    if (!file.endsWith(".tsx")) return [];
    const names = [...contents.matchAll(SOURCE)].flatMap((match) =>
      boundNames(match[1]!)
    );
    if (names.length === 0) return [];
    const used = new RegExp(`(?<![.\\w])(?:${names.join("|")})\\b(?!\\s*:)`);

    const violations: Violation[] = [];
    for (const match of contents.matchAll(STATE)) {
      const open = match.index + match[0].length - 1;
      const initial = argument(contents, open);
      const name = initial.match(used)?.[0];
      if (!name) continue;
      const line = contents.slice(0, match.index).split("\n").length;
      violations.push({
        file,
        line,
        snippet: contents.split("\n")[line - 1]?.trim() ?? "",
        message: `State seeded from \`${name}\` (loader or route data) is a copy that no reload updates. Compute it during render, or keep only the user's input in state`
      });
    }
    return violations;
  }
};
