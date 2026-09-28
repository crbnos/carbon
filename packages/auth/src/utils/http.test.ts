import { describe, expect, it } from "vitest";
import { safeRedirect } from "./http";

describe("safeRedirect", () => {
  it("keeps a same-origin path", () => {
    expect(safeRedirect("/x/sales/orders?tab=open", "/x")).toBe(
      "/x/sales/orders?tab=open"
    );
  });

  it.each([
    ["an absolute URL", "https://evil.com"],
    ["a protocol-relative URL", "//evil.com"],
    ["a backslash host", "/\\evil.com"],
    ["a relative path", "x/sales"],
    ["an empty value", ""],
    ["no value", null]
  ])("falls back for %s", (_label, to) => {
    expect(safeRedirect(to, "/x")).toBe("/x");
  });
});
