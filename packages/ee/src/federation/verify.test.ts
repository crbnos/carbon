// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  SignJWT
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type IssuerKeySource,
  resolveKeySet,
  verifySubjectToken
} from "./verify.server";

const ISSUER = "https://issuer.example.com";
const AUDIENCE = "https://app.carbon.ms";
const issuer: IssuerKeySource = {
  id: "fedi_test",
  issuer: ISSUER,
  jwksSource: "OIDC Discovery",
  discoveryUrl: null,
  jwksUrl: null,
  jwks: null,
  caCertificate: null,
  maxTokenLifetimeHours: 1,
  updatedAt: null
};

let privateKey: CryptoKey;
let getKeySet: () => Promise<ReturnType<typeof createLocalJWKSet>>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  const keySet = createLocalJWKSet({ keys: [jwk] });
  getKeySet = async () => keySet;
});

const nowSeconds = () => Math.floor(Date.now() / 1_000);

function sign(
  overrides: JWTPayload = {},
  header: { kid?: string } = { kid: "k1" }
) {
  return new SignJWT({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: "repo:acme/plm:ref:refs/heads/main",
    iat: nowSeconds(),
    exp: nowSeconds() + 300,
    jti: "jti-1",
    repository_owner_id: "123",
    ...overrides
  })
    .setProtectedHeader({ alg: "RS256", ...header })
    .sign(privateKey);
}

describe("verifySubjectToken", () => {
  it("returns the subject, claims and jti of a valid token", async () => {
    const result = await verifySubjectToken(
      await sign(),
      issuer,
      AUDIENCE,
      getKeySet
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token.subject).toBe("repo:acme/plm:ref:refs/heads/main");
    expect(result.token.jti).toBe("jti-1");
    expect(result.token.claims.repository_owner_id).toBe("123");
  });

  it.each([
    [{ aud: "https://other.example.com" }, "audience_mismatch"],
    [{ iss: "https://evil.example.com" }, "issuer_mismatch"],
    [{ exp: nowSeconds() - 120, iat: nowSeconds() - 600 }, "expired"],
    [{ iat: nowSeconds() + 600, exp: nowSeconds() + 900 }, "not_yet_valid"],
    [
      { iat: nowSeconds(), exp: nowSeconds() + 2 * 60 * 60 },
      "lifetime_too_long"
    ],
    [{ sub: undefined }, "missing_claims"]
  ])("refuses a token with %o as %s", async (overrides, reason) => {
    const result = await verifySubjectToken(
      await sign(overrides as JWTPayload),
      issuer,
      AUDIENCE,
      getKeySet
    );
    expect(result).toEqual({ ok: false, reason });
  });

  it("refuses a token with no kid", async () => {
    const result = await verifySubjectToken(
      await sign({}, {}),
      issuer,
      AUDIENCE,
      getKeySet
    );
    expect(result).toEqual({ ok: false, reason: "missing_kid" });
  });

  it("refuses a token signed by another key", async () => {
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT({ sub: "x", iss: ISSUER, aud: AUDIENCE })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(other.privateKey);
    const result = await verifySubjectToken(
      forged,
      issuer,
      AUDIENCE,
      getKeySet
    );
    expect(result).toEqual({ ok: false, reason: "signature_invalid" });
  });

  it("refuses an HS256 token before any key lookup", async () => {
    const hs = await new SignJWT({ sub: "x", iss: ISSUER, aud: AUDIENCE })
      .setProtectedHeader({ alg: "HS256", kid: "k1" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("a-shared-secret-of-enough-length!"));
    const result = await verifySubjectToken(hs, issuer, AUDIENCE, async () => {
      throw new Error("must not fetch keys");
    });
    expect(result).toEqual({ ok: false, reason: "algorithm_not_allowed" });
  });

  it("never fetches keys for an issuer the rule does not name", async () => {
    let fetched = false;
    const result = await verifySubjectToken(
      await sign({ iss: "https://attacker.example.com" }),
      issuer,
      AUDIENCE,
      async () => {
        fetched = true;
        return (await getKeySet()) as never;
      }
    );
    expect(result).toEqual({ ok: false, reason: "issuer_mismatch" });
    expect(fetched).toBe(false);
  });

  it("reports a failed discovery", async () => {
    const result = await verifySubjectToken(
      await sign(),
      issuer,
      AUDIENCE,
      async () => {
        throw new Error("timeout");
      }
    );
    expect(result).toEqual({ ok: false, reason: "discovery_failed" });
  });

  it("refuses text that is not a JWT", async () => {
    const result = await verifySubjectToken(
      "not-a-jwt",
      issuer,
      AUDIENCE,
      getKeySet
    );
    expect(result).toEqual({ ok: false, reason: "malformed_jwt" });
  });

  it("verifies against a pasted key set, with no fetch", async () => {
    const pair = await generateKeyPair("RS256");
    const jwk = {
      ...(await exportJWK(pair.publicKey)),
      kid: "k2",
      alg: "RS256"
    };
    const inline: IssuerKeySource = {
      ...issuer,
      id: "fedi_inline",
      jwksSource: "Inline JWKS",
      jwks: { keys: [jwk] }
    };
    const jwt = await new SignJWT({ iss: ISSUER, aud: AUDIENCE, sub: "svc" })
      .setProtectedHeader({ alg: "RS256", kid: "k2" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(pair.privateKey);
    const result = await verifySubjectToken(
      jwt,
      inline,
      AUDIENCE,
      resolveKeySet
    );
    expect(result.ok).toBe(true);
  });

  it("allows the token age the issuer allows", async () => {
    const result = await verifySubjectToken(
      await sign({ iat: nowSeconds(), exp: nowSeconds() + 20 * 60 * 60 }),
      { ...issuer, maxTokenLifetimeHours: 24 },
      AUDIENCE,
      getKeySet
    );
    expect(result.ok).toBe(true);
  });
});
