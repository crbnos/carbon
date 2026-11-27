// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { repoRoot } from "./migrations";
import { loadSharedTestFixtures, sharedTestWrappers } from "./test-cases";

describe("sharedTestWrappers", () => {
  const fixture = (file: string, contents: string) => ({ file, contents });

  it("finds exported wrappers, a wrapper of another file's wrapper among them", () => {
    expect(
      sharedTestWrappers([
        fixture(
          "b.ts",
          `export const fooTest = (name: string, fn: () => Promise<void>) =>
  barTest(name, fn);`
        ),
        fixture(
          "a.ts",
          `export function barTest(name: string, fn: () => void) {
  it.skipIf(!db)(name, fn, 60_000);
}
function localTest(name: string, fn: () => void) {
  it(name, fn);
}
export function helper(f: Fixture) {
  return f.db;
}`
        )
      ]).sort()
    ).toEqual(["barTest", "fooTest"]);
  });

  it("reads databaseTest and postgrestTest from the real fixtures", () => {
    expect(sharedTestWrappers(loadSharedTestFixtures(repoRoot()))).toEqual(
      expect.arrayContaining(["databaseTest", "postgrestTest"])
    );
  });
});
