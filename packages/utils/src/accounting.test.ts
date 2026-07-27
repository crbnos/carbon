import { describe, expect, it } from "vitest";
import {
  getDocumentReadableId,
  getDraftDocumentPlaceholder
} from "./accounting";

describe("getDraftDocumentPlaceholder", () => {
  it("uses the last 6 characters of the internal id", () => {
    expect(getDraftDocumentPlaceholder("je_abc123def456")).toBe("Draft-def456");
  });

  it("returns the whole id when it is shorter than 6 characters", () => {
    expect(getDraftDocumentPlaceholder("ab12")).toBe("Draft-ab12");
  });
});

describe("getDocumentReadableId", () => {
  it("returns the assigned number when the document is posted", () => {
    expect(getDocumentReadableId("JE-2026-07-000124", "je_abc123def456")).toBe(
      "JE-2026-07-000124"
    );
  });

  it("falls back to the draft placeholder when the number is null", () => {
    expect(getDocumentReadableId(null, "je_abc123def456")).toBe("Draft-def456");
  });

  it("falls back to the draft placeholder when the number is undefined", () => {
    expect(getDocumentReadableId(undefined, "pay_00000099zzzz")).toBe(
      "Draft-99zzzz"
    );
  });

  it("falls back to the draft placeholder for an empty string", () => {
    // An empty string is not a legal number — treat it as unassigned.
    expect(getDocumentReadableId("", "inv_123456")).toBe("Draft-123456");
  });

  it("falls back to the draft placeholder for a whitespace-only string", () => {
    expect(getDocumentReadableId("   ", "inv_123456")).toBe("Draft-123456");
  });
});
