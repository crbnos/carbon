// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { NonRetriableError } from "inngest";
import { describe, expect, it, vi } from "vitest";

// Both connect at import time (Supabase, Redis); neither is called here.
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn()
}));
vi.mock("@carbon/ee/onshape", () => ({ getOnshapeClient: vi.fn() }));

const { AssemblerJobError } = await import("../tasks/assembler-client");
const { isExportTooLarge, stagedModelFromFetch } = await import(
  "./onshape-fetch"
);

const STAGED = "company/models/onshape-fetch-model-t.step";

describe("stagedModelFromFetch", () => {
  it("reports the staged path, size and content hash", () => {
    expect(
      stagedModelFromFetch(
        { contentHash: "xxh3-hash", outputs: { raw: { bytes: 13 } } },
        STAGED
      )
    ).toEqual({ stagedPath: STAGED, size: 13, contentHash: "xxh3-hash" });
  });

  it("reads a missing size as zero", () => {
    expect(stagedModelFromFetch({ contentHash: "h" }, STAGED).size).toBe(0);
  });

  it.each([null, {}, { outputs: { raw: { bytes: 13 } } }])(
    "fails for good when the job reports no content hash: %j",
    (result) => {
      expect(() => stagedModelFromFetch(result, STAGED)).toThrow(
        NonRetriableError
      );
    }
  );
});

describe("isExportTooLarge", () => {
  it("skips an export the assembler refused as past the limit", () => {
    expect(
      isExportTooLarge(new AssemblerJobError("too large", "LIMIT_EXCEEDED"))
    ).toBe(true);
  });

  it.each([
    new AssemblerJobError("source unreadable", "READ_FAILED"),
    new AssemblerJobError("no code"),
    Object.assign(new Error("lookalike"), { code: "LIMIT_EXCEEDED" })
  ])("rethrows any other failure: %s", (error) => {
    expect(isExportTooLarge(error)).toBe(false);
  });
});
