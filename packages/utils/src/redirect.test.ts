// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, describe, expect, it, vi } from "vitest";
import { redirect, redirectExternal, safePath } from "./redirect";

const location = (response: Response) => response.headers.get("Location");

afterEach(() => vi.restoreAllMocks());

const OFF_ORIGIN: [string, FormDataEntryValue | null][] = [
  ["an absolute URL", "https://evil.com"],
  ["a protocol-relative URL", "//evil.com"],
  ["a backslash host", "/\\evil.com"],
  ["a tab before the second slash", "/\t/evil.com"],
  ["a newline before the second slash", "/\n/evil.com"],
  ["a tab before a backslash", "/\t\\evil.com"],
  ["a relative path", "x/sales"],
  ["a javascript URL", "javascript:alert(1)"],
  ["an empty value", ""],
  ["no value", null]
];

describe("redirect", () => {
  it("goes to a path on this origin", () => {
    const response = redirect("/x/sales/orders?tab=open");
    expect(response.status).toBe(302);
    expect(location(response)).toBe("/x/sales/orders?tab=open");
  });

  it.each(OFF_ORIGIN)("sends %s to the home page", (_label, to) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(location(redirect(to))).toBe("/");
  });

  it("keeps the status and headers it is given", () => {
    const response = redirect("/x", {
      status: 303,
      headers: [
        ["Set-Cookie", "a=1"],
        ["Set-Cookie", "b=2"]
      ]
    });
    expect(response.status).toBe(303);
    expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(redirect("/x", 301).status).toBe(301);
  });
});

describe("redirectExternal", () => {
  it("goes to an http(s) URL", () => {
    expect(location(redirectExternal("https://connect.stripe.com/x"))).toBe(
      "https://connect.stripe.com/x"
    );
  });

  it.each([
    ["a javascript URL", "javascript:alert(1)"],
    ["a data URL", "data:text/html,x"],
    ["a bare path", "/x"]
  ])("sends %s to the home page", (_label, url) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(location(redirectExternal(url))).toBe("/");
  });
});

describe("safePath", () => {
  it("keeps a path on this origin", () => {
    expect(safePath("/x/parts", "/x")).toBe("/x/parts");
  });

  it.each(OFF_ORIGIN)("falls back for %s", (_label, to) => {
    expect(safePath(to, "/x")).toBe("/x");
  });
});
