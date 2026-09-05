import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { isFieldOptional } from "./isFieldOptional";

// Pins the schema walk that drives each field's required/optional marker.
// The zfd cases matter most: a zfd wrapper is pipe(in: transform, out: schema),
// and walking into the bare transform used to report every optional zfd field
// as required.

describe("isFieldOptional", () => {
  it("reports plain optional / required / default fields", () => {
    const schema = z.object({
      required: z.string().min(1),
      optional: z.string().optional(),
      defaulted: z.string().default("draft"),
      prefaulted: z.string().prefault("draft")
    });
    expect(isFieldOptional(schema, "required")).toBe(false);
    expect(isFieldOptional(schema, "optional")).toBe(true);
    expect(isFieldOptional(schema, "defaulted")).toBe(true);
    expect(isFieldOptional(schema, "prefaulted")).toBe(true);
  });

  it("nullable is not optional", () => {
    const schema = z.object({ n: z.string().nullable() });
    expect(isFieldOptional(schema, "n")).toBe(false);
  });

  it("sees through zfd preprocess pipes to the real schema", () => {
    const schema = z.object({
      id: zfd.text(z.string().optional()),
      name: zfd.text(z.string().min(1)),
      qty: zfd.numeric(z.number().min(0)),
      active: zfd.checkbox()
    });
    expect(isFieldOptional(schema, "id")).toBe(true);
    expect(isFieldOptional(schema, "name")).toBe(false);
    expect(isFieldOptional(schema, "qty")).toBe(false);
    expect(isFieldOptional(schema, "active")).toBe(true);
  });

  it("sees through z.preprocess the same way", () => {
    const schema = z.object({
      reason: z.preprocess(
        (val) => (val === "" ? undefined : val),
        z.enum(["a", "b"]).optional()
      )
    });
    expect(isFieldOptional(schema, "reason")).toBe(true);
  });

  it("resolves nested object and array-element paths", () => {
    const schema = z.object({
      user: z.object({ email: z.string().optional(), name: z.string() }),
      items: z.array(z.object({ label: z.string().optional() }))
    });
    expect(isFieldOptional(schema, "user.email")).toBe(true);
    expect(isFieldOptional(schema, "user.name")).toBe(false);
    expect(isFieldOptional(schema, "items[0].label")).toBe(true);
  });

  it("an optional parent makes every child optional", () => {
    const schema = z.object({
      address: z.object({ city: z.string() }).optional()
    });
    expect(isFieldOptional(schema, "address.city")).toBe(true);
  });

  it("resolves record values and returns undefined for unknown fields", () => {
    const schema = z.object({
      amounts: z.record(z.string(), z.number().optional())
    });
    expect(isFieldOptional(schema, "amounts.anything")).toBe(true);
    expect(isFieldOptional(schema, "nope")).toBeUndefined();
    expect(isFieldOptional(undefined, "x")).toBeUndefined();
  });

  it("resolves lazy schemas without looping", () => {
    type Node = { name?: string; child?: Node };
    const node: z.ZodType<Node> = z.lazy(() =>
      z.object({
        name: z.string().optional(),
        child: node.optional()
      })
    );
    const schema = z.object({ root: node });
    expect(isFieldOptional(schema, "root.name")).toBe(true);
    expect(isFieldOptional(schema, "root.child.name")).toBe(true);
  });
});
