import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseLogLevel, resolveLevel } from "./levels";

describe("parseLogLevel", () => {
  it("accepts every valid level, case-insensitively", () => {
    expect(parseLogLevel("debug", "info")).toBe("debug");
    expect(parseLogLevel("WARNING", "info")).toBe("warning");
    expect(parseLogLevel("  Error ", "info")).toBe("error");
  });

  it("falls back on unknown/empty without throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseLogLevel("verbose", "info")).toBe("info");
    expect(warn).toHaveBeenCalledOnce();
    expect(parseLogLevel(undefined, "debug")).toBe("debug");
    expect(parseLogLevel(null, "warning")).toBe("warning");
    warn.mockRestore();
  });
});

describe("resolveLevel", () => {
  const original = {
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL
  };

  const restore = (
    key: "NODE_ENV" | "LOG_LEVEL",
    value: string | undefined
  ) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  beforeEach(() => {
    delete process.env.LOG_LEVEL;
  });
  afterEach(() => {
    restore("NODE_ENV", original.NODE_ENV);
    restore("LOG_LEVEL", original.LOG_LEVEL);
  });

  it("defaults by runtime + NODE_ENV", () => {
    process.env.NODE_ENV = "development";
    expect(resolveLevel("server")).toBe("debug");
    expect(resolveLevel("browser")).toBe("debug");

    process.env.NODE_ENV = "production";
    expect(resolveLevel("server")).toBe("info");
    expect(resolveLevel("browser")).toBe("warning");
  });

  it("LOG_LEVEL overrides the default", () => {
    process.env.NODE_ENV = "production";
    process.env.LOG_LEVEL = "trace";
    expect(resolveLevel("server")).toBe("trace");
  });
});
