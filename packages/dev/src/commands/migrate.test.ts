// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { standaloneServices } from "./migrate.js";

describe("standaloneServices", () => {
  it("boots every crbn-shared service without --serve, as before", () => {
    expect(standaloneServices("shared", false).shared).toEqual([]);
  });

  it("boots only Postgres and Storage of crbn-shared under --serve", () => {
    expect(standaloneServices("shared", true).shared).toEqual([
      "postgres",
      "storage"
    ]);
  });

  it("boots the services migrations write into, then PostgREST and the gateway", () => {
    expect(standaloneServices("shared", true)).toMatchObject({
      migration: ["gotrue", "realtime"],
      api: ["postgrest", "api-gw"]
    });
    expect(standaloneServices("isolated", true)).toMatchObject({
      migration: ["postgres", "gotrue", "storage", "realtime"],
      api: ["postgrest", "api-gw"]
    });
  });

  it("boots the same worktree services with or without --serve", () => {
    for (const mode of ["shared", "isolated"] as const) {
      const { migration, api } = standaloneServices(mode, false);
      expect(standaloneServices(mode, true)).toMatchObject({ migration, api });
    }
  });
});
