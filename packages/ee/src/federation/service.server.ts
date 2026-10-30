// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { randomBytes } from "node:crypto";
import { bustApiKeyCache, hashApiKey } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { FEDERATION_ALLOW_PRIVATE_ISSUERS } from "@carbon/env";
import { Ratelimit, redis } from "@carbon/kv";
import { checkOutboundUrl } from "@carbon/lib/url-guard.server";
import { getLogger } from "@carbon/logger";
import { datetime, RoundingMode, round } from "@carbon/utils";
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

// Built on first use, so importing this module touches no Redis client.
let limiters: { caller: Ratelimit; rule: Ratelimit } | undefined;
function getLimiters() {
  limiters ??= {
    caller: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        FEDERATION_LIMITS.attemptsPerCallerPerMinute,
        "1 m"
      ),
      prefix: "federation-attempt"
    }),
    rule: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        FEDERATION_LIMITS.exchangesPerMinute,
        "1 m"
      ),
      prefix: "federation-exchange"
    })
  };
  return limiters;
}

type ServiceError = { message: string; code?: string };

/** The network half of the issuer check: the host must not resolve inward. */
async function issuerNetworkError(
  issuer: string
): Promise<ServiceError | null> {
  if (FEDERATION_ALLOW_PRIVATE_ISSUERS) return null;
  const verdict = await checkOutboundUrl(issuer);
  return verdict.ok ? null : { message: `Issuer: ${verdict.reason}` };
}

function requirementError(rule: FederationRuleInput): ServiceError | null {
  const first = Object.values(ruleRequirementErrors(rule))[0];
  return first ? { message: first } : null;
}

type TrustFields = {
  issuer: string;
  audience: string;
  subject: string | null;
  claimConditions: unknown;
};

/** The fields a key's trust rests on. A change means the old keys were minted for a workload the rule no longer names. */
function trustChanged(before: TrustFields, after: TrustFields): boolean {
  return (
    before.issuer !== after.issuer ||
    before.audience !== after.audience ||
    before.subject !== after.subject ||
    !sameJson(before.claimConditions, after.claimConditions)
  );
}

/** Order-insensitive for object keys, as jsonb returns them sorted. */
function sameJson(a: unknown, b: unknown): boolean {
  const sorted = (value: unknown) =>
    JSON.stringify(
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>).sort(([x], [y]) =>
              x.localeCompare(y)
            )
          )
        : value
    );
  return sorted(a) === sorted(b);
}

/**
 * Creates or updates a rule. RLS denies API writes on federationRule: the
 * operation checked the caller's permission, sets `createdBy` to the caller,
 * and every write here is scoped to the company. An update and what it does
 * to the keys the rule already minted (revoke on a trust change, else
 * rescope) commit together, so a refused key write never leaves the new
 * trust saved beside the old keys.
 */
export async function upsertFederationRule(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  rule:
    | (FederationRuleInput & { companyId: string; createdBy: string })
    | (FederationRuleInput & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
): Promise<{ data: { id: string } | null; error: ServiceError | null }> {
  await requireEntitlement(client, rule.companyId, "API_KEYS");

  const invalid = requirementError(rule);
  if (invalid) return { data: null, error: invalid };

  const columns = {
    name: rule.name,
    provider: rule.provider,
    issuer: rule.issuer,
    audience: rule.audience,
    subject: rule.subject,
    claimConditions: JSON.stringify(rule.claimConditions),
    scopes: JSON.stringify(rule.scopes),
    tokenLifetimeMinutes: rule.tokenLifetimeMinutes
  };

  if ("createdBy" in rule) {
    const networkError = await issuerNetworkError(rule.issuer);
    if (networkError) return { data: null, error: networkError };
    const inserted = await getCarbonServiceRole()
      .from("federationRule")
      .insert({
        ...columns,
        claimConditions: rule.claimConditions,
        scopes: rule.scopes,
        companyId: rule.companyId,
        createdBy: rule.createdBy
      })
      .select("id")
      .single();
    return { data: inserted.data, error: inserted.error };
  }

  const previous = await db
    .selectFrom("federationRule")
    .select(["issuer", "audience", "subject", "claimConditions"])
    .where("id", "=", rule.id)
    .where("companyId", "=", rule.companyId)
    .executeTakeFirst();
  if (!previous) {
    return {
      data: null,
      error: { message: "Federation rule not found", code: "PGRST116" }
    };
  }
  // Only a changed issuer is resolved again: a DNS hiccup must not block an
  // urgent scope narrowing.
  if (previous.issuer !== rule.issuer) {
    const networkError = await issuerNetworkError(rule.issuer);
    if (networkError) return { data: null, error: networkError };
  }
  const revoke = trustChanged(previous, rule);

  let keyHashes: string[];
  try {
    keyHashes = await db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable("federationRule")
        .set({
          ...columns,
          updatedBy: rule.updatedBy,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", rule.id)
        .where("companyId", "=", rule.companyId)
        .returning("id")
        .executeTakeFirst();
      if (!updated) throw new Error("Federation rule not found");

      const keys = revoke
        ? await trx
            .deleteFrom("apiKey")
            .where("federationRuleId", "=", rule.id)
            .where("companyId", "=", rule.companyId)
            .returning("keyHash")
            .execute()
        : await trx
            .updateTable("apiKey")
            .set({ scopes: JSON.stringify(rule.scopes) })
            .where("federationRuleId", "=", rule.id)
            .where("companyId", "=", rule.companyId)
            .returning("keyHash")
            .execute();
      return keys.map(({ keyHash }) => keyHash);
    });
  } catch (error) {
    log.error("Failed to update federation rule", { ruleId: rule.id, error });
    const code = (error as { code?: string }).code;
    return {
      data: null,
      error: { message: "Failed to save federation rule", code }
    };
  }

  // After commit: a request re-reads the key, now revoked or rescoped.
  await Promise.all(keyHashes.map(bustApiKeyCache));
  return { data: { id: rule.id }, error: null };
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

  // RLS denies API writes on federationRule (see upsertFederationRule).
  const deleted = await getCarbonServiceRole()
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

/** Deletes one minted key; a failure is logged, as the key expires on its own. */
async function revokeKey(keyHash: string, companyId: string) {
  const { error } = await getCarbonServiceRole()
    .from("apiKey")
    .delete()
    .eq("keyHash", keyHash)
    .eq("companyId", companyId);
  if (error) log.error("Failed to revoke a federated api key", { error });
  await bustApiKeyCache(keyHash);
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
  // Whole seconds for EX, rounded up so the record never expires before the token.
  const ttl = Math.max(
    1,
    round(
      expiresAt + FEDERATION_LIMITS.clockToleranceSeconds - Date.now() / 1_000,
      0,
      RoundingMode.Up
    )
  );
  const claimed = await redis.set(key, "1", "EX", ttl, "NX");
  if (claimed === "OK") return null;
  // `set` answers null both for a key that exists and for Redis being down.
  const exists = await redis.exists(key);
  return exists === 1 ? "jti_reused" : "replay_check_unavailable";
}

async function recordOutcome(
  rule: { id: string; companyId: string },
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
    .eq("id", rule.id)
    .eq("companyId", rule.companyId);
  if (error) {
    log.error("Failed to record federation outcome", {
      ruleId: rule.id,
      error
    });
  }
}

/**
 * Exchanges an OIDC JWT for a short-lived Carbon API key under one rule. The
 * caller learns only success or `invalid_grant`; the reason is stored on the
 * rule for its admin.
 */
export async function exchangeFederatedToken(
  input: { ruleId: string; subjectToken: string; clientIp?: string | null },
  getKeySet?: FederationKeyResolver
): Promise<ExchangeResult> {
  // First, before any read: the rule id is public.
  const { caller, rule: ruleLimit } = getLimiters();
  const attempt = await caller.limit(
    `${input.ruleId}:${input.clientIp ?? "unknown"}`
  );
  if (!attempt.success) return { ok: false, reason: "rate_limited" };

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
    await recordOutcome(rule, { ok: false, reason });
    return { ok: false, reason };
  };

  if (
    !(await companyHasFeature(serviceRole, rule.companyId, {
      feature: "API_KEYS"
    }))
  ) {
    return fail("not_entitled");
  }

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

  // Only a token the issuer signed for this workload spends its budget.
  const { success } = await ruleLimit.limit(rule.id);
  if (!success) return { ok: false, reason: "rate_limited" };

  if (token.jti) {
    const replay = await claimJti(rule.issuer, token.jti, token.expiresAt);
    if (replay) return fail(replay);
  }

  // The key acts as the rule's creator: once they leave the company, as with
  // an OAuth connector (`oauthContext`), the rule stops minting.
  const membership = await serviceRole
    .from("userToCompany")
    .select("role")
    .eq("userId", rule.createdBy)
    .eq("companyId", rule.companyId)
    .maybeSingle();
  if (membership.data?.role !== "employee") {
    return fail("creator_not_employee");
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

  // A rule edit that committed while this exchange ran revoked or rescoped
  // every key that existed then. Hold this one to the rule as it is now.
  const keyHash = hashApiKey(rawKey);
  const current = await serviceRole
    .from("federationRule")
    .select("issuer, audience, subject, claimConditions, scopes")
    .eq("id", rule.id)
    .eq("companyId", rule.companyId)
    .maybeSingle();
  if (current.error) {
    await revokeKey(keyHash, rule.companyId);
    throw new Error("Failed to re-read the federation rule");
  }
  if (!current.data || trustChanged(rule, current.data)) {
    await revokeKey(keyHash, rule.companyId);
    return fail("rule_changed");
  }
  if (!sameJson(current.data.scopes, rule.scopes)) {
    const rescoped = await serviceRole
      .from("apiKey")
      .update({ scopes: current.data.scopes })
      .eq("keyHash", keyHash)
      .eq("companyId", rule.companyId);
    if (rescoped.error) {
      await revokeKey(keyHash, rule.companyId);
      throw new Error("Failed to rescope a federated API key");
    }
    await bustApiKeyCache(keyHash);
  }

  await recordOutcome(rule, { ok: true });
  return { ok: true, key: rawKey, expiresIn: lifetimeMinutes * 60 };
}
