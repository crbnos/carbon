// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { FEDERATION_LIMITS, SHARED_ISSUER_REQUIREMENTS } from "./constants";

/**
 * Why an exchange was refused. The caller only ever sees `invalid_grant`; the
 * reason is stored on the rule for the admin (Anthropic's model: an opaque
 * error outside, the real cause in the console).
 */
export type FederationFailure =
  | "rule_not_found"
  | "not_entitled"
  | "malformed_jwt"
  | "missing_kid"
  | "algorithm_not_allowed"
  | "issuer_mismatch"
  | "discovery_failed"
  | "signature_invalid"
  | "audience_mismatch"
  | "expired"
  | "not_yet_valid"
  | "lifetime_too_long"
  | "missing_claims"
  | "subject_mismatch"
  | "claim_mismatch"
  | "jti_reused"
  | "replay_check_unavailable"
  | "creator_not_employee";

/** Asymmetric algorithms only: an `HS*` token would be signed with a secret Carbon never holds. */
export const ALLOWED_JWT_ALGORITHMS = [
  "RS256",
  "RS384",
  "RS512",
  "ES256",
  "ES384",
  "ES512",
  "PS256",
  "PS384",
  "PS512"
] as const;

/** Exact, or a prefix when the pattern ends in `*`. No pattern matches every subject. */
export function matchSubject(pattern: string | null, subject: string): boolean {
  if (pattern === null) return true;
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return prefix.length > 0 && subject.startsWith(prefix);
  }
  return subject === pattern;
}

/** A claim compared as text: GitHub sends ids as strings, other issuers as numbers. */
function claimText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

/** The first condition the claims do not meet, or null when all match. */
export function firstClaimMismatch(
  conditions: Record<string, string>,
  claims: Record<string, unknown>
): string | null {
  for (const [claim, expected] of Object.entries(conditions)) {
    if (claimText(claims[claim]) !== expected) return claim;
  }
  return null;
}

/** The issuer as the shared-issuer table keys it: no trailing slash. */
function issuerKey(issuer: string): string {
  return issuer.trim().replace(/\/+$/, "");
}

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * The parts of the issuer check that need no network: https, the default
 * port, a host name rather than an IP literal. The host's addresses are
 * checked by the server before any fetch.
 */
export function issuerUrlError(issuer: string): string | null {
  let url: URL;
  try {
    url = new URL(issuer.trim());
  } catch {
    return "Enter the issuer as a full URL, for example https://token.actions.githubusercontent.com";
  }
  if (url.protocol !== "https:") return "The issuer must use https";
  if (url.port !== "" && url.port !== "443") {
    return "The issuer must use the default https port";
  }
  if (url.username || url.password) {
    return "Remove the username and password from the issuer";
  }
  if (IPV4_LITERAL.test(url.hostname) || url.hostname.startsWith("[")) {
    return "The issuer must be a host name, not an IP address";
  }
  if (url.search || url.hash) {
    return "Remove the query string from the issuer";
  }
  return null;
}

type RuleShape = {
  issuer: string;
  subject: string | null;
  claimConditions: Record<string, string>;
};

/**
 * Field errors for a rule that would trust more than one workload. Shared by
 * the form validator and the server write, so neither can be skipped.
 */
export function ruleRequirementErrors(
  rule: RuleShape
): Partial<Record<"issuer" | "subject" | "claimConditions", string>> {
  const errors: Partial<
    Record<"issuer" | "subject" | "claimConditions", string>
  > = {};
  const subject = rule.subject?.trim() || null;
  const claims = Object.keys(rule.claimConditions);

  const issuerError = issuerUrlError(rule.issuer);
  if (issuerError) errors.issuer = issuerError;

  if (subject === "*") {
    errors.subject =
      "A subject of * trusts every workload the issuer signs for. Name the workload.";
  }
  // A prefix ends at a separator: `org:acme*` would also match `org:acme-evil`.
  if (
    subject &&
    subject !== "*" &&
    subject.endsWith("*") &&
    !/[:/]\*$/.test(subject)
  ) {
    errors.subject =
      "End a prefix at a : or / before the *, for example repo:acme/plm:*";
  }
  if (!subject && claims.length === 0) {
    errors.subject = "Add a subject or at least one claim condition";
  }
  if (claims.length > FEDERATION_LIMITS.maxClaimConditions) {
    errors.claimConditions = `Use at most ${FEDERATION_LIMITS.maxClaimConditions} claim conditions`;
  }

  const shared = SHARED_ISSUER_REQUIREMENTS[issuerKey(rule.issuer)];
  if (shared?.requiredClaim && !claims.includes(shared.requiredClaim)) {
    errors.claimConditions = `Add the ${shared.requiredClaim} claim. ${shared.label} signs tokens for every customer, and ${shared.requiredClaim} does not change when a name does.`;
  }
  if (shared?.exactSubject && (!subject || subject.endsWith("*"))) {
    errors.subject = `${shared.label} signs tokens for every customer. Enter the exact numeric subject of the service account.`;
  }

  return errors;
}
