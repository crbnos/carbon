// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { toLinkLabel, toSafeHref } from "./url";

describe("toSafeHref", () => {
  it("returns http and https links", () => {
    expect(toSafeHref("https://www.example.com/parts/SKU-1001")).toBe(
      "https://www.example.com/parts/SKU-1001"
    );
    expect(toSafeHref("http://example.com")).toBe("http://example.com/");
    expect(toSafeHref("HTTPS://Example.com/A")).toBe("https://example.com/A");
    expect(toSafeHref("http://localhost:3000/x")).toBe(
      "http://localhost:3000/x"
    );
  });

  it("adds https to a value with no scheme", () => {
    expect(toSafeHref("www.example.com/parts/SKU-1001")).toBe(
      "https://www.example.com/parts/SKU-1001"
    );
    expect(toSafeHref("example.com")).toBe("https://example.com/");
    expect(toSafeHref("www.example.com:8080/x")).toBe(
      "https://www.example.com:8080/x"
    );
    expect(toSafeHref("//example.com/x")).toBe("https://example.com/x");
    expect(toSafeHref("  example.com/x  ")).toBe("https://example.com/x");
  });

  it("refuses every other scheme", () => {
    for (const value of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "javascript://example.com/%0Aalert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "mailto:someone@example.com",
      "ftp://example.com/file"
    ]) {
      expect(toSafeHref(value), value).toBeNull();
    }
  });

  it("refuses a value that is not a web address", () => {
    for (const value of [
      "",
      "   ",
      "hello",
      "hello world",
      "https://example.com/a b",
      "/x/part/123",
      "https://"
    ]) {
      expect(toSafeHref(value), value).toBeNull();
    }
  });

  it("refuses anything that is not a string", () => {
    for (const value of [null, undefined, 42, true, {}, ["https://a.com"]]) {
      expect(toSafeHref(value)).toBeNull();
    }
  });
});

describe("toLinkLabel", () => {
  it("drops the scheme, a leading www. and a trailing slash", () => {
    expect(toLinkLabel("https://www.example.com/parts/SKU-1001")).toBe(
      "example.com/parts/SKU-1001"
    );
    expect(toLinkLabel("HTTP://WWW.Example.com/")).toBe("Example.com");
    expect(toLinkLabel("  www.example.com/parts/  ")).toBe("example.com/parts");
    expect(toLinkLabel("//example.com/x")).toBe("example.com/x");
  });

  it("keeps the rest of the address as typed", () => {
    expect(toLinkLabel("shop.example.com:8080/a?b=1#c")).toBe(
      "shop.example.com:8080/a?b=1#c"
    );
    expect(toLinkLabel("example.com/www.thing")).toBe("example.com/www.thing");
  });
});
