import { afterEach, describe, expect, it } from "vitest";
import { ensureLoggingConfigured } from "./config.server";

const CONFIGURED = Symbol.for("carbon.logging.configured");

afterEach(() => {
  delete (globalThis as Record<PropertyKey, unknown>)[CONFIGURED];
});

describe("ensureLoggingConfigured (server)", () => {
  it("configures once and is idempotent", () => {
    expect(() => ensureLoggingConfigured({ level: "debug" })).not.toThrow();
    expect((globalThis as Record<PropertyKey, unknown>)[CONFIGURED]).toBe(true);
    // Second call is a no-op, must not throw (LogTape throws on double-configure
    // without reset).
    expect(() => ensureLoggingConfigured({ level: "info" })).not.toThrow();
  });
});
