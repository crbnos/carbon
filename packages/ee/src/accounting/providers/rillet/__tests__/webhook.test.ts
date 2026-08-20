import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildRilletSignedPayload,
  verifyRilletWebhookSignature
} from "../webhook";

const token = Buffer.from("super-secret-webhook-token").toString("base64");

const headers = {
  timestamp: "2026-07-31T12:00:00.000Z",
  id: "6f9619ff-8b86-d011-b42d-00c04fc964ff",
  entity: "invoice",
  event: "payment-updated"
};

const body = JSON.stringify({
  id: "11111111-1111-1111-1111-111111111111",
  invoice_id: "22222222-2222-2222-2222-222222222222"
});

function sign(signingToken: string): string {
  return createHmac("sha256", Buffer.from(signingToken, "base64"))
    .update(buildRilletSignedPayload(headers, body))
    .digest("base64");
}

describe("buildRilletSignedPayload", () => {
  it("dot-joins timestamp, id, entity, event, and the raw body", () => {
    expect(buildRilletSignedPayload(headers, body)).toBe(
      `${headers.timestamp}.${headers.id}.${headers.entity}.${headers.event}.${body}`
    );
  });
});

describe("verifyRilletWebhookSignature", () => {
  it("accepts a valid signature", () => {
    expect(
      verifyRilletWebhookSignature({
        headers: { ...headers, signature: sign(token) },
        body,
        token
      })
    ).toBe(true);
  });

  it("rejects a signature from a different token", () => {
    const otherToken = Buffer.from("rotated-away").toString("base64");
    expect(
      verifyRilletWebhookSignature({
        headers: { ...headers, signature: sign(otherToken) },
        body,
        token
      })
    ).toBe(false);
  });

  it("rejects when the body was tampered with", () => {
    expect(
      verifyRilletWebhookSignature({
        headers: { ...headers, signature: sign(token) },
        body: body.replace("2222", "3333"),
        token
      })
    ).toBe(false);
  });

  it("accepts when any of the comma-separated signatures matches", () => {
    const otherToken = Buffer.from("rotated-away").toString("base64");
    const signature = `${sign(otherToken)}, ${sign(token)}`;
    expect(
      verifyRilletWebhookSignature({
        headers: { ...headers, signature },
        body,
        token
      })
    ).toBe(true);
  });

  it("rejects an empty signature header or missing token", () => {
    expect(
      verifyRilletWebhookSignature({
        headers: { ...headers, signature: "" },
        body,
        token
      })
    ).toBe(false);
    expect(
      verifyRilletWebhookSignature({
        headers: { ...headers, signature: sign(token) },
        body,
        token: ""
      })
    ).toBe(false);
  });

  it("rejects garbage base64 without throwing", () => {
    expect(
      verifyRilletWebhookSignature({
        headers: { ...headers, signature: "!!!not-base64!!!" },
        body,
        token
      })
    ).toBe(false);
  });
});
