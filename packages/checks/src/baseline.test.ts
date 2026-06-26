import { describe, expect, it } from "vitest";
import { keyOf, parseBaseline } from "./baseline";
import type { Violation } from "./check";

const v: Violation = {
  file: "x.sql",
  line: 3,
  snippet: "NUMERIC(10,2)",
  message: "deprecated"
};

describe("baseline", () => {
  it("derives a stable key from checkId + file + snippet (line-independent)", () => {
    const a = keyOf("no-numeric-precision", v);
    const b = keyOf("no-numeric-precision", { ...v, line: 99 });
    expect(a).toBe(b);
    expect(a).toBe("no-numeric-precision::x.sql::NUMERIC(10,2)");
  });

  it("parses a baseline JSON array into a Set", () => {
    const set = parseBaseline('["k1","k2"]');
    expect(set.has("k1")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("returns an empty Set for missing/invalid JSON", () => {
    expect(parseBaseline(undefined).size).toBe(0);
    expect(parseBaseline("not json").size).toBe(0);
  });
});
