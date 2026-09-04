import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validator } from "./zod";

// Runtime coverage for the zod adapter under zod v4 — the paths typecheck can't
// prove: `.default()` output semantics, ZodError -> FieldErrors mapping, dotted
// nested paths, and the v4 union-issue shape (`issue.errors`, replacing v3's
// `issue.unionErrors`) that getIssuesForError recurses into.

describe("validator (zod v4 adapter)", () => {
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

  it("recurses into a v4 union issue's sub-errors without crashing", async () => {
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

  it("validateField returns the message for one field only", async () => {
    const schema = z.object({
      name: z.string().min(1, { message: "Name is required" }),
      age: z.number()
    });
    const v = validator(schema);
    const nameErr = await v.validateField({ name: "", age: 1 }, "name");
    expect(nameErr.error).toBe("Name is required");
  });
});
