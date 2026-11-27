// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../../sources/migrations";
import { routeMapsToPage } from "./route-maps-to-page";

describe("routeMapsToPage", () => {
  it("flags an UNPAGED_ROUTES entry that matches no route, in this check's own file", () => {
    const stale = routeMapsToPage
      .find({ routes: [] })
      .filter((v) => v.snippet === "/x/print")
      .map(({ file, snippet }) => [file, snippet]);
    expect(stale).toEqual([
      [
        "packages/checks/src/conformance/authz/route-maps-to-page.ts",
        "/x/print"
      ]
    ]);
    expect(existsSync(join(repoRoot(), stale[0]?.[0] ?? ""))).toBe(true);
  });
});
