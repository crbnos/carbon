import { describe, expect, it } from "vitest";
import { unwrapArgsEnvelope } from "./args-envelope";

const flatSchema = {
  type: "object",
  properties: {
    jobOperationIds: { type: "array" },
    locationId: { type: "string" }
  }
};
const wrapperSchema = {
  type: "object",
  properties: { args: { type: "object" } }
};

describe("unwrapArgsEnvelope", () => {
  it("unwraps a lone envelope for a flat-schema operation", () => {
    expect(
      unwrapArgsEnvelope(
        { schema: flatSchema },
        { args: { jobOperationIds: ["jo_1"], locationId: "loc_1" } }
      )
    ).toEqual({ jobOperationIds: ["jo_1"], locationId: "loc_1" });
  });

  it("leaves a flat body alone", () => {
    const body = { jobOperationIds: ["jo_1"], locationId: "loc_1" };
    expect(unwrapArgsEnvelope({ schema: flatSchema }, body)).toBe(body);
  });

  it("leaves the envelope in place when the operation declares args", () => {
    const body = { args: { limit: 10 } };
    expect(unwrapArgsEnvelope({ schema: wrapperSchema }, body)).toBe(body);
  });

  it("does not unwrap when args sits beside another key", () => {
    const body = { args: { limit: 10 }, jobId: "job_1" };
    expect(unwrapArgsEnvelope({ schema: flatSchema }, body)).toBe(body);
  });

  it("does not unwrap a non-object envelope", () => {
    for (const value of [null, ["jo_1"], "jobId"]) {
      const body: Record<string, unknown> = { args: value };
      expect(unwrapArgsEnvelope({ schema: flatSchema }, body)).toBe(body);
    }
  });

  it("passes undefined through", () => {
    expect(
      unwrapArgsEnvelope({ schema: flatSchema }, undefined)
    ).toBeUndefined();
  });
});
