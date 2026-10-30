// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { randomBytes, X509Certificate } from "node:crypto";
import { bustApiKeyCache, hashApiKey } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { toJson } from "@carbon/database/json";
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
  issuerConfigErrors,
  matchSubject,
  mintedKeyLifetimeSeconds,
  nameError,
  ruleRequirementErrors
} from "./match";
import type { FederationIssuerInput, FederationRuleInput } from "./models";
import {
  type FederationKeyResolver,
  type IssuerKeySource,
  verifySubjectToken
} from "./verify.server";

/**
 * Commercial (Business) workload identity federation. Issuer and rule
 * AUTHORING embeds `requireEntitlement("API_KEYS")`; the EXCHANGE degrades
 * through `companyHasFeature` and refuses the token. A minted key is an
 * ordinary `apiKey` row, so the open carbon-key path authenticates it
 * unchanged. RLS denies API writes on both tables: the ERP operations checked
 * the caller's permission, and every write here is scoped to its company.
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
type WriteResult = Promise<{
  data: { id: string } | null;
  error: ServiceError | null;
}>;

const NOT_FOUND = "PGRST116";

/** Order-insensitive for object keys, as jsonb returns them sorted. */
function sameJson(a: unknown, b: unknown): boolean {
  const sorted = (value: unknown): string =>
    JSON.stringify(value, (_key, inner) =>
      inner && typeof inner === "object" && !Array.isArray(inner)
        ? Object.fromEntries(
            Object.entries(inner as Record<string, unknown>).sort(([x], [y]) =>
              x.localeCompare(y)
            )
          )
        : inner
    );
  return sorted(a ?? null) === sorted(b ?? null);
}

type KeySourceFields = Pick<
  FederationIssuerInput,
  | "issuer"
  | "jwksSource"
  | "discoveryUrl"
  | "jwksUrl"
  | "jwks"
  | "caCertificate"
>;

/** The fields the minted keys' trust rests on: a change revokes them. */
function keySourceChanged(a: KeySourceFields, b: KeySourceFields): boolean {
  return (
    a.issuer !== b.issuer ||
    a.jwksSource !== b.jwksSource ||
    (a.discoveryUrl ?? null) !== (b.discoveryUrl ?? null) ||
    (a.jwksUrl ?? null) !== (b.jwksUrl ?? null) ||
    (a.caCertificate ?? null) !== (b.caCertificate ?? null) ||
    !sameJson(a.jwks, b.jwks)
  );
}

type RuleTrustFields = {
  issuerId: string;
  audience: string;
  subject: string | null;
  claimConditions: unknown;
};

/** A change means the old keys were minted for a workload the rule no longer names. */
function ruleTrustChanged(a: RuleTrustFields, b: RuleTrustFields): boolean {
  return (
    a.issuerId !== b.issuerId ||
    a.audience !== b.audience ||
    (a.subject ?? null) !== (b.subject ?? null) ||
    !sameJson(a.claimConditions, b.claimConditions)
  );
}

/** The network half of the issuer check: the URLs Carbon will fetch must not resolve inward. */
async function issuerNetworkError(
  issuer: FederationIssuerInput
): Promise<ServiceError | null> {
  if (FEDERATION_ALLOW_PRIVATE_ISSUERS) return null;
  const target =
    issuer.jwksSource === "OIDC Discovery"
      ? (issuer.discoveryUrl ?? issuer.issuer)
      : issuer.jwksSource === "JWKS URL"
        ? issuer.jwksUrl
        : null;
  if (!target) return null;
  const verdict = await checkOutboundUrl(target);
  if (verdict.ok) return null;
  const field =
    issuer.jwksSource === "JWKS URL"
      ? "JWKS URL"
      : issuer.discoveryUrl
        ? "Discovery URL"
        : "Issuer";
  return { message: `${field}: ${verdict.reason}` };
}

function issuerError(issuer: FederationIssuerInput): ServiceError | null {
  const first = Object.values(issuerConfigErrors(issuer))[0];
  if (first) return { message: first };
  if (issuer.caCertificate) {
    try {
      new X509Certificate(issuer.caCertificate);
    } catch {
      return { message: "The CA certificate could not be read" };
    }
  }
  return null;
}

/** Every active rule of an issuer must still name a workload under the issuer's URL. */
async function issuerBreaksRule(
  db: Kysely<KyselyDatabase>,
  issuerId: string,
  companyId: string,
  issuerUrl: string
): Promise<ServiceError | null> {
  const rules = await db
    .selectFrom("federationRule")
    .select(["name", "subject", "claimConditions"])
    .where("issuerId", "=", issuerId)
    .where("companyId", "=", companyId)
    .where("archivedAt", "is", null)
    .execute();
  for (const rule of rules) {
    const errors = ruleRequirementErrors({
      issuer: issuerUrl,
      subject: rule.subject,
      claimConditions: (rule.claimConditions ?? {}) as Record<string, string>
    });
    const first = errors.subject ?? errors.claimConditions;
    if (first) return { message: `Rule ${rule.name}: ${first}` };
  }
  return null;
}

/** Deletes minted keys inside a transaction and returns their hashes, to drop the cache after commit. */
async function deleteMintedKeys(
  trx: Kysely<KyselyDatabase>,
  companyId: string,
  ruleIds: string[]
): Promise<string[]> {
  if (ruleIds.length === 0) return [];
  const deleted = await trx
    .deleteFrom("apiKey")
    .where("federationRuleId", "in", ruleIds)
    .where("companyId", "=", companyId)
    .returning("keyHash")
    .execute();
  return deleted.map(({ keyHash }) => keyHash);
}

function writeError(error: unknown, what: string): ServiceError {
  const code = (error as { code?: string })?.code;
  log.error("Failed to save federation record", { what, error });
  return {
    message:
      code === "23505"
        ? `An active federation ${what} with this name already exists`
        : `Failed to save federation ${what}`,
    code: code === "23505" ? undefined : (code ?? "unknown")
  };
}

export async function upsertFederationIssuer(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  issuer:
    | (FederationIssuerInput & { companyId: string; createdBy: string })
    | (FederationIssuerInput & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
): WriteResult {
  await requireEntitlement(client, issuer.companyId, "API_KEYS");
  const invalid = issuerError(issuer);
  if (invalid) return { data: null, error: invalid };

  const columns = {
    name: issuer.name,
    provider: issuer.provider,
    issuer: issuer.issuer,
    jwksSource: issuer.jwksSource,
    discoveryUrl: issuer.discoveryUrl,
    jwksUrl: issuer.jwksUrl,
    jwks: toJson(issuer.jwks),
    caCertificate: issuer.caCertificate,
    requireUniqueJti: issuer.requireUniqueJti,
    maxTokenLifetimeHours: issuer.maxTokenLifetimeHours
  };

  if ("createdBy" in issuer) {
    const network = await issuerNetworkError(issuer);
    if (network) return { data: null, error: network };
    try {
      const inserted = await db
        .insertInto("federationIssuer")
        .values({
          ...columns,
          companyId: issuer.companyId,
          createdBy: issuer.createdBy
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return { data: inserted, error: null };
    } catch (error) {
      return { data: null, error: writeError(error, "issuer") };
    }
  }

  const previous = await db
    .selectFrom("federationIssuer")
    .select([
      "issuer",
      "jwksSource",
      "discoveryUrl",
      "jwksUrl",
      "jwks",
      "caCertificate",
      "archivedAt"
    ])
    .where("id", "=", issuer.id)
    .where("companyId", "=", issuer.companyId)
    .executeTakeFirst();
  if (!previous) {
    return {
      data: null,
      error: { message: "Federation issuer not found", code: NOT_FOUND }
    };
  }
  if (previous.archivedAt) {
    return {
      data: null,
      error: { message: "An archived issuer cannot change" }
    };
  }

  const revoke = keySourceChanged(previous as KeySourceFields, issuer);
  // Only a changed key source is resolved again: a DNS hiccup must not block
  // an unrelated edit.
  if (revoke) {
    const network = await issuerNetworkError(issuer);
    if (network) return { data: null, error: network };
  }
  if (previous.issuer !== issuer.issuer) {
    const broken = await issuerBreaksRule(
      db,
      issuer.id,
      issuer.companyId,
      issuer.issuer
    );
    if (broken) return { data: null, error: broken };
  }

  let keyHashes: string[];
  try {
    keyHashes = await db.transaction().execute(async (trx) => {
      await trx
        .updateTable("federationIssuer")
        .set({
          ...columns,
          updatedBy: issuer.updatedBy,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", issuer.id)
        .where("companyId", "=", issuer.companyId)
        .executeTakeFirstOrThrow();
      if (!revoke) return [];
      const rules = await trx
        .selectFrom("federationRule")
        .select("id")
        .where("issuerId", "=", issuer.id)
        .where("companyId", "=", issuer.companyId)
        .execute();
      return deleteMintedKeys(
        trx,
        issuer.companyId,
        rules.map(({ id }) => id)
      );
    });
  } catch (error) {
    return { data: null, error: writeError(error, "issuer") };
  }
  await Promise.all(keyHashes.map(bustApiKeyCache));
  return { data: { id: issuer.id }, error: null };
}

/**
 * Archives an issuer and every rule of it, and revokes the keys they minted,
 * in one transaction. The rows stay for the history.
 */
export async function archiveFederationIssuer(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: { id: string; companyId: string; updatedBy: string }
): WriteResult {
  await requireEntitlement(client, args.companyId, "API_KEYS");
  const at = datetime.timestamp();
  let keyHashes: string[];
  try {
    keyHashes = await db.transaction().execute(async (trx) => {
      const archived = await trx
        .updateTable("federationIssuer")
        .set({ archivedAt: at, updatedBy: args.updatedBy, updatedAt: at })
        .where("id", "=", args.id)
        .where("companyId", "=", args.companyId)
        .where("archivedAt", "is", null)
        .returning("id")
        .executeTakeFirst();
      if (!archived) {
        throw Object.assign(new Error("not found"), { code: NOT_FOUND });
      }
      const rules = await trx
        .updateTable("federationRule")
        .set({ archivedAt: at, updatedBy: args.updatedBy, updatedAt: at })
        .where("issuerId", "=", args.id)
        .where("companyId", "=", args.companyId)
        .where("archivedAt", "is", null)
        .returning("id")
        .execute();
      return deleteMintedKeys(
        trx,
        args.companyId,
        rules.map(({ id }) => id)
      );
    });
  } catch (error) {
    if ((error as { code?: string }).code === NOT_FOUND) {
      return {
        data: null,
        error: { message: "Federation issuer not found", code: NOT_FOUND }
      };
    }
    return { data: null, error: writeError(error, "issuer") };
  }
  await Promise.all(keyHashes.map(bustApiKeyCache));
  return { data: { id: args.id }, error: null };
}

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
): WriteResult {
  await requireEntitlement(client, rule.companyId, "API_KEYS");

  const name = nameError(rule.name);
  if (name) return { data: null, error: { message: name } };

  const issuer = await db
    .selectFrom("federationIssuer")
    .select(["issuer", "archivedAt"])
    .where("id", "=", rule.issuerId)
    .where("companyId", "=", rule.companyId)
    .executeTakeFirst();
  if (!issuer || issuer.archivedAt) {
    return { data: null, error: { message: "Choose an active issuer" } };
  }
  const requirements = ruleRequirementErrors({
    issuer: issuer.issuer,
    subject: rule.subject,
    claimConditions: rule.claimConditions
  });
  const firstRequirement = requirements.subject ?? requirements.claimConditions;
  if (firstRequirement) {
    return { data: null, error: { message: firstRequirement } };
  }

  const columns = {
    name: rule.name,
    description: rule.description,
    issuerId: rule.issuerId,
    audience: rule.audience,
    subject: rule.subject,
    claimConditions: toJson(rule.claimConditions),
    scopes: toJson(rule.scopes),
    tokenLifetimeMinutes: rule.tokenLifetimeMinutes
  };

  if ("createdBy" in rule) {
    try {
      const inserted = await db
        .insertInto("federationRule")
        .values({
          ...columns,
          companyId: rule.companyId,
          createdBy: rule.createdBy
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return { data: inserted, error: null };
    } catch (error) {
      return { data: null, error: writeError(error, "rule") };
    }
  }

  const previous = await db
    .selectFrom("federationRule")
    .select([
      "issuerId",
      "audience",
      "subject",
      "claimConditions",
      "archivedAt"
    ])
    .where("id", "=", rule.id)
    .where("companyId", "=", rule.companyId)
    .executeTakeFirst();
  if (!previous) {
    return {
      data: null,
      error: { message: "Federation rule not found", code: NOT_FOUND }
    };
  }
  if (previous.archivedAt) {
    return { data: null, error: { message: "An archived rule cannot change" } };
  }
  const revoke = ruleTrustChanged(previous, rule);

  let keyHashes: string[];
  try {
    // The rule and what the edit does to its keys commit together.
    keyHashes = await db.transaction().execute(async (trx) => {
      await trx
        .updateTable("federationRule")
        .set({
          ...columns,
          updatedBy: rule.updatedBy,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", rule.id)
        .where("companyId", "=", rule.companyId)
        .executeTakeFirstOrThrow();
      if (revoke) return deleteMintedKeys(trx, rule.companyId, [rule.id]);
      const rescoped = await trx
        .updateTable("apiKey")
        .set({ scopes: toJson(rule.scopes) })
        .where("federationRuleId", "=", rule.id)
        .where("companyId", "=", rule.companyId)
        .returning("keyHash")
        .execute();
      return rescoped.map(({ keyHash }) => keyHash);
    });
  } catch (error) {
    return { data: null, error: writeError(error, "rule") };
  }
  // After commit: a request re-reads the key, now revoked or rescoped.
  await Promise.all(keyHashes.map(bustApiKeyCache));
  return { data: { id: rule.id }, error: null };
}

/** Archives a rule and revokes the keys it minted, in one transaction. */
export async function archiveFederationRule(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: { id: string; companyId: string; updatedBy: string }
): WriteResult {
  await requireEntitlement(client, args.companyId, "API_KEYS");
  const at = datetime.timestamp();
  let keyHashes: string[];
  try {
    keyHashes = await db.transaction().execute(async (trx) => {
      const archived = await trx
        .updateTable("federationRule")
        .set({ archivedAt: at, updatedBy: args.updatedBy, updatedAt: at })
        .where("id", "=", args.id)
        .where("companyId", "=", args.companyId)
        .where("archivedAt", "is", null)
        .returning("id")
        .executeTakeFirst();
      if (!archived) {
        throw Object.assign(new Error("not found"), { code: NOT_FOUND });
      }
      return deleteMintedKeys(trx, args.companyId, [args.id]);
    });
  } catch (error) {
    if ((error as { code?: string }).code === NOT_FOUND) {
      return {
        data: null,
        error: { message: "Federation rule not found", code: NOT_FOUND }
      };
    }
    return { data: null, error: writeError(error, "rule") };
  }
  await Promise.all(keyHashes.map(bustApiKeyCache));
  return { data: { id: args.id }, error: null };
}

export type ExchangeResult =
  | { ok: true; key: string; expiresIn: number }
  | { ok: false; reason: FederationFailure | "rate_limited" };

/** Records the jti until the token can no longer verify; fails closed without Redis. */
async function claimJti(
  issuerId: string,
  jti: string,
  expiresAt: number
): Promise<FederationFailure | null> {
  const key = `federation-jti:${issuerId}:${jti}`;
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

/** Revokes one minted key; a failure is logged, as the key expires on its own. */
async function revokeKey(keyHash: string, companyId: string) {
  const { error } = await getCarbonServiceRole()
    .from("apiKey")
    .delete()
    .eq("keyHash", keyHash)
    .eq("companyId", companyId);
  if (error) log.error("Failed to revoke a federated api key", { error });
  await bustApiKeyCache(keyHash);
}

type ExchangeRule = {
  id: string;
  companyId: string;
  issuerId: string;
  audience: string;
  subject: string | null;
  claimConditions: unknown;
  scopes: unknown;
  tokenLifetimeMinutes: number;
  createdBy: string;
  archivedAt: string | null;
};

type ExchangeIssuer = IssuerKeySource & {
  requireUniqueJti: boolean;
  archivedAt: string | null;
};

const RULE_COLUMNS =
  "id, companyId, issuerId, audience, subject, claimConditions, scopes, tokenLifetimeMinutes, createdBy, archivedAt";
const ISSUER_COLUMNS =
  "id, issuer, jwksSource, discoveryUrl, jwksUrl, jwks, caCertificate, maxTokenLifetimeHours, requireUniqueJti, updatedAt, archivedAt";

/**
 * One attempt in the log. A subject is recorded only from a token whose
 * signature verified: before that it is the caller's text.
 */
async function recordExchange(
  rule: { id: string; companyId: string; issuerId: string },
  entry: {
    outcome: "Succeeded" | "Refused";
    reason?: string;
    subject?: string;
    clientIp?: string | null;
    apiKeyId?: string;
  }
) {
  const { error } = await getCarbonServiceRole()
    .from("federationExchange")
    .insert({
      companyId: rule.companyId,
      ruleId: rule.id,
      issuerId: rule.issuerId,
      outcome: entry.outcome,
      reason: entry.reason ?? null,
      subject:
        entry.subject?.slice(0, FEDERATION_LIMITS.maxValueLength) ?? null,
      clientIp: entry.clientIp ?? null,
      apiKeyId: entry.apiKeyId ?? null
    });
  if (error) {
    log.error("Failed to record a federation exchange", {
      ruleId: rule.id,
      error
    });
  }
}

/**
 * Exchanges an OIDC JWT for a short-lived Carbon API key under one rule. The
 * caller learns only success or `invalid_grant`; the reason goes to the
 * rule's authentication events.
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
  const ruleRead = await serviceRole
    .from("federationRule")
    .select(RULE_COLUMNS)
    .eq("id", input.ruleId)
    .maybeSingle();
  if (ruleRead.error) {
    log.error("Failed to read federation rule", {
      ruleId: input.ruleId,
      error: ruleRead.error
    });
  }
  const rule = ruleRead.data as ExchangeRule | null;
  if (!rule) return { ok: false, reason: "rule_not_found" };

  const issuerRead = await serviceRole
    .from("federationIssuer")
    .select(ISSUER_COLUMNS)
    .eq("id", rule.issuerId)
    .eq("companyId", rule.companyId)
    .maybeSingle();
  const issuer = issuerRead.data as ExchangeIssuer | null;

  let verifiedSubject: string | undefined;
  const fail = async (
    reason: FederationFailure | "rate_limited"
  ): Promise<ExchangeResult> => {
    await recordExchange(rule, {
      outcome: "Refused",
      reason,
      subject: verifiedSubject,
      clientIp: input.clientIp
    });
    return { ok: false, reason };
  };

  if (!issuer || rule.archivedAt || issuer.archivedAt) {
    return fail("rule_archived");
  }

  if (
    !(await companyHasFeature(serviceRole, rule.companyId, {
      feature: "API_KEYS"
    }))
  ) {
    return fail("not_entitled");
  }

  const verified = await verifySubjectToken(
    input.subjectToken,
    issuer,
    rule.audience,
    getKeySet
  );
  if (!verified.ok) return fail(verified.reason);
  const { token } = verified;
  verifiedSubject = token.subject;

  if (!matchSubject(rule.subject, token.subject)) {
    return fail("subject_mismatch");
  }
  const conditions = (rule.claimConditions ?? {}) as Record<string, string>;
  if (firstClaimMismatch(conditions, token.claims) !== null) {
    return fail("claim_mismatch");
  }

  // Only a token the issuer signed for this workload spends its budget.
  const { success } = await ruleLimit.limit(rule.id);
  if (!success) return fail("rate_limited");

  if (issuer.requireUniqueJti) {
    if (!token.jti) return fail("missing_jti");
    const replay = await claimJti(issuer.id, token.jti, token.expiresAt);
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

  const lifetimeSeconds = round(
    mintedKeyLifetimeSeconds(
      rule.tokenLifetimeMinutes,
      token.expiresAt,
      Date.now() / 1_000
    ),
    0,
    RoundingMode.Down
  );
  const rawKey = `crbn_${randomBytes(24).toString("base64url")}`;
  const keyHash = hashApiKey(rawKey);
  const inserted = await serviceRole
    .from("apiKey")
    .insert({
      name: `federated:${rule.id}:${randomBytes(6).toString("base64url")}`,
      companyId: rule.companyId,
      createdBy: rule.createdBy,
      scopes:
        rule.scopes as Database["public"]["Tables"]["apiKey"]["Insert"]["scopes"],
      keyHash,
      keyPreview: rawKey.slice(-5),
      expiresAt: now("UTC")
        .add({ seconds: lifetimeSeconds })
        .toAbsoluteString(),
      federationRuleId: rule.id
    })
    .select("id")
    .single();
  if (inserted.error) {
    log.error("Failed to mint federated api key", {
      ruleId: rule.id,
      error: inserted.error
    });
    throw new Error("Failed to mint a federated API key");
  }

  // An edit that committed while this exchange ran revoked or rescoped every
  // key that existed then. Hold this one to the rule and issuer as they are now.
  const [currentRule, currentIssuer] = await Promise.all([
    serviceRole
      .from("federationRule")
      .select(RULE_COLUMNS)
      .eq("id", rule.id)
      .eq("companyId", rule.companyId)
      .maybeSingle(),
    serviceRole
      .from("federationIssuer")
      .select(ISSUER_COLUMNS)
      .eq("id", issuer.id)
      .eq("companyId", rule.companyId)
      .maybeSingle()
  ]);
  if (currentRule.error || currentIssuer.error) {
    await revokeKey(keyHash, rule.companyId);
    throw new Error("Failed to re-read the federation rule");
  }
  const nowRule = currentRule.data as ExchangeRule | null;
  const nowIssuer = currentIssuer.data as ExchangeIssuer | null;
  if (
    !nowRule ||
    !nowIssuer ||
    nowRule.archivedAt ||
    nowIssuer.archivedAt ||
    ruleTrustChanged(rule, nowRule) ||
    keySourceChanged(
      issuer as unknown as KeySourceFields,
      nowIssuer as unknown as KeySourceFields
    )
  ) {
    await revokeKey(keyHash, rule.companyId);
    return fail("rule_changed");
  }
  if (!sameJson(nowRule.scopes, rule.scopes)) {
    const rescoped = await serviceRole
      .from("apiKey")
      .update({
        scopes:
          nowRule.scopes as Database["public"]["Tables"]["apiKey"]["Update"]["scopes"]
      })
      .eq("keyHash", keyHash)
      .eq("companyId", rule.companyId);
    if (rescoped.error) {
      await revokeKey(keyHash, rule.companyId);
      throw new Error("Failed to rescope a federated API key");
    }
    await bustApiKeyCache(keyHash);
  }

  await recordExchange(rule, {
    outcome: "Succeeded",
    subject: token.subject,
    clientIp: input.clientIp,
    apiKeyId: inserted.data.id
  });
  return { ok: true, key: rawKey, expiresIn: lifetimeSeconds };
}
