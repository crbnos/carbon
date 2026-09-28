import { describe, expect, it } from "vitest";
import { parseUserAgent } from "./user-agent";

describe("parseUserAgent", () => {
  it("identifies Chrome on macOS", () => {
    expect(
      parseUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
      )
    ).toEqual({ browser: "Chrome", os: "macOS" });
  });

  it("identifies Safari on iOS (not macOS, despite 'like Mac OS X')", () => {
    expect(
      parseUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
      )
    ).toEqual({ browser: "Safari", os: "iOS" });
  });

  it("identifies Edge on Windows (not Chrome, despite embedded token)", () => {
    expect(
      parseUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0"
      )
    ).toEqual({ browser: "Edge", os: "Windows" });
  });

  it("identifies Firefox on Linux", () => {
    expect(
      parseUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0"
      )
    ).toEqual({ browser: "Firefox", os: "Linux" });
  });

  it("identifies Chrome on Android", () => {
    expect(
      parseUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
      )
    ).toEqual({ browser: "Chrome", os: "Android" });
  });

  it("returns nulls for unrecognized or missing input", () => {
    expect(parseUserAgent("curl/8.4.0")).toEqual({ browser: null, os: null });
    expect(parseUserAgent(null)).toEqual({ browser: null, os: null });
    expect(parseUserAgent(undefined)).toEqual({ browser: null, os: null });
    expect(parseUserAgent("")).toEqual({ browser: null, os: null });
  });
});
