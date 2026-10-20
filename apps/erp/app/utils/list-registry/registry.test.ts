// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The registry's module files import the module barrels, which cannot load in
 * a unit test, so this test reads the files as text.
 */

const DIR = __dirname;
const moduleFiles = readdirSync(DIR).filter(
  (file) =>
    file.endsWith(".server.ts") &&
    file !== "index.server.ts" &&
    file !== "load.server.ts"
);
const index = readFileSync(join(DIR, "index.server.ts"), "utf8");

describe("list registry files", () => {
  // The module files are merged with spreads, so a key in two files would
  // silently drop one list.
  it("uses each list key once", () => {
    const seen = new Map<string, string>();
    for (const file of moduleFiles) {
      const source = readFileSync(join(DIR, file), "utf8");
      for (const match of source.matchAll(/^\s+key: "([^"]+)",$/gm)) {
        const key = match[1];
        expect(seen.get(key), `"${key}" in ${file}`).toBeUndefined();
        seen.set(key, file);
      }
    }
    expect(seen.has("sales-orders")).toBe(true);
  });

  it("merges every module file into the registry", () => {
    for (const file of moduleFiles) {
      const name = `${file.replace(".server.ts", "")}Lists`;
      expect(index, `${name} from ${file}`).toContain(`...${name}`);
    }
  });
});
