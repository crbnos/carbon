import { jwtVerify, SignJWT } from "jose";
import { SESSION_SECRET } from "../config/env";

// Server-only utility for minting + verifying tamper-proof file download links.
// The token is the credential: it encodes WHO the link was generated for and
// WHICH file it points to. Authorization is re-checked live at download time
// (via RLS as the encoded user), so the token intentionally has no expiry — a
// stale link simply stops working once access is revoked or the file is gone.
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

export async function generateDownloadToken(payload: DownloadTokenPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .sign(secret);
}

// Throws on a forged/corrupt signature (jwtVerify) or an unexpected claim shape
// (assertPayload). Callers treat any throw as an invalid token.
export async function verifyDownloadToken(
  token: string
): Promise<DownloadTokenPayload> {
  const { payload } = await jwtVerify(token, secret);
  return assertPayload(payload);
}
