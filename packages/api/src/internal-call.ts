// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A call one Carbon app's server makes to another's (MES → ERP postings). The
// caller signs what it asserts — the company, the user, whether the posting
// runs as that user or as the system — with a key both apps derive from
// SESSION_SECRET. A browser holds no key, so it cannot make such a call.
// Server-only, though not named `.server`: MES services that client code
// imports load it lazily, and React Router refuses any `.server` import there.

import {
  createHash,
  createHmac,
  hkdfSync,
  randomUUID,
  timingSafeEqual
} from "node:crypto";

/** How long a signed call is accepted: the two servers' clocks may differ. */
export const INTERNAL_CALL_WINDOW_MS = 5 * 60_000;

/** The largest body a receiver reads. A posting's input is a few kilobytes. */
export const INTERNAL_CALL_MAX_BYTES = 1024 * 1024;

/** `caller`: the posting checks the user behind the forwarded token first. */
export type InternalCallMode = "system" | "caller";

export type InternalCall = {
  name: string;
  companyId: string;
  userId: string;
  mode: InternalCallMode;
  /** Unique per call: the receiver accepts each one once. */
  nonce: string;
};

const HEADER = {
  timestamp: "x-carbon-timestamp",
  company: "x-carbon-company",
  user: "x-carbon-user",
  mode: "x-carbon-mode",
  nonce: "x-carbon-nonce",
  signature: "x-carbon-signature"
} as const;

function signingKey(secret: string): Buffer {
  // An empty secret would give every deployment the same key.
  if (!secret) throw new Error("Internal calls need SESSION_SECRET");
  return Buffer.from(
    hkdfSync("sha256", secret, "carbon", "internal-call/1", 32)
  );
}

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function signature(
  secret: string,
  timestamp: string,
  call: InternalCall,
  body: string,
  authorization: string
): Buffer {
  return createHmac("sha256", signingKey(secret))
    .update(
      [
        timestamp,
        call.name,
        call.companyId,
        call.userId,
        call.mode,
        call.nonce,
        sha256(body),
        sha256(authorization)
      ].join("\n")
    )
    .digest();
}

/**
 * The headers of a signed call. In caller mode `authorization` is the user's
 * `Bearer` header, sent with the call and covered by the signature.
 */
export function signInternalCall(
  secret: string,
  call: Omit<InternalCall, "nonce">,
  body: string,
  authorization = "",
  now = Date.now()
): Record<string, string> {
  if ((call.mode === "caller") !== !!authorization) {
    throw new Error("A caller-mode call needs the caller's token, and only it");
  }
  const signed = { ...call, nonce: randomUUID() };
  const timestamp = String(now);
  return {
    [HEADER.timestamp]: timestamp,
    [HEADER.company]: signed.companyId,
    [HEADER.user]: signed.userId,
    [HEADER.mode]: signed.mode,
    [HEADER.nonce]: signed.nonce,
    [HEADER.signature]: signature(
      secret,
      timestamp,
      signed,
      body,
      authorization
    ).toString("base64url"),
    ...(authorization ? { authorization } : {})
  };
}

/**
 * The call a request's headers claim, when they are complete and its timestamp
 * is within the window; otherwise null. Nothing is verified yet: the receiver
 * checks this before it reads the body, then calls {@link verifyInternalCall}.
 */
export function readInternalCallHeaders(
  name: string,
  headers: Headers,
  now = Date.now()
): InternalCall | null {
  const get = (header: string) => headers.get(header) ?? "";
  const timestamp = get(HEADER.timestamp);
  const sentAt = Number(timestamp);
  if (
    !/^\d+$/.test(timestamp) ||
    Math.abs(now - sentAt) > INTERNAL_CALL_WINDOW_MS
  ) {
    return null;
  }
  const mode = get(HEADER.mode);
  if (mode !== "system" && mode !== "caller") return null;
  const call: InternalCall = {
    name,
    companyId: get(HEADER.company),
    userId: get(HEADER.user),
    mode,
    nonce: get(HEADER.nonce)
  };
  if (!call.companyId || !call.userId || !call.nonce) return null;
  if ((mode === "caller") !== !!headers.get("authorization")) return null;
  if (!headers.get(HEADER.signature)) return null;
  return call;
}

/**
 * The request's body, or null when it is larger than
 * {@link INTERNAL_CALL_MAX_BYTES}. Reads no more than that, whether or not the
 * request states its length.
 */
export async function readInternalCallBody(
  request: Request
): Promise<string | null> {
  const length = request.headers.get("content-length");
  if (length !== null && !(Number(length) <= INTERNAL_CALL_MAX_BYTES)) {
    return null;
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > INTERNAL_CALL_MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The call a request carries, when this secret signed it within the window;
 * otherwise null. The receiver must still refuse a nonce it has seen.
 */
export function verifyInternalCall(
  secret: string,
  name: string,
  headers: Headers,
  body: string,
  now = Date.now()
): InternalCall | null {
  if (!secret) return null;
  const call = readInternalCallHeaders(name, headers, now);
  if (!call) return null;
  const get = (header: string) => headers.get(header) ?? "";
  const authorization = get("authorization");

  const expected = signature(
    secret,
    get(HEADER.timestamp),
    call,
    body,
    authorization
  );
  const given = Buffer.from(get(HEADER.signature), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  return call;
}

/**
 * The token on the assembler's completion callback URL: an HMAC of the job id.
 * The jobs package mints it into the job and the ERP callback route checks it,
 * so nothing is stored. Throws on an empty secret, which would make every
 * token guessable.
 */
export function assemblerCallbackToken(secret: string, jobId: string): string {
  if (!secret) throw new Error("Assembler callbacks need SESSION_SECRET");
  return createHmac("sha256", secret)
    .update(`assembler-callback:${jobId}`)
    .digest("hex");
}

/** Whether `token` is the callback token of `jobId`, in constant time. */
export function isAssemblerCallbackToken(
  secret: string,
  jobId: string,
  token: string
): boolean {
  const expected = Buffer.from(assemblerCallbackToken(secret, jobId));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
