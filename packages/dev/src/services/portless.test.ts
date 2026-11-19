// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { ownedAliasNames, staleAliasNames } from "./portless.js";

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

describe("ownedAliasNames", () => {
  it("removes every route of the prefix whose aliases reach the stack's ports", () => {
    // `old` is this worktree's branch before a switch; its mail alias points
    // at the shared Inbucket, which no stack owns.
    const routes = [
      { hostname: "api.old.dev", port: 4001, pid: 0 },
      { hostname: "mail.old.dev", port: 54324, pid: 0 },
      { hostname: "api.other.dev", port: 6001, pid: 0 },
      { hostname: "mail.other.dev", port: 54324, pid: 0 },
      { hostname: "api.carbon.dev", port: 4001, pid: 0 }
    ];
    expect(ownedAliasNames(routes, new Set([4001]))).toEqual([
      "api.old",
      "mail.old"
    ]);
  });
});
