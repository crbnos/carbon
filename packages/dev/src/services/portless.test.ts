// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { staleAliasNames } from "./portless.js";

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
