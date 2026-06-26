import { describe, expect, it } from "vitest";
import { noNumericPrecision } from "./no-numeric-precision";

describe("noNumericPrecision", () => {
  it("flags NUMERIC(x,y)", () => {
    const v = noNumericPrecision.scan(
      "a.sql",
      "amount NUMERIC(18, 4) NOT NULL"
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(1);
    expect(v[0]?.snippet.toLowerCase().replace(/\s/g, "")).toBe(
      "numeric(18,4)"
    );
  });

  it("allows bare NUMERIC", () => {
    const v = noNumericPrecision.scan("a.sql", "amount NUMERIC NOT NULL");
    expect(v).toHaveLength(0);
  });

  it("reports the correct line across multiple lines", () => {
    const sql = ["id uuid,", "price NUMERIC(10,2),", "qty NUMERIC"].join("\n");
    const v = noNumericPrecision.scan("a.sql", sql);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(2);
  });

  it("is case-insensitive", () => {
    const v = noNumericPrecision.scan("a.sql", "x numeric(5,2)");
    expect(v).toHaveLength(1);
  });
});
