import { constants, createSign } from "node:crypto";

import { tokenUrl } from "./account.ts";
import type { NetSuiteAuth } from "./client.ts";
import { NetSuiteError } from "./errors.ts";

/**
 * OAuth 2.0 Client Credentials (machine-to-machine) — the auth a migration
 * should run on.
 *
 * The alternatives both have a disqualifying property for an unattended job that
 * may run for an hour: the authorization-code grant's refresh token expires
 * after 7 days of disuse, and Token-Based Authentication is end-of-life (NetSuite
 * accepts no new TBA integrations from 2027.1). M2M needs no browser, issues no
 * refresh token at all, and is re-minted by signing a fresh JWT — which is why
 * `refreshAccessToken` below can simply mint another one.
 *
 * Three details reject an otherwise-correct setup with an opaque
 * `invalid_client`:
 *   - `kid` is the **Certificate ID** NetSuite shows after the public certificate
 *     is uploaded. It is not the integration's client id and not a thumbprint.
 *   - `aud` must be the exact token endpoint URL, account host included.
 *   - the RSA key must be 3072 or 4096 bits; NetSuite rejects 2048.
 */

export type M2mAlgorithm = "PS256" | "RS256" | "ES256" | "ES384" | "ES512";

export type M2mCredentials = {
  accountId: string;
  /** Client ID of the Integration record. */
  clientId: string;
  /** Certificate ID from OAuth 2.0 Client Credentials (M2M) Setup — the JWT `kid`. */
  certificateId: string;
  /** PEM-encoded private key matching the uploaded certificate. */
  privateKey: string;
  algorithm?: M2mAlgorithm;
  scope?: string[];
};

function base64Url(input: Buffer | string): string {
  return (typeof input === "string" ? Buffer.from(input) : input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function signingOptionsFor(algorithm: M2mAlgorithm, privateKey: string) {
  switch (algorithm) {
    case "PS256":
      return {
        hash: "sha256",
        key: {
          key: privateKey,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: constants.RSA_PSS_SALTLEN_DIGEST
        }
      } as const;
    case "RS256":
      return { hash: "sha256", key: { key: privateKey } } as const;
    case "ES256":
      // NetSuite expects the JOSE fixed-width (R||S) form, not ASN.1 DER.
      return {
        hash: "sha256",
        key: { key: privateKey, dsaEncoding: "ieee-p1363" }
      } as const;
    case "ES384":
      return {
        hash: "sha384",
        key: { key: privateKey, dsaEncoding: "ieee-p1363" }
      } as const;
    case "ES512":
      return {
        hash: "sha512",
        key: { key: privateKey, dsaEncoding: "ieee-p1363" }
      } as const;
  }
}

/** The signed client assertion for one token request. */
export function signClientAssertion(
  credentials: M2mCredentials,
  options: { now?: number; lifetimeSeconds?: number } = {}
): string {
  const algorithm = credentials.algorithm ?? "PS256";
  const issuedAt = Math.floor((options.now ?? Date.now()) / 1000);
  // NetSuite rejects an assertion whose `exp` is more than an hour out.
  const expiresAt = issuedAt + Math.min(options.lifetimeSeconds ?? 3600, 3600);

  const header = base64Url(
    JSON.stringify({
      typ: "JWT",
      alg: algorithm,
      kid: credentials.certificateId
    })
  );
  const payload = base64Url(
    JSON.stringify({
      iss: credentials.clientId,
      scope: credentials.scope ?? ["rest_webservices"],
      aud: tokenUrl(credentials.accountId),
      iat: issuedAt,
      exp: expiresAt
    })
  );

  const signingInput = `${header}.${payload}`;
  const { hash, key } = signingOptionsFor(algorithm, credentials.privateKey);
  const signer = createSign(hash);
  signer.update(signingInput);
  return `${signingInput}.${base64Url(signer.sign(key))}`;
}

export type M2mToken = { accessToken: string; expiresInSeconds: number };

/** Exchange a signed assertion for an access token. Tokens live one hour. */
export async function requestM2mToken(
  credentials: M2mCredentials,
  options: { fetch?: typeof fetch; now?: number } = {}
): Promise<M2mToken> {
  const doFetch = options.fetch ?? globalThis.fetch;

  const response = await doFetch(tokenUrl(credentials.accountId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: signClientAssertion(credentials, { now: options.now })
    }).toString()
  });

  const raw = await response.text();
  let body: {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = {};
  }

  if (!response.ok || !body.access_token) {
    throw new NetSuiteError(
      body.error_description ??
        body.error ??
        `NetSuite refused the token request (HTTP ${response.status})`,
      {
        kind: response.status >= 500 ? "server" : "auth",
        status: response.status,
        detail: raw.slice(0, 500) || undefined,
        code: body.error
      }
    );
  }

  return {
    accessToken: body.access_token,
    expiresInSeconds: body.expires_in ?? 3600
  };
}

/**
 * Mint the first token and hand the client a way to mint the next one.
 *
 * The client refreshes on a 401 rather than on a timer: a migration's own clock
 * and NetSuite's disagree often enough that "expires_in minus a safety margin"
 * mis-predicts, and a 401 is unambiguous.
 */
export async function createM2mAuth(
  credentials: M2mCredentials,
  options: { fetch?: typeof fetch } = {}
): Promise<NetSuiteAuth> {
  const first = await requestM2mToken(credentials, options);

  return {
    type: "oauth2",
    accountId: credentials.accountId,
    accessToken: first.accessToken,
    refreshAccessToken: async () => {
      const next = await requestM2mToken(credentials, options);
      return next.accessToken;
    }
  };
}
