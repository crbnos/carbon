// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveVapidDetails } from "./push.server";

const APP_URL = "https://erp.example.com";

describe("deriveVapidDetails", () => {
  // Every browser subscription is bound to this public key. If this test
  // fails, every deployment's key changed and every subscription broke — undo
  // the change to the derivation instead of updating the expected values.
  // (Cross-checked with `openssl kdf … HKDF` and `openssl ec -pubout`.)
  it("derives the known pair for a fixed secret", () => {
    expect(deriveVapidDetails("carbon-known-answer", APP_URL)).toEqual({
      privateKey: "TzaowWiJUkggIblM6_nQG-FFOwKUK0DEMwADabYUJ8k",
      publicKey:
        "BOGuTBaDZtTjy6SHEsFlQYjwb-patTPU0SQrjskAyv52s5tTtSr30p_VxbsM0_WwuMF3qXQTwduI99Alk3WYEmM",
      subject: APP_URL
    });
  });

  it("gives the same pair for the same secret", () => {
    expect(deriveVapidDetails("secret-a", APP_URL)).toEqual(
      deriveVapidDetails("secret-a", APP_URL)
    );
  });

  it("gives a different pair for a different secret", () => {
    const a = deriveVapidDetails("secret-a", APP_URL);
    const b = deriveVapidDetails("secret-b", APP_URL);
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.privateKey).not.toBe(b.privateKey);
  });

  it("encodes the keys the way web-push and pushManager.subscribe expect", () => {
    const { publicKey, privateKey } = deriveVapidDetails("secret-a", APP_URL);
    const pub = Buffer.from(publicKey, "base64url");
    expect(pub).toHaveLength(65);
    expect(pub[0]).toBe(0x04); // uncompressed point
    expect(Buffer.from(privateKey, "base64url")).toHaveLength(32);
  });

  it("is a working key pair: what the private key signs, the public key verifies", () => {
    const { publicKey, privateKey } = deriveVapidDetails("secret-a", APP_URL);
    const pub = Buffer.from(publicKey, "base64url");
    const jwk = {
      crv: "P-256",
      kty: "EC",
      x: pub.subarray(1, 33).toString("base64url"),
      y: pub.subarray(33).toString("base64url")
    };
    const message = Buffer.from("vapid");
    const signature = sign(
      "sha256",
      message,
      createPrivateKey({ format: "jwk", key: { ...jwk, d: privateKey } })
    );
    expect(
      verify(
        "sha256",
        message,
        createPublicKey({ format: "jwk", key: jwk }),
        signature
      )
    ).toBe(true);
  });

  it("uses an https app URL as the subject, else a mailto:", () => {
    expect(deriveVapidDetails("s", APP_URL).subject).toBe(APP_URL);
    expect(deriveVapidDetails("s", "http://localhost:3000").subject).toMatch(
      /^mailto:/
    );
  });
});
