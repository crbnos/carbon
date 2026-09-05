import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isFieldOptional } from "./isFieldOptional";

describe("isFieldOptional", () => {
  const schema = z.object({
    requiredName: z.string(),
    optionalName: z.string().optional(),
    defaultedName: z.string().default(""),
    nested: z.object({
      requiredChild: z.string(),
      optionalChild: z.string().optional()
    }),
    optionalNested: z
      .object({
        requiredChild: z.string()
      })
      .optional(),
    items: z.array(
      z.object({
        code: z.string().optional()
      })
    )
  });

  it("returns false for required fields", () => {
    expect(isFieldOptional(schema, "requiredName")).toBe(false);
    expect(isFieldOptional(schema, "nested.requiredChild")).toBe(false);
  });

  it("returns true for optional fields", () => {
    expect(isFieldOptional(schema, "optionalName")).toBe(true);
    expect(isFieldOptional(schema, "defaultedName")).toBe(true);
    expect(isFieldOptional(schema, "nested.optionalChild")).toBe(true);
    expect(isFieldOptional(schema, "optionalNested.requiredChild")).toBe(true);
    expect(isFieldOptional(schema, "items[0].code")).toBe(true);
  });

  it("returns undefined when field path is not in schema", () => {
    expect(isFieldOptional(schema, "missingField")).toBeUndefined();
    expect(isFieldOptional(schema, "optionalNested.missing")).toBeUndefined();
  });
});
