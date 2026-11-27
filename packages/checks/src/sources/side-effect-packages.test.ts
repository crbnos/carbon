// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { declaresSideEffects } from "./side-effect-packages";

describe("declaresSideEffects", () => {
  it("matches a path, a glob, and a bare file name anywhere", () => {
    expect(declaresSideEffects(["./src/shims.ts"], "src/shims.ts")).toBe(true);
    expect(declaresSideEffects(["src/*.css"], "src/a.css")).toBe(true);
    expect(declaresSideEffects(["shims.ts"], "src/deep/shims.ts")).toBe(true);
    expect(declaresSideEffects(["./src/shims.ts"], "src/other.ts")).toBe(false);
    expect(declaresSideEffects(false, "src/shims.ts")).toBe(false);
  });
});
