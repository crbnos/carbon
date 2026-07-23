import { describe, expect, it } from "vitest";
import { parseJobFilePath } from "./supabase";

describe("parseJobFilePath", () => {
  it("parses the legacy flat path", () => {
    expect(parseJobFilePath("co123/job/op456/photo.png")).toEqual({
      companyId: "co123",
      operationId: "op456"
    });
  });

  it("parses the nested step-record path", () => {
    expect(
      parseJobFilePath(
        "co123/job/op456/step789/aBcD-123/Screenshot 2026-07-23 at 12.37.45 AM.png"
      )
    ).toEqual({
      companyId: "co123",
      operationId: "op456"
    });
  });

  it("rejects non-job paths", () => {
    expect(parseJobFilePath("co123/parts/item1/file.png")).toBeNull();
  });

  it("rejects paths without a file segment", () => {
    expect(parseJobFilePath("co123/job/op456")).toBeNull();
    expect(parseJobFilePath("co123/job/op456/")).toBeNull();
  });

  it("rejects empty segments", () => {
    expect(parseJobFilePath("co123/job/op456//file.png")).toBeNull();
    expect(parseJobFilePath("/job/op456/file.png")).toBeNull();
  });

  it("rejects empty and undefined input", () => {
    expect(parseJobFilePath(undefined)).toBeNull();
    expect(parseJobFilePath("")).toBeNull();
  });
});
