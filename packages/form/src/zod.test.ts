import { assert, describe, expect, it } from "vitest";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { validator } from "./zod";

// Runtime coverage for the zod adapter — the paths typecheck can't prove:
// `.default()` output semantics, ZodError -> FieldErrors mapping, dotted and
// array-indexed paths, the union-issue shape (`issue.errors`) that
// getIssuesForError recurses into, and the FormData -> object preprocessing a
// route action's `validator(schema).validate(formData)` relies on.

describe("validator (zod adapter)", () => {
  it("parses a valid value and applies a default", async () => {
    const schema = z.object({
      name: z.string().min(1),
      active: z.boolean().default(true)
    });
    const result = await validator(schema).validate({ name: "hi" });
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ name: "hi", active: true });
  });

  it("maps an invalid field to a FieldErrors entry keyed by path", async () => {
    const schema = z.object({
      name: z.string().min(1, { message: "Name is required" })
    });
    const result = await validator(schema).validate({ name: "" });
    expect(result.data).toBeUndefined();
    expect(result.error?.fieldErrors?.name).toBe("Name is required");
  });

  it("surfaces a nested field error at a dotted path", async () => {
    const schema = z.object({
      user: z.object({ email: z.email({ message: "Bad email" }) })
    });
    const result = await validator(schema).validate({
      user: { email: "nope" }
    });
    expect(result.error?.fieldErrors?.["user.email"]).toBe("Bad email");
  });

  it("keys an array element error with an index path", async () => {
    const schema = z.object({
      items: z.array(
        z.object({ name: z.string().min(1, { message: "Required" }) })
      )
    });
    const result = await validator(schema).validate({
      items: [{ name: "ok" }, { name: "" }]
    });
    expect(result.error?.fieldErrors?.["items[1].name"]).toBe("Required");
  });

  it("recurses into a union issue's sub-errors without crashing", async () => {
    const schema = z.object({
      val: z.union([z.string().min(3), z.number()])
    });
    // "ab" fails both members -> an invalid_union issue carrying `errors`.
    const result = await validator(schema).validate({ val: "ab" });
    expect(result.data).toBeUndefined();
    expect(Object.keys(result.error?.fieldErrors ?? {}).length).toBeGreaterThan(
      0
    );
  });

  it("surfaces a discriminated-union branch error at its own path", async () => {
    const schema = z.object({
      op: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("email"), address: z.email() }),
        z.object({ kind: z.literal("phone"), number: z.string().min(7) })
      ])
    });
    const result = await validator(schema).validate({
      op: { kind: "email", address: "nope" }
    });
    expect(result.data).toBeUndefined();
    expect(result.error?.fieldErrors?.["op.address"]).toBeDefined();
  });

  it("validateField returns the message for one field only", async () => {
    const schema = z.object({
      name: z.string().min(1, { message: "Name is required" }),
      age: z.number()
    });
    const v = validator(schema);
    assert(v.validateField);
    const nameErr = await v.validateField({ name: "", age: 1 }, "name");
    expect(nameErr.error).toBe("Name is required");
  });

  it("validateField resolves a nested dotted path", async () => {
    const schema = z.object({
      user: z.object({ email: z.email({ message: "Bad email" }) }),
      name: z.string()
    });
    const v = validator(schema);
    assert(v.validateField);
    const err = await v.validateField(
      { user: { email: "nope" }, name: "ok" },
      "user.email"
    );
    expect(err.error).toBe("Bad email");
    const clean = await v.validateField(
      { user: { email: "nope" }, name: "ok" },
      "name"
    );
    expect(clean.error).toBeUndefined();
  });
});

describe("validator with FormData (the route-action path)", () => {
  const schema = z.object({
    id: zfd.text(z.string().optional()),
    name: z.string().min(1, { message: "Name is required" }),
    quantity: zfd.numeric(z.number().min(0)),
    isActive: zfd.checkbox(),
    tags: zfd.repeatableOfType(z.string()).optional()
  });

  it("coerces zfd fields from a real FormData submission", async () => {
    const fd = new FormData();
    fd.append("name", "Widget");
    fd.append("quantity", "42");
    fd.append("tags", "a");
    fd.append("tags", "b");
    // id omitted, isActive unchecked (absent)
    const result = await validator(schema).validate(fd);
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({
      name: "Widget",
      quantity: 42,
      isActive: false,
      tags: ["a", "b"]
    });
  });

  it("treats a checked checkbox's 'on' as true", async () => {
    const fd = new FormData();
    fd.append("name", "Widget");
    fd.append("quantity", "1");
    fd.append("isActive", "on");
    const result = await validator(schema).validate(fd);
    expect(result.data?.isActive).toBe(true);
  });

  it("maps an empty required text field to its error", async () => {
    const fd = new FormData();
    fd.append("name", "");
    fd.append("quantity", "1");
    const result = await validator(schema).validate(fd);
    expect(result.error?.fieldErrors?.name).toBe("Name is required");
  });
});
