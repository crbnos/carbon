import { describe, expect, it } from "vitest";
import { redactForLog, redactText } from "./ledger";

describe("redactForLog", () => {
  it("passes through ordinary scalar values unchanged", () => {
    expect(redactForLog(42)).toBe(42);
    expect(redactForLog(true)).toBe(true);
    expect(redactForLog(null)).toBeNull();
    expect(redactForLog("hello")).toBe("hello");
  });

  it("replaces secret key values with [REDACTED]", () => {
    const input = {
      amount: 5000,
      token: "abc123",
      apikey: "sk-live-...",
      client_secret: "s3cr3t",
      bearer: "eyJ...",
      password: "hunter2"
    };
    const result = redactForLog(input) as Record<string, unknown>;
    expect(result.amount).toBe(5000);
    expect(result.token).toBe("[REDACTED]");
    expect(result.apikey).toBe("[REDACTED]");
    expect(result.client_secret).toBe("[REDACTED]");
    expect(result.bearer).toBe("[REDACTED]");
    expect(result.password).toBe("[REDACTED]");
  });

  it("keeps the key present (not dropped) when redacting", () => {
    const result = redactForLog({ secret: "x" }) as Record<string, unknown>;
    expect("secret" in result).toBe(true);
    expect(result.secret).toBe("[REDACTED]");
  });

  it("does not redact innocent keys that share a substring", () => {
    const result = redactForLog({
      itemKey: "item_abc",
      authorizedBy: "user1",
      name: "John"
    }) as Record<string, unknown>;
    expect(result.itemKey).toBe("item_abc");
    expect(result.authorizedBy).toBe("user1");
    expect(result.name).toBe("John");
  });

  it("redacts nested objects recursively", () => {
    const result = redactForLog({
      config: { apiKey: "live_abc", retries: 3 }
    }) as Record<string, Record<string, unknown>>;
    expect(result.config?.apiKey).toBe("[REDACTED]");
    expect(result.config?.retries).toBe(3);
  });

  it("redacts inside arrays", () => {
    const result = redactForLog([{ password: "pw", name: "a" }]) as Array<
      Record<string, unknown>
    >;
    expect(result[0]?.password).toBe("[REDACTED]");
    expect(result[0]?.name).toBe("a");
  });

  it("truncates strings over 4096 characters", () => {
    const long = "x".repeat(5000);
    const result = redactForLog(long) as string;
    expect(result.startsWith("x".repeat(4096))).toBe(true);
    expect(result).toContain("904 more characters");
  });

  it("leaves strings at exactly 4096 characters untouched", () => {
    const exact = "y".repeat(4096);
    expect(redactForLog(exact)).toBe(exact);
  });
});

describe("redactText", () => {
  it("returns null for null/undefined", () => {
    expect(redactText(null)).toBeNull();
    expect(redactText(undefined)).toBeNull();
  });

  it("passes through short strings unchanged", () => {
    expect(redactText("An error occurred")).toBe("An error occurred");
  });

  it("truncates long strings", () => {
    const long = "e".repeat(5000);
    const result = redactText(long);
    expect(result?.length).toBeLessThan(5000);
    expect(result).toContain("more characters");
  });
});
