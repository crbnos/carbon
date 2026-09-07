import { describe, expect, it } from "vitest";
import { noDefaultOnEffects } from "./no-default-on-effects";

describe("no-default-on-effects", () => {
  it("flags .default() after a transform", () => {
    const src = `const v = z.string().transform(Number).default(5);`;
    const violations = noDefaultOnEffects.scan("a.ts", src);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(1);
  });

  it("flags .default() on a z.preprocess pipe", () => {
    const src = `const v = z.preprocess((s) => String(s).trim(), z.string()).default(" padded ");`;
    expect(noDefaultOnEffects.scan("a.ts", src)).toHaveLength(1);
  });

  it("flags .default() after refine and pipe across a multi-line chain", () => {
    const src = [
      "const v = z",
      "  .object({ a: z.string() })",
      "  .refine((d) => d.a.length > 0)",
      "  .default({ a: 'x' });",
      "const w = z.string().pipe(z.coerce.number()).default(1);"
    ].join("\n");
    const violations = noDefaultOnEffects.scan("a.ts", src);
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.line)).toEqual([4, 5]);
  });

  it("allows .default() on plain schemas, records, and coercions", () => {
    const src = [
      `const a = z.string().default("x");`,
      `const b = z.record(z.string(), z.number().min(0)).default({});`,
      `const c = z.coerce.boolean().default(false);`,
      `const d = z.enum(values).default("Draft");`
    ].join("\n");
    expect(noDefaultOnEffects.scan("a.ts", src)).toHaveLength(0);
  });

  it("allows .prefault() on effect-bearing schemas (that is the fix)", () => {
    const src = `const v = z.object({ a: z.string().default("x") }).prefault({});`;
    expect(noDefaultOnEffects.scan("a.ts", src)).toHaveLength(0);
  });

  it("does not cross into a previous statement's effects", () => {
    // The receiver walk stops at the statement boundary, so a transform in an
    // earlier statement never taints an innocent .default().
    const src = [
      `const other = z.string().transform(Number);`,
      `const v = z.string().default("x");`
    ].join("\n");
    expect(noDefaultOnEffects.scan("a.ts", src)).toHaveLength(0);
  });

  it("stops at a block boundary instead of leaking a previous block", () => {
    const src = [
      "if (x) { register(z.string().transform(Number)); }",
      `return z.string().default("x");`
    ].join("\n");
    expect(noDefaultOnEffects.scan("a.ts", src)).toHaveLength(0);
  });

  it("flags an inner-shape transform too — the default bypasses it as well", () => {
    // `.default({a: 1})` on this object returns the literal as-is; the shape's
    // transform never runs on it. That is the same v4 bypass, so it counts.
    const src = `const v = z.object({ a: z.string().transform(Number) }).default({ a: 1 });`;
    expect(noDefaultOnEffects.scan("a.ts", src)).toHaveLength(1);
  });

  it("uses the trimmed .default line as the snippet", () => {
    const src = [
      "const v = z.string().transform(Number)",
      "  .default(5);"
    ].join("\n");
    const [violation] = noDefaultOnEffects.scan("a.ts", src);
    expect(violation?.snippet).toBe(".default(5);");
    expect(violation?.line).toBe(2);
  });
  it("ignores a chain written inside a string literal", () => {
    const src = `const msg = "use z.string().transform(f).default(1) instead";`;
    expect(noDefaultOnEffects.scan("a.ts", src)).toHaveLength(0);
  });

  it("ignores a chain written inside a comment", () => {
    const src = [
      "// z.string().transform(Number).default(5) is the bad shape",
      "/* also z.string().transform(Number).default(5) */",
      "const v = z.string();"
    ].join("\n");
    expect(noDefaultOnEffects.scan("a.ts", src)).toHaveLength(0);
  });

  it("still flags a violation when a comment sits between the effect and .default()", () => {
    // Regression: `receiverBefore` stops at `/`, so an unmasked comment here
    // hid the violation entirely — the silent direction.
    const src = [
      "const v = z.string().transform(Number)",
      "  // explain the default",
      "  .default(5);"
    ].join("\n");
    expect(noDefaultOnEffects.scan("a.ts", src)).toHaveLength(1);
  });

  it("reports the real line number despite a preceding block comment", () => {
    const src = [
      "/* a",
      "   multi-line",
      "   comment */",
      "const v = z.string().transform(Number).default(5);"
    ].join("\n");
    const [violation] = noDefaultOnEffects.scan("a.ts", src);
    expect(violation?.line).toBe(4);
  });
});
