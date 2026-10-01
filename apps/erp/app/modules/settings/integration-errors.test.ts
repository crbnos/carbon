// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
      ""
    )
}));

import {
  getIntegrationError,
  integrationErrorSearch
} from "./integration-errors";

describe("integration error copy", () => {
  it("resolves every code the Onshape callback can send for the panel", () => {
    for (const code of [
      "write-permission",
      "denied",
      "invalid-state",
      "invalid-response",
      "not-configured",
      "token-exchange",
      "save-failed",
      "unexpected"
    ] as const) {
      expect(getIntegrationError("onshape-v2", code)).toBeDefined();
      expect(integrationErrorSearch("onshape-v2", code)).toBe(
        `?integration=onshape-v2&error=${code}`
      );
    }
  });

  it("gives the panel the public app's copy", () => {
    expect(getIntegrationError("onshape-v2", "not-configured")).toBe(
      getIntegrationError("onshape", "not-configured")
    );
  });

  it("resolves nothing for an unknown integration or code", () => {
    expect(getIntegrationError("onshape-v3", "denied")).toBeUndefined();
    expect(getIntegrationError("onshape-v2", "no-such-code")).toBeUndefined();
  });
});
