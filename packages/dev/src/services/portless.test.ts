// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { portlessUpdateAction, staleAliasNames } from "./portless.js";

describe("staleAliasNames", () => {
  const live = new Set([5000]);

  it("returns crbn aliases whose port no live slot owns", () => {
    const routes = [
      { hostname: "erp.gone.dev", port: 4000, pid: 0 },
      { hostname: "api.gone.dev", port: 4001, pid: 0 }
    ];
    expect(staleAliasNames(routes, live)).toEqual(["erp.gone", "api.gone"]);
  });

  it("keeps live routes, running processes and routes crbn did not register", () => {
    const routes = [
      { hostname: "erp.live.dev", port: 5000, pid: 0 },
      { hostname: "erp.running.dev", port: 4000, pid: 1234 },
      { hostname: "myapp.gone.dev", port: 4000, pid: 0 },
      { hostname: "erp.gone.localhost", port: 4000, pid: 0 }
    ];
    expect(staleAliasNames(routes, live)).toEqual([]);
  });
});

describe("portlessUpdateAction", () => {
  it("asks once per newer version in a terminal", () => {
    expect(portlessUpdateAction("0.13.0", "0.16.0", null, true)).toBe("ask");
    // Declined 0.16.0: a note, not the same question every boot.
    expect(portlessUpdateAction("0.13.0", "0.16.0", "0.16.0", true)).toBe(
      "warn"
    );
    expect(portlessUpdateAction("0.13.0", "0.16.1", "0.16.0", true)).toBe(
      "ask"
    );
  });

  it("only warns without a terminal, so a script never upgrades it", () => {
    expect(portlessUpdateAction("0.13.0", "0.16.0", null, false)).toBe("warn");
  });

  it("does nothing when current or when npm gave no answer", () => {
    expect(portlessUpdateAction("0.16.0", "0.16.0", null, true)).toBe("none");
    expect(portlessUpdateAction("0.16.1", "0.16.0", null, true)).toBe("none");
    expect(portlessUpdateAction("0.13.0", null, null, true)).toBe("none");
  });
});
