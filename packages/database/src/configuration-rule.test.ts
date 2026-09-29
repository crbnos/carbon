import { describe, expect, it } from "vitest";
import { runConfigurationRule, transpileRule } from "./configuration-rule";

describe("transpileRule", () => {
  it("wraps the body in configure and strips its types", async () => {
    const javascript = transpileRule(
      "const qty: number = params.qty as number;\nreturn qty * 2;"
    );
    expect(javascript).not.toMatch(/: number|as number|: Params/);
    expect(await runConfigurationRule(javascript, { qty: 21 })).toBe(42);
  });

  it("throws on a syntax error", () => {
    expect(() => transpileRule("return (;")).toThrow();
  });
});
