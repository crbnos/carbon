// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { FEDERATION_ALLOW_PRIVATE_ISSUERS } from "@carbon/env";
import { checkOutboundUrl, outboundFetch } from "@carbon/lib/url-guard.server";
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  customFetch,
  decodeJwt,
  decodeProtectedHeader,
  errors,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyGetKey,
  jwtVerify
} from "jose";
import { FEDERATION_LIMITS, type FederationJwksSource } from "./constants";
import {
  ALLOWED_JWT_ALGORITHMS,
  type FederationFailure,
  issuerUrlError
} from "./match";

/** What verification needs from an issuer record. */
export type IssuerKeySource = {
  id: string;
  issuer: string;
  jwksSource: FederationJwksSource;
  discoveryUrl: string | null;
  jwksUrl: string | null;
  jwks: unknown;
  caCertificate: string | null;
  maxTokenLifetimeHours: number;
  /** Changes when the issuer is edited, so a cached key set is not reused. */
  updatedAt: string | null;
};

/** Resolves the signing keys of an issuer. Injected in tests. */
export type FederationKeyResolver = (
  issuer: IssuerKeySource
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

/**
 * Every issuer fetch goes through the private-network guard unless a
 * self-hosted install opts out; an issuer's CA is trusted beside the roots.
 */
async function fetchIssuerUrl(
  url: string,
  ca: string | null,
  signal?: AbortSignal
) {
  const shapeError = issuerUrlError(url);
  if (shapeError) throw new Error(shapeError);
  if (!FEDERATION_ALLOW_PRIVATE_ISSUERS) {
    const verdict = await checkOutboundUrl(url);
    if (!verdict.ok) throw new Error(verdict.reason);
  }
  return outboundFetch(
    url,
    { signal, redirect: "error" },
    { ca: ca ?? undefined, allowPrivate: FEDERATION_ALLOW_PRIVATE_ISSUERS }
  ) as unknown as Promise<Response>;
}

type KeySetEntry = { getKey: JWTVerifyGetKey; expiresAt: number };
const keySets = new Map<string, KeySetEntry>();

function remoteKeySet(jwksUrl: string, ca: string | null): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUrl), {
    timeoutDuration: FETCH_TIMEOUT_MS,
    cooldownDuration: JWKS_COOLDOWN_MS,
    cacheMaxAge: DISCOVERY_TTL_MS,
    [customFetch]: (url, options) => fetchIssuerUrl(url, ca, options.signal)
  });
}

/**
 * The issuer's key set, by its key source: OIDC discovery (the document must
 * name the same issuer), a JWKS URL, or a pasted key set that is never
 * fetched. Cached per issuer and edit.
 */
export async function resolveKeySet(
  source: IssuerKeySource
): Promise<JWTVerifyGetKey> {
  const cacheKey = `${source.id}:${source.updatedAt ?? ""}`;
  const cached = keySets.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.getKey;

  let getKey: JWTVerifyGetKey;
  if (source.jwksSource === "Inline JWKS") {
    getKey = createLocalJWKSet(source.jwks as JSONWebKeySet);
  } else if (source.jwksSource === "JWKS URL") {
    if (!source.jwksUrl) throw new Error("The issuer has no JWKS URL");
    getKey = remoteKeySet(source.jwksUrl, source.caCertificate);
  } else {
    const base = (source.discoveryUrl || source.issuer).replace(/\/+$/, "");
    const discoveryUrl = base.endsWith("/.well-known/openid-configuration")
      ? base
      : `${base}/.well-known/openid-configuration`;
    const response = await fetchIssuerUrl(
      discoveryUrl,
      source.caCertificate,
      AbortSignal.timeout(FETCH_TIMEOUT_MS)
    );
    if (!response.ok) {
      throw new Error(`Discovery answered ${response.status}`);
    }
    const document = (await response.json()) as {
      issuer?: unknown;
      jwks_uri?: unknown;
    };
    if (document.issuer !== source.issuer) {
      throw new Error("The discovery document names a different issuer");
    }
    if (typeof document.jwks_uri !== "string") {
      throw new Error("The discovery document has no jwks_uri");
    }
    getKey = remoteKeySet(document.jwks_uri, source.caCertificate);
  }

  keySets.set(cacheKey, { getKey, expiresAt: Date.now() + DISCOVERY_TTL_MS });
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
 * Checks an incoming OIDC JWT against an issuer record and a rule's audience.
 * The subject and claim conditions are matched by the caller.
 */
export async function verifySubjectToken(
  jwt: string,
  issuer: IssuerKeySource,
  audience: string,
  getKeySet: FederationKeyResolver = resolveKeySet
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
  if (unverifiedIssuer !== issuer.issuer) {
    return { ok: false, reason: "issuer_mismatch" };
  }

  let getKey: JWTVerifyGetKey;
  try {
    getKey = await getKeySet(issuer);
  } catch {
    return { ok: false, reason: "discovery_failed" };
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(jwt, getKey, {
      issuer: issuer.issuer,
      audience,
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
  if (exp - iat > issuer.maxTokenLifetimeHours * 60 * 60) {
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
