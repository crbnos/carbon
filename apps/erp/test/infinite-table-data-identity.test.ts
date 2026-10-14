// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `useInfiniteRows` reads a new `data` array as a revalidation: it re-reads
 * every loaded page (up to 20). So a table with `infinite` must pass the
 * loader's array itself, or a memoized one. A copy built in the render body
 * (`const rows = data.map(…)`) is a new array on every render, and every
 * render then refreshes the whole list.
 */

const APP = join(__dirname, "..", "app");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

/** The identifier passed as `data={…}` on a JSX element that has `infinite=`. */
function infiniteDataNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/<Table\b[^>]*?>/gs)) {
    const element = match[0];
    if (!/\binfinite=\{/.test(element)) continue;
    const data = /\bdata=\{\s*([A-Za-z_$][\w$]*)\s*\}/.exec(element);
    if (data) names.push(data[1]);
  }
  return names;
}

/** True when `name` is built in the render body by copying an array. */
function isRenderCopy(source: string, name: string): boolean {
  const copy = new RegExp(
    String.raw`const\s+${name}\s*=\s*(?:[\w$.?]+\s*\.\s*(?:map|filter|slice|concat|toSorted)\s*\(|\[\s*\.\.\.)`
  );
  return copy.test(source);
}

describe("infinite tables pass a stable data array", () => {
  const files = tsxFiles(APP).filter((file) =>
    readFileSync(file, "utf8").includes("infinite={")
  );

  it("finds the infinite tables", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("never passes an array copied during render", () => {
    const offenders = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return infiniteDataNames(source)
        .filter((name) => isRenderCopy(source, name))
        .map((name) => `${relative(APP, file)}: data={${name}}`);
    });
    expect(offenders).toEqual([]);
  });

  it("detects a copy built with .map", () => {
    const source = `
      const rows = data.map((row) => ({ ...row }));
      return <Table data={rows} infinite={{ dataKey: "x", nextCursor }} />;
    `;
    expect(infiniteDataNames(source)).toEqual(["rows"]);
    expect(isRenderCopy(source, "rows")).toBe(true);
  });

  it("accepts a memoized array", () => {
    const source = `
      const rows = useMemo(() => data.map((row) => ({ ...row })), [data]);
      return <Table data={rows} infinite={{ dataKey: "x", nextCursor }} />;
    `;
    expect(isRenderCopy(source, "rows")).toBe(false);
  });
});
