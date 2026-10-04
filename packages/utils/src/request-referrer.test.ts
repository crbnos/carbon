// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { requestReferrer } from "./headers";

const request = (url: string, headers: Record<string, string>) =>
  new Request(url, { headers });

describe("requestReferrer", () => {
  it("returns the same-origin referer as a relative path", () => {
    expect(
      requestReferrer(
        request("https://app.example.com/x/action", {
          referer: "https://app.example.com/x/part/1/details?tab=a#b"
        })
      )
    ).toBe("/x/part/1/details?tab=a#b");
  });

  it("returns null without a referer", () => {
    expect(requestReferrer(request("https://app.example.com/x", {}))).toBe(
      null
    );
  });

  it("rejects a cross-origin referer", () => {
    expect(
      requestReferrer(
        request("https://app.example.com/x/action", {
          referer: "https://evil.example.net/x/part/1"
        })
      )
    ).toBe(null);
  });

  it("accepts an https referer behind a TLS-terminating proxy", () => {
    // The load balancer ends TLS and forwards over http, so request.url is
    // http while the browser's Referer is https.
    expect(
      requestReferrer(
        request("http://app.example.com/x/action", {
          referer: "https://app.example.com/x/part/1/details",
          "x-forwarded-proto": "https"
        })
      )
    ).toBe("/x/part/1/details");
  });

  it("uses the first hop of a multi-proxy x-forwarded-proto", () => {
    expect(
      requestReferrer(
        request("http://app.example.com/x/action", {
          referer: "https://app.example.com/x/part/1",
          "x-forwarded-proto": "https, http"
        })
      )
    ).toBe("/x/part/1");
  });

  it("still rejects a cross-origin referer when x-forwarded-proto is set", () => {
    expect(
      requestReferrer(
        request("http://app.example.com/x/action", {
          referer: "https://evil.example.net/x/part/1",
          "x-forwarded-proto": "https"
        })
      )
    ).toBe(null);
  });

  it("ignores an x-forwarded-proto that is not http or https", () => {
    expect(
      requestReferrer(
        request("http://app.example.com/x/action", {
          referer: "javascript://app.example.com/x",
          "x-forwarded-proto": "javascript"
        })
      )
    ).toBe(null);
  });
});
