// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./sources/migrations";

// A check whose message tells a developer to edit a list names the file the
// list is in, as a string. Nothing else ties that string to the file, so a
// renamed or moved check would keep sending people to a path that is gone.
describe("a check that names a file of this package", () => {
  const root = repoRoot();
  const conformance = join(root, "packages/checks/src/conformance");
  const named = readdirSync(conformance, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .flatMap((file) =>
      [
        ...readFileSync(join(conformance, file), "utf8").matchAll(
          /packages\/checks\/src\/[\w./-]+\.(?:ts|json)/g
        )
      ].map((match) => [file, match[0]] as const)
    );

  it("finds the checks that do", () => {
    expect(named.length).toBeGreaterThan(0);
  });

  it.each(named)("%s names %s, which exists", (_file, path) => {
    expect(existsSync(join(root, path))).toBe(true);
  });
});
