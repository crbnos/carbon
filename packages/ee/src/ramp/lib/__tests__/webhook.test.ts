import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyRampWebhookSignature } from "../webhook";

const secret = "whsec_ramp_test_secret";

const body = JSON.stringify({
  id: "evt_11111111",
  type: "transaction.ready_to_sync",
  business_id: "bus_22222222"
});

function sign(signingSecret: string, payload: string): string {
  return createHmac("sha256", signingSecret).update(payload).digest("base64");
}

describe("verifyRampWebhookSignature", () => {
  it("accepts a valid signature over the raw body", () => {
    expect(
      verifyRampWebhookSignature({
        signature: sign(secret, body),
        body,
        secret
      })
    ).toBe(true);
  });

  it("rejects when the body was tampered with", () => {
    expect(
      verifyRampWebhookSignature({
        signature: sign(secret, body),
        body: body.replace("2222", "3333"),
        secret
      })
    ).toBe(false);
  });

  it("rejects a signature from a different secret", () => {
    expect(
      verifyRampWebhookSignature({
        signature: sign("other-secret", body),
        body,
        secret
      })
    ).toBe(false);
  });

  it("rejects malformed base64 without throwing", () => {
    expect(
      verifyRampWebhookSignature({
        signature: "!!!not-base64!!!",
        body,
        secret
      })
    ).toBe(false);
  });

  it("rejects an empty signature or missing secret", () => {
    expect(verifyRampWebhookSignature({ signature: "", body, secret })).toBe(
      false
    );
    expect(
      verifyRampWebhookSignature({
        signature: sign(secret, body),
        body,
        secret: ""
      })
    ).toBe(false);
  });
});
