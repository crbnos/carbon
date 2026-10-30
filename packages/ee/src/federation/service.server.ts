// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { randomBytes } from "node:crypto";
import { bustApiKeyCache, hashApiKey } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { FEDERATION_ALLOW_PRIVATE_ISSUERS } from "@carbon/env";
import { Ratelimit, redis } from "@carbon/kv";
import { checkOutboundUrl } from "@carbon/lib/url-guard.server";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import { now } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEntitlement } from "../entitlements.server";
import { companyHasFeature } from "../plan.server";
import { FEDERATION_LIMITS } from "./constants";
import {
  type FederationFailure,
  firstClaimMismatch,
  matchSubject,
  ruleRequirementErrors
} from "./match";
import type { FederationRuleInput } from "./models";
import {
  type FederationKeyResolver,
  verifySubjectToken
} from "./verify.server";

/**
 * Commercial (Business) workload identity federation. Rule AUTHORING embeds
 * `requireEntitlement("API_KEYS")`; the EXCHANGE degrades through
 * `companyHasFeature` and refuses the token. A minted key is an ordinary
 * `apiKey` row, so the open carbon-key path authenticates it unchanged.
 */

const log = getLogger("ee", "federation");

const exchangeRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(FEDERATION_LIMITS.exchangesPerMinute, "1 m"),
  prefix: "federation-exchange"
});

type ServiceError = { message: string };

/** The network half of the issuer check: the host must not resolve inward. */
export async function checkFederationIssuer(
  issuer: string
): Promise<string | null> {
  if (FEDERATION_ALLOW_PRIVATE_ISSUERS) return null;
  const verdict = await checkOutboundUrl(issuer);
  return verdict.ok ? null : verdict.reason;
}

async function validateRule(
  rule: FederationRuleInput
): Promise<ServiceError | null> {
  const errors = ruleRequirementErrors(rule);
  const first = Object.values(errors)[0];
  if (first) return { message: first };
  const issuerError = await checkFederationIssuer(rule.issuer);
  return issuerError ? { message: `Issuer: ${issuerError}` } : null;
}

export async function upsertFederationRule(
  client: SupabaseClient<Database>,
  rule:
    | (FederationRuleInput & { companyId: string; createdBy: string })
    | (FederationRuleInput & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
): Promise<{ data: { id: string } | null; error: ServiceError | null }> {
  await requireEntitlement(client, rule.companyId, "API_KEYS");

  const invalid = await validateRule(rule);
  if (invalid) return { data: null, error: invalid };

  const columns = {
    name: rule.name,
    provider: rule.provider,
    issuer: rule.issuer,
    audience: rule.audience,
    subject: rule.subject,
    claimConditions: rule.claimConditions,
    scopes: rule.scopes,
    tokenLifetimeMinutes: rule.tokenLifetimeMinutes
  };

  if ("createdBy" in rule) {
    const inserted = await client
      .from("federationRule")
      .insert({
        ...columns,
        companyId: rule.companyId,
        createdBy: rule.createdBy
      })
      .select("id")
      .single();
    return { data: inserted.data, error: inserted.error };
  }

  const updated = await client
    .from("federationRule")
    .update({
      ...columns,
      updatedBy: rule.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", rule.id)
    .eq("companyId", rule.companyId)
    .select("id")
    .single();
  if (updated.error) return { data: null, error: updated.error };

  // A narrower scope applies to the keys the rule already minted, at once.
  const rescoped = await getCarbonServiceRole()
    .from("apiKey")
    .update({ scopes: rule.scopes })
    .eq("federationRuleId", rule.id)
    .eq("companyId", rule.companyId)
    .select("keyHash");
  if (rescoped.error) {
    log.error("Failed to rescope federated api keys", {
      ruleId: rule.id,
      error: rescoped.error
    });
    return { data: null, error: rescoped.error };
  }
  await Promise.all(
    (rescoped.data ?? []).map(({ keyHash }) => bustApiKeyCache(keyHash))
  );
  return { data: updated.data, error: null };
}

/** The hashes of a rule's minted keys, to drop their cached authentication. */
async function mintedKeyHashes(
  ruleId: string,
  companyId: string
): Promise<string[]> {
  const { data, error } = await getCarbonServiceRole()
    .from("apiKey")
    .select("keyHash")
    .eq("federationRuleId", ruleId)
    .eq("companyId", companyId);
  if (error) {
    log.error("Failed to read federated api keys", { ruleId, error });
    return [];
  }
  return (data ?? []).map(({ keyHash }) => keyHash);
}

/**
 * Deletes the rule; the FK cascade deletes every key it minted. The cache is
 * dropped before (the hashes are unreadable once the rows are gone) and after
 * (a request may re-cache a live row in between), as `revokeApiKey` does.
 */
export async function deleteFederationRule(
  client: SupabaseClient<Database>,
  ruleId: string,
  companyId: string
): Promise<{ data: { id: string } | null; error: ServiceError | null }> {
  await requireEntitlement(client, companyId, "API_KEYS");

  const hashes = await mintedKeyHashes(ruleId, companyId);
  await Promise.all(hashes.map(bustApiKeyCache));

  const deleted = await client
    .from("federationRule")
    .delete()
    .eq("id", ruleId)
    .eq("companyId", companyId)
    .select("id")
    .single();
  if (deleted.error) return { data: null, error: deleted.error };

  await Promise.all(hashes.map(bustApiKeyCache));
  return { data: deleted.data, error: null };
}

export type ExchangeResult =
  | { ok: true; key: string; expiresIn: number }
  | { ok: false; reason: FederationFailure | "rate_limited" };

/** Records the jti until the token can no longer verify; fails closed without Redis. */
async function claimJti(
  issuer: string,
  jti: string,
  expiresAt: number
): Promise<FederationFailure | null> {
  const key = `federation-jti:${issuer}:${jti}`;
  const ttl = Math.max(
    1,
    expiresAt +
      FEDERATION_LIMITS.clockToleranceSeconds -
      Math.floor(Date.now() / 1_000)
  );
  const claimed = await redis.set(key, "1", "EX", ttl, "NX");
  if (claimed === "OK") return null;
  // `set` answers null both for a key that exists and for Redis being down.
  const exists = await redis.exists(key);
  return exists === 1 ? "jti_reused" : "replay_check_unavailable";
}

async function recordOutcome(
  ruleId: string,
  outcome: { ok: true } | { ok: false; reason: string }
) {
  const at = datetime.timestamp();
  const { error } = await getCarbonServiceRole()
    .from("federationRule")
    .update(
      outcome.ok
        ? { lastExchangeAt: at }
        : { lastFailureAt: at, lastFailureReason: outcome.reason }
    )
    .eq("id", ruleId);
  if (error) {
    log.error("Failed to record federation outcome", { ruleId, error });
  }
}

/**
 * Exchanges an OIDC JWT for a short-lived Carbon API key under one rule. The
 * caller learns only success or `invalid_grant`; the reason is stored on the
 * rule for its admin.
 */
export async function exchangeFederatedToken(
  input: { ruleId: string; subjectToken: string },
  getKeySet?: FederationKeyResolver
): Promise<ExchangeResult> {
  const serviceRole = getCarbonServiceRole();
  const { data: rule, error } = await serviceRole
    .from("federationRule")
    .select(
      "id, companyId, name, issuer, audience, subject, claimConditions, scopes, tokenLifetimeMinutes, createdBy"
    )
    .eq("id", input.ruleId)
    .maybeSingle();
  if (error) {
    log.error("Failed to read federation rule", {
      ruleId: input.ruleId,
      error
    });
  }
  if (!rule) return { ok: false, reason: "rule_not_found" };

  const fail = async (
    reason: FederationFailure | "rate_limited"
  ): Promise<ExchangeResult> => {
    await recordOutcome(rule.id, { ok: false, reason });
    return { ok: false, reason };
  };

  if (
    !(await companyHasFeature(serviceRole, rule.companyId, {
      feature: "API_KEYS"
    }))
  ) {
    return fail("not_entitled");
  }

  const { success } = await exchangeRatelimit.limit(rule.id);
  if (!success) return { ok: false, reason: "rate_limited" };

  const verified = await verifySubjectToken(
    input.subjectToken,
    rule,
    getKeySet
  );
  if (!verified.ok) return fail(verified.reason);
  const { token } = verified;

  if (!matchSubject(rule.subject, token.subject)) {
    return fail("subject_mismatch");
  }
  const conditions = (rule.claimConditions ?? {}) as Record<string, string>;
  if (firstClaimMismatch(conditions, token.claims) !== null) {
    return fail("claim_mismatch");
  }

  if (token.jti) {
    const replay = await claimJti(rule.issuer, token.jti, token.expiresAt);
    if (replay) return fail(replay);
  }

  const rawKey = `crbn_${randomBytes(24).toString("base64url")}`;
  const lifetimeMinutes = rule.tokenLifetimeMinutes;
  const inserted = await serviceRole.from("apiKey").insert({
    name: `federated:${rule.id}:${randomBytes(6).toString("base64url")}`,
    companyId: rule.companyId,
    createdBy: rule.createdBy,
    scopes: rule.scopes,
    keyHash: hashApiKey(rawKey),
    keyPreview: rawKey.slice(-5),
    expiresAt: now("UTC").add({ minutes: lifetimeMinutes }).toAbsoluteString(),
    federationRuleId: rule.id
  });
  if (inserted.error) {
    log.error("Failed to mint federated api key", {
      ruleId: rule.id,
      error: inserted.error
    });
    throw new Error("Failed to mint a federated API key");
  }

  await recordOutcome(rule.id, { ok: true });
  return { ok: true, key: rawKey, expiresIn: lifetimeMinutes * 60 };
}
