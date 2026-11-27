// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noNumericPrecision } from "./no-numeric-precision";

describe("noNumericPrecision", () => {
  it("flags NUMERIC(x,y)", () => {
    const v = noNumericPrecision.scan(
      "a.sql",
      "CREATE TABLE t (amount NUMERIC(18, 4) NOT NULL);"
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(1);
    expect(v[0]?.snippet.toLowerCase().replace(/\s/g, "")).toBe(
      "numeric(18,4)"
    );
  });

  it("allows bare NUMERIC", () => {
    const v = noNumericPrecision.scan(
      "a.sql",
      "CREATE TABLE t (amount NUMERIC NOT NULL);"
    );
    expect(v).toHaveLength(0);
  });

  it("reports the correct line across multiple lines", () => {
    const sql = [
      "CREATE TABLE t (",
      "id uuid,",
      "price NUMERIC(10,2),",
      "qty NUMERIC);"
    ].join("\n");
    const v = noNumericPrecision.scan("a.sql", sql);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(3);
  });

  it("reads a function's arguments, its declared variables and its body", () => {
    const sql = [
      "CREATE FUNCTION f(a NUMERIC(10,2)) RETURNS void LANGUAGE plpgsql AS $$",
      "DECLARE",
      "  total NUMERIC(12, 4);",
      "BEGIN",
      "  PERFORM g(a::decimal(5,2));",
      "END $$;"
    ].join("\n");
    expect(
      noNumericPrecision.scan("a.sql", sql).map((v) => [v.line, v.snippet])
    ).toEqual([
      [1, "NUMERIC(10,2)"],
      [3, "NUMERIC(12,4)"],
      [5, "NUMERIC(5,2)"]
    ]);
  });

  it("ignores a type named in a comment or a string", () => {
    const sql = "-- was NUMERIC(10,2)\nSELECT 'NUMERIC(10,2)';";
    expect(noNumericPrecision.scan("a.sql", sql)).toHaveLength(0);
  });
});
