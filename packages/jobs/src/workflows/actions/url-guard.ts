// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { Agent } from "undici";

export type UrlVerdict = { ok: true; url: URL } | { ok: false; reason: string };

const NOT_A_URL = "That is not a valid web address.";
const NOT_HTTPS = "Only https addresses are allowed.";
const NOT_HTTP = "Only http and https addresses are allowed.";
const NOT_FOUND = "That address could not be found.";
const PRIVATE = "That address is inside a private network.";
const HAS_CREDENTIALS =
  "Remove the username and password from the address; use a header instead.";

function isPrivateV4(address: string): boolean {
  const parts = address.split(".").map(Number);
  const [a, b] = parts;
  if (parts.length !== 4 || a === undefined || b === undefined) return true;
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  if (a === 0 || a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // Covers the cloud metadata address 169.254.169.254 along with all link-local.
  if (a === 169 && b === 254) return true;
  // 100.64.0.0/10 carrier-grade NAT: routable inside a provider network, and the
  // range some container platforms hand out.
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 198.18.0.0/15 benchmarking, reserved and never legitimately reachable.
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateV6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  // An IPv4-mapped address is only as safe as the address it wraps.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1];
  if (mapped !== undefined) return isPrivateV4(mapped);
  const head = lower.split(":")[0] ?? "";
  const prefix = Number.parseInt(head.padStart(4, "0").slice(0, 2), 16);
  if (Number.isNaN(prefix)) return true;
  // fc00::/7 unique-local, fe80::/10 link-local.
  if (prefix >= 0xfc && prefix <= 0xfd) return true;
  if (prefix >= 0xfe && prefix <= 0xfe) return true;
  return false;
}

function isPrivate(address: string, family: number): boolean {
  return family === 4 ? isPrivateV4(address) : isPrivateV6(address);
}

/** Resolves the hostname first: a public name can still point inward. */
export async function checkOutboundUrl(raw: string): Promise<UrlVerdict> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: NOT_A_URL };
  }

  if (url.protocol !== "https:") return { ok: false, reason: NOT_HTTPS };
  if (url.hostname.length === 0) return { ok: false, reason: NOT_A_URL };
  // Credentials in the URL are sent as basic auth on every redirect-free hop and
  // are invisible in the builder, so they cannot be reviewed or redacted.
  if (url.username.length > 0 || url.password.length > 0) {
    return { ok: false, reason: HAS_CREDENTIALS };
  }

  return checkResolvedHost(url);
}

/**
 * A webhook verdict also says whether a refusal is worth another attempt: a
 * lookup can fail for a moment, a private address does not stop being one.
 */
export type WebhookUrlVerdict =
  | { ok: true; url: URL }
  | { ok: false; reason: string; retryable: boolean };

/**
 * The guard for an event webhook (Settings → Webhooks). Looser than
 * `checkOutboundUrl` on two points, because those webhooks predate the guard and
 * their contract never forbade either: http is allowed, and so are credentials in
 * the URL (the person who typed them sees them in settings). The private-network
 * check is the same.
 */
export async function checkWebhookUrl(raw: string): Promise<WebhookUrlVerdict> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: NOT_A_URL, retryable: false };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: NOT_HTTP, retryable: false };
  }
  if (url.hostname.length === 0) {
    return { ok: false, reason: NOT_A_URL, retryable: false };
  }

  const verdict = await checkResolvedHost(url);
  if (verdict.ok) return verdict;
  return { ...verdict, retryable: verdict.reason === NOT_FOUND };
}

async function checkResolvedHost(url: URL): Promise<UrlVerdict> {
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.promises.lookup(url.hostname, { all: true });
  } catch {
    return { ok: false, reason: NOT_FOUND };
  }
  if (addresses.length === 0) return { ok: false, reason: NOT_FOUND };

  // Every address, not the first: a name can resolve to both public and private.
  for (const { address, family } of addresses) {
    if (isPrivate(address, family)) return { ok: false, reason: PRIVATE };
  }

  return { ok: true, url };
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number
) => void;

/**
 * The lookup the socket itself performs, so the address we approve is the address
 * we dial. `checkOutboundUrl` alone cannot promise that: its answer and `fetch`'s
 * are two separate resolutions, and whoever owns the name controls both.
 */
export function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: LookupCallback
): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    if (addresses.length === 0) {
      return callback(new Error(NOT_FOUND), "");
    }
    for (const { address, family } of addresses) {
      if (isPrivate(address, family)) return callback(new Error(PRIVATE), "");
    }
    if (options.all === true) return callback(null, addresses);
    const [first] = addresses;
    if (first === undefined) return callback(new Error(NOT_FOUND), "");
    callback(null, first.address, first.family);
  });
}

/** Hand to `fetch` as `dispatcher`. This, not `checkOutboundUrl`, is the enforcement. */
export const outboundDispatcher = new Agent({
  connect: { lookup: guardedLookup }
});

/**
 * The same guard for node's http client (axios), as `httpAgent` / `httpsAgent`.
 * As with the dispatcher, a literal IP skips the lookup, so `checkWebhookUrl`
 * must still run first.
 */
export const outboundHttpAgent = new http.Agent({ lookup: guardedLookup });
export const outboundHttpsAgent = new https.Agent({ lookup: guardedLookup });
