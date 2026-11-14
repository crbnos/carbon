// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RouterContextProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { addLogContext, runInRequestContext } from "./context.server";
import { devFormatter } from "./dev-formatter";

function record(rawMessage: string, properties: Record<string, unknown>) {
  return {
    category: ["carbon", "auth"],
    level: "error",
    message: [rawMessage],
    rawMessage,
    timestamp: Date.now(),
    properties
  } as never;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI colors
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("devFormatter", () => {
  it("appends an error the message doesn't reference, with its stack", () => {
    const error = new TypeError("Cannot read properties of undefined");
    const line = plain(
      devFormatter(record("Failed to finalize quote", { error }))
    );
    expect(line).toContain("Failed to finalize quote");
    expect(line).toContain("TypeError: Cannot read properties of undefined");
    expect(line).toContain("dev-formatter.test.ts");
  });

  it("does not repeat properties the message already renders", () => {
    const line = plain(
      devFormatter(record("Loaded {count} rows", { count: 3 }))
    );
    expect(line).not.toContain("{ count");
  });

  it("appends only the unreferenced properties", () => {
    const line = plain(
      devFormatter(record("Loaded {count} rows", { count: 3, quoteId: "q1" }))
    );
    expect(line).toContain("quoteId: 'q1'");
    expect(line).not.toContain("count: 3");
  });

  it("treats escaped braces as literal text, not placeholders", () => {
    const line = plain(
      devFormatter(record("Literal {{code}} here", { code: "x1" }))
    );
    expect(line).toContain("code: 'x1'");
  });

  it("skips the ids the request added and ends with one newline", () => {
    const line = runInRequestContext(new RouterContextProvider(), () => {
      addLogContext({ requestId: "r1", companyId: "c1" });
      return devFormatter(
        record("Hello", { requestId: "r1", companyId: "c2" })
      );
    });
    expect(plain(line)).not.toContain("r1");
    expect(plain(line)).toContain("c2");
    expect(line.endsWith("\n")).toBe(true);
    expect(line.endsWith("\n\n")).toBe(false);
  });

  it("shows a job's companyId, which no request added", () => {
    const line = devFormatter(record("Synced", { companyId: "c1" }));
    expect(plain(line)).toContain("c1");
  });
});

describe("devFormatter fallbacks", () => {
  it("prints the plain line when properties are missing", () => {
    const line = devFormatter({
      ...(record("Hello", {}) as object),
      properties: undefined
    } as never);
    expect(plain(line)).toContain("Hello");
  });

  it("prints the plain line when reading a property throws", () => {
    const properties = {
      get broken() {
        throw new Error("boom");
      }
    };
    const line = devFormatter({
      ...(record("Hello", {}) as object),
      properties
    } as never);
    expect(plain(line)).toContain("Hello");
    expect(line.endsWith("\n")).toBe(true);
  });
});
