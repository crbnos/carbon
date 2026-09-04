import { describe, expect, it } from "vitest";
import { compactForLog } from "./retention";

describe("compactForLog", () => {
  it("passes through numbers, booleans, and null unchanged", () => {
    expect(compactForLog(42)).toBe(42);
    expect(compactForLog(true)).toBe(true);
    expect(compactForLog(null)).toBeNull();
  });

  it("truncates a 300-char string to 256 plus a marker", () => {
    const long = "a".repeat(300);
    const result = compactForLog(long) as string;
    expect(result.startsWith("a".repeat(256))).toBe(true);
    expect(result).toContain("44 more characters");
  });

  it("leaves a short string unchanged", () => {
    expect(compactForLog("hello")).toBe("hello");
  });

  it("keeps 5 items and appends a marker for a 7-item array", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7];
    const result = compactForLog(arr) as unknown[];
    expect(result).toHaveLength(6);
    expect(result.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(result[5]).toContain("2 more items");
  });

  it("keeps a short array intact", () => {
    expect(compactForLog([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("keeps 20 object keys and adds a marker for a 25-key object", () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 25; i++) obj[`k${i}`] = i;
    const result = compactForLog(obj) as Record<string, unknown>;
    const keys = Object.keys(result);
    expect(keys).toHaveLength(21);
    expect(result["…"]).toContain("5 more keys");
  });

  it("strips the inline row from an entity RuntimeValue", () => {
    const entity = {
      kind: "entity",
      of: "job",
      id: "job_1",
      row: { name: "Acme Job", orderTotal: 15000 }
    };
    expect(compactForLog(entity)).toEqual({
      kind: "entity",
      of: "job",
      id: "job_1"
    });
  });

  it("returns the depth marker at depth 5", () => {
    const result = compactForLog({
      a: { b: { c: { d: { e: { f: "deep" } } } } }
    });
    const leaf = (result as Record<string, unknown>)?.a;
    function dig(v: unknown, n: number): unknown {
      if (n === 0 || typeof v !== "object" || v === null) return v;
      return dig(Object.values(v as Record<string, unknown>)[0], n - 1);
    }
    expect(dig(leaf, 4)).toBe("… nested value removed");
  });

  it("recurses into nested objects", () => {
    const result = compactForLog({ config: { retries: 3 } }) as Record<
      string,
      unknown
    >;
    expect((result.config as Record<string, unknown>)?.retries).toBe(3);
  });
});
