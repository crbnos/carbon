import { randomBytes } from "node:crypto";
import { Resolver } from "node:dns/promises";

// DNS TXT ownership challenge for SSO email domains. The admin publishes
//   _carbon-challenge.<domain>  TXT  "carbon-domain-verification=<token>"
// and Carbon resolves it server-side. The underscore host keeps the record out
// of the apex TXT set and cannot collide with a real hostname (RFC 8552); the
// prefixed value self-identifies among other vendors' records. The token is
// 128 bits from the CSPRNG and unique per (company, domain) row, so a record
// one tenant's DNS operator published can never be replayed to claim the
// domain for another tenant. The check runs against pinned public resolvers
// rather than the host's — a self-hosted box's resolver may serve an internal
// view of the zone, and the c-ares defaults can back off for over a minute
// against a black-holed server.

export const TXT_HOST_PREFIX = "_carbon-challenge";
export const TXT_VALUE_PREFIX = "carbon-domain-verification";

const DNS_SERVERS = ["1.1.1.1", "8.8.8.8"];
const DNS_TIMEOUT_MS = 5000;
const DNS_TRIES = 2;

export function generateVerificationToken(): string {
  return randomBytes(16).toString("hex");
}

/** The exact record the admin must publish — the UI and the checker share it. */
export function getTxtRecord(
  domain: string,
  token: string
): { host: string; value: string } {
  return {
    host: `${TXT_HOST_PREFIX}.${domain}`,
    value: `${TXT_VALUE_PREFIX}=${token}`
  };
}

export type DomainVerificationResult =
  | { verified: true }
  | {
      verified: false;
      reason: "no_record" | "token_mismatch" | "dns_error";
    };

/**
 * Resolve the challenge TXT record and require an exact token match. Never
 * throws — every failure collapses to a reason the action can phrase for the
 * admin. A TXT record arrives as an array of ≤255-byte chunks; the chunks are
 * one logical string and are joined before comparison.
 */
export async function checkDomainVerification(
  domain: string,
  token: string
): Promise<DomainVerificationResult> {
  const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: DNS_TRIES });
  resolver.setServers(DNS_SERVERS);

  const { host, value } = getTxtRecord(domain, token);

  try {
    const records = await resolver.resolveTxt(host);
    const values = records.map((chunks) => chunks.join(""));
    if (values.includes(value)) {
      return { verified: true };
    }
    return {
      verified: false,
      reason: values.length > 0 ? "token_mismatch" : "no_record"
    };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    // ENOTFOUND: the challenge hostname does not resolve at all — for a TXT
    // query that is the ordinary "record not published yet" answer (NXDOMAIN
    // on _carbon-challenge.<domain> even when <domain> itself exists).
    // ENODATA: the name exists but holds no TXT records.
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return { verified: false, reason: "no_record" };
    }
    return { verified: false, reason: "dns_error" };
  }
}
