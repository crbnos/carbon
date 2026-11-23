// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { httpDevFormatter } from "./http-formatter";

// Colours are cosmetic; assert the text a developer reads.
function format(properties: Record<string, unknown>) {
  const line = httpDevFormatter({
    category: ["carbon", "http"],
    level: "debug",
    message: ["access log"],
    rawMessage: "access log",
    timestamp: Date.now(),
    properties
  } as never);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI escapes
  return line.replace(/\x1b\[\d+m/g, "").trimEnd();
}

const access = { method: "GET", pathname: "/dashboard", status: 200 };

describe("httpDevFormatter", () => {
  it("prefixes a time-only clock, level, pid and the module without its carbon root", () => {
    const line = format(access);
    expect(line).toMatch(
      new RegExp(
        `^\\[\\d{2}:\\d{2}:\\d{2}\\.\\d{3}\\] DEBUG \\(${process.pid}\\): \\[http\\] `
      )
    );
  });

  it("renders an access log as method, status, path with query, and duration", () => {
    expect(
      format({ ...access, search: "?ref=home", responseTime: 12.34 })
    ).toContain("GET 200 /dashboard?ref=home 12.3 ms");
  });

  it.each([
    [12.36, "12.3 ms"],
    [5, "5 ms"]
  ])("truncates a %f ms response time to %s", (responseTime, expected) => {
    expect(format({ ...access, responseTime })).toMatch(
      new RegExp(` ${expected.replace(".", "\\.")}$`)
    );
  });

  it("omits the duration when the response time is absent", () => {
    expect(format(access)).toMatch(/GET 200 \/dashboard$/);
  });

  it("falls back to the rendered message for a record that is not an access log", () => {
    expect(format({ note: "not an access log" })).toMatch(/ access log$/);
  });
});
