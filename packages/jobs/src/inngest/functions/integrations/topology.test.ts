// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import { describe, expect, it, vi } from "vitest";

// The real module is the `@carbon/ee` BARREL, which validates the whole server
// env at import time (that is why `topology.ts` exists as its own file). The
// resolver itself has its own tests in `@carbon/ee`; what is under test here is
// what this function does with the READ.
vi.mock("@carbon/ee", () => ({
  resolveIntegrationTopology: (rows: unknown[]) => ({ rows })
}));

const { loadIntegrationTopology } = await import("./topology");

function stubClient(result: { data: unknown; error: unknown }) {
  return {
    from: () => ({
      select: () => ({
        eq: async () => result
      })
    })
  } as unknown as ReturnType<typeof getCarbonServiceRole>;
}

describe("loadIntegrationTopology", () => {
  it("throws, naming the company, when the integration read fails", async () => {
    // An empty topology means no ledger delegation, so a swallowed read error
    // let TWO providers push the same AP documents. "Carbon could not ask" is
    // not "nobody owns it" — fail the caller's step and let Inngest retry.
    await expect(
      loadIntegrationTopology(
        stubClient({ data: null, error: { message: "connection reset" } }),
        "co_1"
      )
    ).rejects.toThrow(/co_1.*connection reset/);
  });

  it("resolves an empty topology only when the read really came back empty", async () => {
    await expect(
      loadIntegrationTopology(stubClient({ data: [], error: null }), "co_1")
    ).resolves.toEqual({ rows: [] });
  });
});
