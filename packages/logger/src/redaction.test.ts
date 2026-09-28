import type { LogRecord, Sink } from "@logtape/logtape";
import { redactByField } from "@logtape/redaction";
import { describe, expect, it } from "vitest";
import {
  isSensitiveKey,
  maskRedactedField,
  REDACT_FIELD_PATTERNS,
  REDACTED
} from "./redaction";

function makeRecord(properties: Record<string, unknown>): LogRecord {
  return {
    category: ["carbon", "test"],
    level: "info",
    message: ["msg"],
    rawMessage: "msg",
    timestamp: 0,
    properties
  };
}

describe("REDACT_FIELD_PATTERNS", () => {
  it("keeps the secret-class patterns and drops email/phone/address", () => {
    expect(isSensitiveKey("password")).toBe(true);
    expect(isSensitiveKey("apiToken")).toBe(true);
    expect(isSensitiveKey("clientSecret")).toBe(true);
    // Ordinary ERP business data must stay visible in logs — a hidden `phone`
    // key once made a PGRST204 failure unreconstructable from the log line.
    expect(isSensitiveKey("phone")).toBe(false);
    expect(isSensitiveKey("workPhone")).toBe(false);
    expect(isSensitiveKey("email")).toBe(false);
    expect(isSensitiveKey("addressLine1")).toBe(false);
  });
});

describe("prod sink redaction (redactByField wiring)", () => {
  const captured: LogRecord[] = [];
  const sink: Sink = redactByField((record) => captured.push(record), {
    fieldPatterns: REDACT_FIELD_PATTERNS,
    action: maskRedactedField
  });

  it("masks matched fields instead of deleting them, nested included", () => {
    captured.length = 0;
    sink(
      makeRecord({
        arguments: {
          contact: { firstName: "A", phone: "555", token: "t0p" }
        }
      })
    );
    expect(captured).toHaveLength(1);
    const args = captured[0]!.properties.arguments as {
      contact: Record<string, unknown>;
    };
    // The key survives with a visible marker — a deleted key is
    // indistinguishable from one the caller never sent.
    expect(args.contact.token).toBe(REDACTED);
    expect(args.contact.phone).toBe("555");
    expect(args.contact.firstName).toBe("A");
  });
});
