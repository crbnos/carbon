// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { jwtVerify, SignJWT } from "jose";
import { SESSION_SECRET } from "../config/env";
import {
  consolePinMaxAgeMs,
  type StoredConsolePinIn
} from "./console-pin.server";

/**
 * Shared-terminal tokens for the MES mobile API.
 *
 * A tablet clamped to a machine signs in ONCE as a terminal account; the
 * operators who use it pin in with their PIN, and their work must be
 * attributed to THEM. On the web that pin-in rides the signed
 * `console-pin-<companyId>` cookie (`console-pin.server.ts`). A native client
 * has no cookie jar the server controls, so the same claim travels as a signed
 * token in the `x-carbon-operator` header.
 *
 * Two tokens, for two different jobs:
 *
 * - a **terminal** token identifies the tablet's own session and is the thing
 *   that may OFFER a PIN. It carries no expiry on purpose: it authorises
 *   nothing but a rate-limited, lockout-guarded PIN attempt, it is useless
 *   without that terminal's own Bearer session (the pin-in endpoint requires
 *   both and checks they agree), and console mode is re-read from the company
 *   on every use. A stolen terminal token alone cannot pin anyone in.
 * - an **operator** token IS the identity claim. It expires, it is bound to the
 *   company and to the terminal session that minted it, and it is re-validated
 *   against the database on every request (`revalidateConsolePinIn`).
 *
 * Signed HS256 over `SESSION_SECRET`, which is required and server-only — the
 * same key and the same `jose` primitives the repo already uses for the
 * download token (`lib/download-token.server.ts`) and the same secret
 * react-router signs the console-pin cookie with. No new env var, no new
 * library.
 *
 * The payload is base64-READABLE (signed, not encrypted), exactly like the
 * cookie it replaces: it carries the operator's id, display name and avatar so
 * the app can render "pinned in as Jane" and so a refresh can re-sign the same
 * claim. It never carries a PIN, and nothing in this file logs a token.
 *
 * The app holds the operator token in MEMORY only — never in SecureStore,
 * never in the query cache — so a stolen tablet carries no operator session.
 * Nothing here depends on the app persisting it: the server keeps no record of
 * a minted token, and pin-out is simply the app dropping it.
 */

const secret = new TextEncoder().encode(SESSION_SECRET);

const ALGORITHM = "HS256";
const ISSUER = "carbon";

/**
 * Distinct audiences, so the two token types can never be swapped even if the
 * `kind` check below were lost — `jwtVerify` refuses a mismatched `aud` before
 * our own code sees the claims. They also separate these tokens from every
 * other thing `SESSION_SECRET` signs (the session cookie, the console-pin
 * cookie, the download token), none of which carries this issuer/audience pair.
 */
const TERMINAL_AUDIENCE = "carbon-console-terminal";
const OPERATOR_AUDIENCE = "carbon-console-operator";

export type TerminalTokenPayload = {
  companyId: string;
  sessionUserId: string;
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Mint the token that identifies this tablet's console session. Bound to the
 * company and the signed-in terminal account, so it is meaningless anywhere
 * else.
 */
export function signTerminalToken(
  payload: TerminalTokenPayload
): Promise<string> {
  return new SignJWT({
    kind: "terminal",
    companyId: payload.companyId,
    sessionUserId: payload.sessionUserId
  })
    .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(TERMINAL_AUDIENCE)
    .setIssuedAt()
    .sign(secret);
}

/** The terminal token's binding, or null for anything we did not sign. */
export async function verifyTerminalToken(
  token: string
): Promise<TerminalTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: TERMINAL_AUDIENCE
    });
    if (payload.kind !== "terminal") return null;
    if (
      !nonEmptyString(payload.companyId) ||
      !nonEmptyString(payload.sessionUserId)
    ) {
      return null;
    }
    return {
      companyId: payload.companyId,
      sessionUserId: payload.sessionUserId
    };
  } catch {
    return null;
  }
}

/**
 * Does this terminal token belong to the caller in front of us? The binding
 * check lives here rather than at the call site so a route cannot verify the
 * signature and forget to compare the claims — which is the whole protection
 * against replaying one plant's token on another tablet.
 */
export async function terminalTokenMatches(
  token: string | null | undefined,
  expected: TerminalTokenPayload
): Promise<boolean> {
  if (!token) return false;
  const payload = await verifyTerminalToken(token);
  return (
    !!payload &&
    payload.companyId === expected.companyId &&
    payload.sessionUserId === expected.sessionUserId
  );
}

function isStoredConsolePinIn(value: unknown): value is StoredConsolePinIn {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    nonEmptyString(v.userId) &&
    nonEmptyString(v.companyId) &&
    nonEmptyString(v.sessionUserId) &&
    typeof v.name === "string" &&
    (v.avatarUrl === null || typeof v.avatarUrl === "string") &&
    typeof v.pinnedAt === "number" &&
    Number.isFinite(v.pinnedAt)
  );
}

/**
 * Mint the operator's identity claim.
 *
 * `exp` is `pinnedAt + consolePinMaxAgeMs()` — 1 hour normally, and the
 * deployment's idle-lock window (`SESSION_IDLE_LOCK_MS`, which `/me` reports as
 * `instance.idleLockMs`) in a controlled environment, where NIST 800-171
 * 3.1.10 wants a shared terminal to drop its operator sooner. Exactly the
 * window the cookie uses, from the same function, so a tablet and a browser
 * expire a pin-in at the same moment.
 */
export function signOperatorToken(stored: StoredConsolePinIn): Promise<string> {
  return (
    new SignJWT({
      kind: "operator",
      userId: stored.userId,
      companyId: stored.companyId,
      sessionUserId: stored.sessionUserId,
      name: stored.name,
      avatarUrl: stored.avatarUrl,
      pinnedAt: stored.pinnedAt
    })
      .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
      .setIssuer(ISSUER)
      .setAudience(OPERATOR_AUDIENCE)
      .setIssuedAt()
      // A Date rather than hand-divided seconds: `jose` owns the conversion, and
      // this file does no arithmetic on epoch values it would have to round.
      .setExpirationTime(new Date(stored.pinnedAt + consolePinMaxAgeMs()))
      .sign(secret)
  );
}

/**
 * Re-sign a verified claim with a fresh `pinnedAt`, which slides the window.
 * The cookie path gets this for free (the MES shell loader rewrites the cookie
 * on every navigation), so without it an operator working steadily from a
 * tablet would be dropped mid-shift while a browser user would not.
 */
export function refreshOperatorToken(
  stored: StoredConsolePinIn
): Promise<string> {
  return signOperatorToken({ ...stored, pinnedAt: Date.now() });
}

/**
 * The operator claim a token carries, or null.
 *
 * Null for: a forged or tampered signature, a token signed for another
 * audience (including a terminal token), the wrong `kind`, a payload of the
 * wrong shape, an `exp` in the past, and a `pinnedAt` older than the CURRENT
 * policy window. That last check is not redundant with `exp`: a token minted
 * before the deployment became a controlled environment carries the longer
 * window in its own `exp`, and the live policy has to win.
 *
 * It deliberately does NOT check the company or the terminal session — the
 * caller has the request's own answers for those, and comparing a token to
 * itself proves nothing. `requireApiUser` does it.
 */
export async function verifyOperatorToken(
  token: string
): Promise<StoredConsolePinIn | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: OPERATOR_AUDIENCE
    });
    if (payload.kind !== "operator") return null;
    if (!isStoredConsolePinIn(payload)) return null;
    if (Date.now() - payload.pinnedAt > consolePinMaxAgeMs()) return null;
    return {
      userId: payload.userId,
      companyId: payload.companyId,
      sessionUserId: payload.sessionUserId,
      name: payload.name,
      avatarUrl: payload.avatarUrl,
      pinnedAt: payload.pinnedAt
    };
  } catch {
    return null;
  }
}
