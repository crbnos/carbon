// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { jsonSchemaInput } from "./schema";

const validate = (schema: Record<string, unknown>, value: unknown) =>
  jsonSchemaInput(schema)["~standard"].validate(value) as
    | { value: unknown }
    | { issues: unknown[] };

describe("jsonSchemaInput", () => {
  // The generator publishes a nullable enum with null among its values: a
  // `type` of ["string", "null"] alone leaves the enum refusing null.
  const level = {
    type: "object",
    properties: {
      level: { type: ["string", "null"], enum: ["I", "II", null] }
    }
  };

  it("takes null for a nullable enum listed with null", () => {
    expect(validate(level, { level: null })).toEqual({
      value: { level: null }
    });
  });

  it("still refuses a value the enum does not list", () => {
    expect("issues" in validate(level, { level: "IV" })).toBe(true);
  });
});
