import { describe, expect, it } from "vitest";
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

  it("skips the ambient requestId and ends with one newline", () => {
    const line = devFormatter(record("Hello", { requestId: "r1" }));
    expect(plain(line)).not.toContain("r1");
    expect(line.endsWith("\n")).toBe(true);
    expect(line.endsWith("\n\n")).toBe(false);
  });
});
