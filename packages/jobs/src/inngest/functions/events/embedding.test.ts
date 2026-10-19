// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn()
}));
vi.mock("../../client.js", () => ({
  inngest: { createFunction: () => ({}) }
}));
vi.mock("../../../db", () => ({ getJobDatabaseClient: vi.fn() }));

const { embedInBatches, toEmbeddedText } = await import("./embedding");

describe("toEmbeddedText", () => {
  it("joins the parts and strips what the embedding function would refuse", () => {
    expect(toEmbeddedText(["Bolt", null, "M3\u0000 x\u0007 8"])).toBe(
      "Bolt M3 x 8"
    );
    expect(toEmbeddedText([" \u0007 ", undefined])).toBe("");
  });
});

describe("embedInBatches", () => {
  const records = ["a", "b", "c"].map((id) => ({ id, table: "item" }));

  it("counts a deleted row as done and blank text as a permanent failure", async () => {
    const result = await embedInBatches(
      records,
      new Map([
        ["a", "Bolt"],
        ["b", ""]
      ]),
      async () => undefined
    );
    expect(result.embedded.map((r) => r.id)).toEqual(["c", "a"]);
    expect(result.failed).toEqual([
      { record: records[1], error: "item b has no text", permanent: true }
    ]);
  });

  it("isolates a row that fails its batch, keeping the rest", async () => {
    const texts = new Map(records.map((r) => [r.id, r.id.toUpperCase()]));
    const result = await embedInBatches(records, texts, async (batch) => {
      if (batch.some((r) => r.id === "b")) throw new Error("model refused");
    });
    expect(result.embedded.map((r) => r.id)).toEqual(["a", "c"]);
    expect(result.failed).toEqual([
      { record: records[1], error: "model refused", permanent: false }
    ]);
  });
});
