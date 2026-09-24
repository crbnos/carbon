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

describe("signature encoding tolerance", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({
    type: "webhooks.verification",
    challenge: "abc"
  });
  const digest = createHmac("sha256", secret).update(body).digest();

  it("accepts a HEX digest", () => {
    // The encoding Ramp's own docs example uses (`.digest("hex")`). Base64-only
    // verification rejects this: 64 hex chars decode to 48 bytes, not 32, so the
    // length guard fails and EVERY delivery 401s — including the activation
    // challenge, which is why the endpoint could never leave "Pending
    // verification".
    expect(
      verifyRampWebhookSignature({
        signature: digest.toString("hex"),
        body,
        secret
      })
    ).toBe(true);
  });

  it("still accepts a BASE64 digest", () => {
    expect(
      verifyRampWebhookSignature({
        signature: digest.toString("base64"),
        body,
        secret
      })
    ).toBe(true);
  });

  it.each(["sha256=", "v1,", "v1="])("tolerates a %s prefix", (prefix) => {
    expect(
      verifyRampWebhookSignature({
        signature: `${prefix}${digest.toString("hex")}`,
        body,
        secret
      })
    ).toBe(true);
  });

  it("still rejects a wrong digest in either encoding", () => {
    const wrong = createHmac("sha256", "other").update(body).digest();
    for (const enc of ["hex", "base64"] as const) {
      expect(
        verifyRampWebhookSignature({
          signature: wrong.toString(enc),
          body,
          secret
        })
      ).toBe(false);
    }
  });

  it("rejects a tampered body", () => {
    expect(
      verifyRampWebhookSignature({
        signature: digest.toString("hex"),
        body: `${body} `,
        secret
      })
    ).toBe(false);
  });
});
