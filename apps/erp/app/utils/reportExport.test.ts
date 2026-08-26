import { describe, expect, it } from "vitest";
import { isReportSourceComplete } from "./reportExport";

describe("isReportSourceComplete", () => {
  it("accepts source arrays below the PostgREST row cap", () => {
    expect(isReportSourceComplete([], new Array(999))).toBe(true);
  });

  it("rejects an export when any source reaches the PostgREST row cap", () => {
    expect(isReportSourceComplete(new Array(999), new Array(1000))).toBe(false);
  });
});
