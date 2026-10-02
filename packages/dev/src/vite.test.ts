// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { clientOnlyAlias } from "../vite.js";

describe("clientOnlyAlias", () => {
  const plugin = clientOnlyAlias("unpdf/pdfjs", "/stub.mjs") as unknown as {
    applyToEnvironment: (environment: { name: string }) => boolean;
    resolveId: (source: string) => string | undefined;
  };

  it("applies to the client environment only", () => {
    expect(plugin.applyToEnvironment({ name: "client" })).toBe(true);
    expect(plugin.applyToEnvironment({ name: "ssr" })).toBe(false);
    expect(plugin.applyToEnvironment({ name: "ssr_bundle_x" })).toBe(false);
  });

  it("resolves the exact specifier and nothing else", () => {
    expect(plugin.resolveId("unpdf/pdfjs")).toBe("/stub.mjs");
    expect(plugin.resolveId("unpdf")).toBeUndefined();
  });
});
