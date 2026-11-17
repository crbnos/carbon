// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { errors, jwtVerify, SignJWT } from "jose";
import { SESSION_SECRET } from "../config/env";

// Server-only utility for minting + verifying tamper-proof file download links.
// The token is the credential: it encodes WHO the link was generated for and
// WHICH file it points to. Authorization is re-checked live at download time
// (via RLS as the encoded user), so a token may have no expiry — a stale link
// stops working once access is revoked or the file is gone. A link handed to an
// API caller expires (`expiresInSeconds`): it outlives the key that asked for it.
//
// Signed (HS256) over SESSION_SECRET, which is required + server-only, so tokens
// can only be minted/verified on the server. The payload is base64-readable but
// tamper-proof; that is sufficient for the stated security model.
//
// Lives in @carbon/auth (the canonical JWT/secret owner, alongside
// getUserScopedClient) and is table-agnostic: any table can attach a
// `downloadToken` per row and reuse a public `/download/:token` route.

const secret = new TextEncoder().encode(SESSION_SECRET);

export type DownloadTokenPayload = {
  userId: string;
  companyId: string;
  documentId: string;
};

function assertPayload(value: unknown): DownloadTokenPayload {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as Record<string, unknown>).userId !== "string" ||
    typeof (value as Record<string, unknown>).companyId !== "string" ||
    typeof (value as Record<string, unknown>).documentId !== "string"
  ) {
    throw new Error("Invalid download token payload");
  }
  const { userId, companyId, documentId } = value as Record<string, string>;
  if (!userId || !companyId || !documentId) {
    throw new Error("Invalid download token payload");
  }
  return { userId, companyId, documentId };
}

export async function generateDownloadToken(
  payload: DownloadTokenPayload,
  options: { expiresInSeconds?: number } = {}
) {
  const token = new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt();
  if (options.expiresInSeconds !== undefined) {
    token.setExpirationTime(`${options.expiresInSeconds}s`);
  }
  return token.sign(secret);
}

/** A genuine token whose expiry has passed. */
export class DownloadTokenExpiredError extends Error {
  constructor() {
    super("Download token expired");
    this.name = "DownloadTokenExpiredError";
  }
}

// Throws DownloadTokenExpiredError past the token's expiry. Any other throw is a
// forged/corrupt signature (jwtVerify) or an unexpected claim shape
// (assertPayload): an invalid token.
export async function verifyDownloadToken(
  token: string
): Promise<DownloadTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return assertPayload(payload);
  } catch (error) {
    if (error instanceof errors.JWTExpired) {
      throw new DownloadTokenExpiredError();
    }
    throw error;
  }
}
