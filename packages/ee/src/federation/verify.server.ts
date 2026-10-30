// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { FEDERATION_ALLOW_PRIVATE_ISSUERS } from "@carbon/env";
import { checkOutboundUrl, outboundFetch } from "@carbon/lib/url-guard.server";
import {
  createRemoteJWKSet,
  customFetch,
  decodeJwt,
  decodeProtectedHeader,
  errors,
  type JWTPayload,
  type JWTVerifyGetKey,
  jwtVerify
} from "jose";
import { FEDERATION_LIMITS } from "./constants";
import {
  ALLOWED_JWT_ALGORITHMS,
  type FederationFailure,
  issuerUrlError
} from "./match";

/** Resolves the signing keys of an issuer. Injected in tests. */
export type FederationKeyResolver = (
  issuer: string
) => Promise<JWTVerifyGetKey>;

export type VerifiedSubjectToken = {
  subject: string;
  claims: JWTPayload & Record<string, unknown>;
  jti: string | null;
  /** Seconds since the epoch. */
  expiresAt: number;
};

export type VerifyResult =
  | { ok: true; token: VerifiedSubjectToken }
  | { ok: false; reason: FederationFailure };

const FETCH_TIMEOUT_MS = 5_000;
const DISCOVERY_TTL_MS = 10 * 60 * 1_000;
const JWKS_COOLDOWN_MS = 30_000;

/** Every issuer fetch goes through the private-network guard unless a self-hosted install opts out. */
async function fetchIssuerUrl(url: string, signal?: AbortSignal) {
  const shapeError = issuerUrlError(url);
  if (shapeError) throw new Error(shapeError);
  if (FEDERATION_ALLOW_PRIVATE_ISSUERS) {
    return fetch(url, { signal, redirect: "error" });
  }
  const verdict = await checkOutboundUrl(url);
  if (!verdict.ok) throw new Error(verdict.reason);
  return outboundFetch(url, {
    signal,
    redirect: "error"
  }) as unknown as Promise<Response>;
}

type KeySetEntry = { getKey: JWTVerifyGetKey; expiresAt: number };
const keySets = new Map<string, KeySetEntry>();

/**
 * Discovery, then a cached remote key set. The discovery document must name
 * the same issuer the rule names: a mismatch means the URL is not the issuer.
 */
export async function discoverKeySet(issuer: string): Promise<JWTVerifyGetKey> {
  const cached = keySets.get(issuer);
  if (cached && cached.expiresAt > Date.now()) return cached.getKey;

  const discoveryUrl = `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
  const response = await fetchIssuerUrl(
    discoveryUrl,
    AbortSignal.timeout(FETCH_TIMEOUT_MS)
  );
  if (!response.ok) {
    throw new Error(`Discovery answered ${response.status}`);
  }
  const document = (await response.json()) as {
    issuer?: unknown;
    jwks_uri?: unknown;
  };
  if (document.issuer !== issuer) {
    throw new Error("The discovery document names a different issuer");
  }
  if (typeof document.jwks_uri !== "string") {
    throw new Error("The discovery document has no jwks_uri");
  }

  const getKey = createRemoteJWKSet(new URL(document.jwks_uri), {
    timeoutDuration: FETCH_TIMEOUT_MS,
    cooldownDuration: JWKS_COOLDOWN_MS,
    cacheMaxAge: DISCOVERY_TTL_MS,
    [customFetch]: (url, options) => fetchIssuerUrl(url, options.signal)
  });
  keySets.set(issuer, { getKey, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  return getKey;
}

function failureFromJoseError(error: unknown): FederationFailure {
  if (error instanceof errors.JWTExpired) return "expired";
  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.reason === "missing") return "missing_claims";
    if (error.claim === "aud") return "audience_mismatch";
    if (error.claim === "iss") return "issuer_mismatch";
    if (error.claim === "nbf" || error.claim === "iat") return "not_yet_valid";
    return "malformed_jwt";
  }
  if (error instanceof errors.JOSEAlgNotAllowed) return "algorithm_not_allowed";
  if (
    error instanceof errors.JWSSignatureVerificationFailed ||
    error instanceof errors.JWKSNoMatchingKey ||
    error instanceof errors.JWKSMultipleMatchingKeys
  ) {
    return "signature_invalid";
  }
  // A key-set fetch that failed inside jwtVerify throws a plain error, or a
  // bare JOSEError for a non-200 answer.
  if (
    error instanceof errors.JWKSTimeout ||
    error instanceof errors.JWKSInvalid ||
    !(error instanceof errors.JOSEError) ||
    error.constructor === errors.JOSEError
  ) {
    return "discovery_failed";
  }
  return "malformed_jwt";
}

/**
 * Checks an incoming OIDC JWT against a rule's issuer and audience. The
 * subject and claim conditions are matched by the caller.
 */
export async function verifySubjectToken(
  jwt: string,
  rule: { issuer: string; audience: string },
  getKeySet: FederationKeyResolver = discoverKeySet
): Promise<VerifyResult> {
  let algorithm: string | undefined;
  let kid: string | undefined;
  let unverifiedIssuer: unknown;
  try {
    ({ alg: algorithm, kid } = decodeProtectedHeader(jwt));
    unverifiedIssuer = decodeJwt(jwt).iss;
  } catch {
    return { ok: false, reason: "malformed_jwt" };
  }

  if (
    !algorithm ||
    !(ALLOWED_JWT_ALGORITHMS as readonly string[]).includes(algorithm)
  ) {
    return { ok: false, reason: "algorithm_not_allowed" };
  }
  if (!kid) return { ok: false, reason: "missing_kid" };
  // Checked before any fetch: the token never chooses which issuer Carbon calls.
  if (unverifiedIssuer !== rule.issuer) {
    return { ok: false, reason: "issuer_mismatch" };
  }

  let getKey: JWTVerifyGetKey;
  try {
    getKey = await getKeySet(rule.issuer);
  } catch {
    return { ok: false, reason: "discovery_failed" };
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(jwt, getKey, {
      issuer: rule.issuer,
      audience: rule.audience,
      algorithms: [...ALLOWED_JWT_ALGORITHMS],
      clockTolerance: FEDERATION_LIMITS.clockToleranceSeconds,
      requiredClaims: ["sub", "iat", "exp"]
    }));
  } catch (error) {
    return { ok: false, reason: failureFromJoseError(error) };
  }

  const { sub, iat, exp, jti } = payload;
  if (typeof sub !== "string" || sub.length === 0) {
    return { ok: false, reason: "missing_claims" };
  }
  if (typeof iat !== "number" || typeof exp !== "number") {
    return { ok: false, reason: "missing_claims" };
  }
  const nowSeconds = Date.now() / 1_000;
  if (iat > nowSeconds + FEDERATION_LIMITS.clockToleranceSeconds) {
    return { ok: false, reason: "not_yet_valid" };
  }
  if (exp - iat > FEDERATION_LIMITS.maxJwtLifetimeSeconds) {
    return { ok: false, reason: "lifetime_too_long" };
  }

  return {
    ok: true,
    token: {
      subject: sub,
      claims: payload as JWTPayload & Record<string, unknown>,
      jti: typeof jti === "string" && jti.length > 0 ? jti : null,
      expiresAt: exp
    }
  };
}
