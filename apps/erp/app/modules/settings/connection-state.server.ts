import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { SESSION_SECRET } from "@carbon/auth";

/**
 * The signed `state` parameter for an integration-connection OAuth round trip.
 *
 * This is the control that stops a token being planted into another company's
 * connection: the callback trusts nothing from the query string except what this
 * signature covers, and re-checks the companyId against the session on top.
 */

export interface ConnectionState {
  companyId: string;
  pieceName: string;
  name: string;
  userId: string;
  nonce: string;
  issuedAt: number;
}

const MAX_AGE_MS = 10 * 60 * 1000;

function sign(payload: string): string {
  // SESSION_SECRET is a required env var; the guard is for the type, and a boot
  // without it must never fall back to an unsigned state.
  if (!SESSION_SECRET) throw new Error("SESSION_SECRET is not set");
  return createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("base64url");
}

export function signConnectionState(
  state: Omit<ConnectionState, "nonce" | "issuedAt">
): string {
  const full: ConnectionState = {
    ...state,
    nonce: randomBytes(16).toString("base64url"),
    issuedAt: Date.now()
  };
  const payload = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Returns the state only when the signature is valid and the state is fresh. */
export function verifyConnectionState(
  raw: string | null | undefined
): ConnectionState | null {
  if (!raw) return null;

  const separator = raw.lastIndexOf(".");
  if (separator <= 0) return null;

  const payload = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);

  const expected = Buffer.from(sign(payload));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length) return null;
  if (!timingSafeEqual(expected, supplied)) return null;

  let state: ConnectionState;
  try {
    state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof state.issuedAt !== "number") return null;
  if (Date.now() - state.issuedAt > MAX_AGE_MS) return null;
  if (!state.companyId || !state.pieceName || !state.name) return null;
  if (!state.userId) return null;

  return state;
}
