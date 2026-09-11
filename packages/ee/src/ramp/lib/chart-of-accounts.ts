import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RampApiError, type RampClient } from "./client";
import { getRampIntegration, RAMP } from "./connection";

/** Ramp caps a `POST /accounting/accounts` batch at 500 gl_accounts. */
export const RAMP_ACCOUNTS_BATCH_SIZE = 500;

type GlAccountClass = Database["public"]["Enums"]["glAccountClass"];

/** Carbon GL account class -> Ramp `classification`. */
const RAMP_CLASSIFICATION_BY_CLASS: Record<GlAccountClass, string> = {
  Asset: "ASSET",
  Liability: "LIABILITY",
  Equity: "EQUITY",
  Revenue: "REVENUE",
  Expense: "EXPENSE"
};

/**
 * Map a Carbon account class to the Ramp `classification` value. The account
 * mapped as the card-liability account is always `CREDCARD`, whatever its class.
 * An account with no class cannot be classified -> `null` (the caller skips it).
 */
export function rampClassificationForClass(
  glClass: GlAccountClass | null | undefined,
  isCardLiability: boolean
): string | null {
  if (isCardLiability) return "CREDCARD";
  if (!glClass) return null;
  return RAMP_CLASSIFICATION_BY_CLASS[glClass];
}

/** Split `items` into contiguous batches of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk size must be greater than 0");
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

// /********************************************************\
// *              Master-data push (CoA, dims)             *
// \********************************************************/

/** A GL account in the shape Carbon pushes to Ramp. */
export type RampGlAccount = {
  id: string;
  name: string;
  code?: string;
  classification: string;
  /** Selectable in Ramp's coding picker (see {@link isCodableAccount}); default true. */
  visible?: boolean;
};

/**
 * Stable fingerprint of the fields Carbon can UPDATE in Ramp (name + code +
 * visibility). A change here marks an already-pushed account for a re-push.
 * Classification is set at create but is NOT a PATCH field in Ramp (422
 * "Unknown field"), so a reclassification is deliberately not tracked here —
 * it can't be propagated.
 */
function accountFingerprint(account: {
  name: string;
  code?: string;
  visible?: boolean;
}): string {
  return `${account.name} ${account.code ?? ""}|${
    account.visible === false ? "HIDDEN" : "VISIBLE"
  }`;
}

/**
 * The exact `POST /accounting/accounts` item. `visible` is Carbon-side state
 * (it drives the PATCH `visibility` and the fingerprint) and must never reach
 * the wire — Ramp rejects unknown fields with 422 DEVELOPER_7001.
 */
export function toRampGlAccountPayload(account: RampGlAccount): {
  id: string;
  name: string;
  code?: string;
  classification: string;
} {
  return {
    id: account.id,
    name: account.name,
    ...(account.code ? { code: account.code } : {}),
    classification: account.classification
  };
}

export type RampCodingAccountScope = "expense" | "all";

/**
 * Whether an account should be selectable when coding in Ramp. `"expense"`
 * keeps the picker to what a card holder can sensibly code to — Expense-class
 * accounts plus the card-liability account Ramp itself needs (CREDCARD) — and
 * hides the rest of the chart (balance sheet, revenue, control accounts) so a
 * salesperson is not choosing from 300 accounts. `"all"` exposes every
 * classifiable account, which a customer who codes bills in Ramp needs.
 */
export function isCodableAccount(
  account: { id: string; class: string | null | undefined },
  opts: {
    scope: RampCodingAccountScope;
    cardLiabilityAccountId: string | null | undefined;
  }
): boolean {
  if (account.id === opts.cardLiabilityAccountId) return true;
  if (opts.scope === "all") return true;
  return account.class === "Expense";
}

/** An `account` mapping row: Carbon id ↔ Ramp id + the last-pushed fingerprint. */
export type RampAccountMapping = {
  entityId: string;
  externalId: string | null;
  fingerprint: string | null;
};

/**
 * Pure diff of the desired chart of accounts against what was last pushed
 * (tracked in `externalIntegrationMapping`, entityType `"account"`): an unmapped
 * account is created; a mapped account whose fingerprint changed is updated; an
 * unchanged one is skipped. This is what makes a re-run (the hourly sweep, a
 * settings save, install) cheap and lets Carbon CoA edits reach Ramp.
 */
export function diffChartOfAccounts(
  desired: RampGlAccount[],
  mappings: RampAccountMapping[]
): {
  toCreate: RampGlAccount[];
  toUpdate: Array<{ account: RampGlAccount; externalId: string }>;
} {
  const byId = new Map(mappings.map((m) => [m.entityId, m]));
  const toCreate: RampGlAccount[] = [];
  const toUpdate: Array<{ account: RampGlAccount; externalId: string }> = [];
  for (const account of desired) {
    const existing = byId.get(account.id);
    if (!existing) {
      // An account that should not be selectable and was never pushed is
      // simply not pushed; one already in Ramp is hidden via the update path.
      if (account.visible !== false) toCreate.push(account);
    } else if (existing.fingerprint !== accountFingerprint(account)) {
      toUpdate.push({ account, externalId: existing.externalId ?? account.id });
    }
  }
  return { toCreate, toUpdate };
}

/**
 * Drain Ramp's uploaded GL accounts into a `Carbon account.id -> Ramp UUID` map.
 * Ramp echoes the pushed `id` (our `account.id`) and assigns its own `ramp_id`;
 * the PATCH endpoint keys on `ramp_id`, so an update must resolve it here first.
 */
async function fetchRampAccountRampIds(
  client: RampClient
): Promise<Map<string, string>> {
  const byAccountId = new Map<string, string>();
  for await (const page of client.listAccountingAccounts()) {
    for (const account of page) {
      if (account.id && account.ramp_id) {
        byAccountId.set(account.id, account.ramp_id);
      }
    }
  }
  return byAccountId;
}

/**
 * Record (upsert) the `account` mappings for the pushed accounts, stamping the
 * current fingerprint so the next diff skips them until they change again, and
 * the Ramp UUID (when known) as the external id. `createdAt`/`createdBy` are
 * omitted so a re-push never rewrites them.
 */
async function upsertAccountMappings(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  accounts: RampGlAccount[],
  rampIdByAccountId: Map<string, string>
): Promise<void> {
  if (accounts.length === 0) return;
  const now = new Date().toISOString();
  const rows = accounts.map((account) => ({
    entityType: "account",
    entityId: account.id,
    integration: RAMP,
    // Ramp's own UUID (the id its PATCH endpoint keys on); falls back to the
    // Carbon account.id for a just-created account not yet in the Ramp list.
    externalId: rampIdByAccountId.get(account.id) ?? account.id,
    companyId,
    metadata: { fingerprint: accountFingerprint(account) },
    lastSyncedAt: now,
    remoteUpdatedAt: now,
    updatedAt: now
  }));
  const { error } = await serviceRole
    .from("externalIntegrationMapping")
    .upsert(rows, {
      onConflict: "entityType,entityId,integration,companyId"
    });
  if (error) {
    throw new Error(`Failed to record Ramp account mappings: ${error.message}`);
  }
}

/**
 * Sync Carbon's active, non-group chart of accounts into Ramp as coding options,
 * as a true UPSERT (create new + update changed), tracked per account in
 * `externalIntegrationMapping`. Runs on install/settings-save and on every
 * `ramp-sync` (the hourly sweep is the correctness guarantee), so a Carbon CoA
 * edit reaches Ramp within ≤1h. An unchanged CoA is a cheap no-op (two reads,
 * no Ramp calls).
 *
 * `POST /accounting/accounts` is INSERT-ONLY (400 DEVELOPER_7020 on a duplicate
 * id) and fails a mixed batch atomically, so creates fall back to per-account on
 * that error — which also backfills mappings for accounts pushed before this was
 * mapping-tracked. Changed accounts go through `PATCH /accounting/accounts/{id}`.
 */
export async function pushChartOfAccounts(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<{ created: number; updated: number; pushed: number }> {
  const integration = await getRampIntegration(serviceRole, companyId);
  if (!integration) return { created: 0, updated: 0, pushed: 0 };

  const { client, metadata } = integration;

  // `account` (chart of accounts) is scoped by companyGroupId, NOT companyId —
  // it has no companyId column. Resolve the company's group first, then load its
  // accounts. (Filtering by companyId here errored — "column companyId does not
  // exist" — so this whole push threw and silently pushed nothing.)
  const { data: company, error: companyError } = await serviceRole
    .from("company")
    .select("companyGroupId")
    .eq("id", companyId)
    .single();
  if (companyError || !company?.companyGroupId) {
    throw new Error(
      `Failed to resolve company group for ${companyId}: ${
        companyError?.message ?? "no companyGroupId"
      }`
    );
  }

  const { data: accounts, error } = await serviceRole
    .from("account")
    .select("id, number, name, class")
    .eq("companyGroupId", company.companyGroupId)
    .eq("isGroup", false)
    .eq("active", true);

  if (error) {
    throw new Error(`Failed to load chart of accounts: ${error.message}`);
  }

  const cardLiabilityId = metadata.cardLiabilityAccountId;
  const desired: RampGlAccount[] = [];
  for (const account of accounts ?? []) {
    const classification = rampClassificationForClass(
      account.class,
      account.id === cardLiabilityId
    );
    if (!classification) continue;
    desired.push({
      id: account.id,
      name: account.name,
      code: account.number ?? undefined,
      classification,
      visible: isCodableAccount(account, {
        scope: metadata.codingAccountScope,
        cardLiabilityAccountId: cardLiabilityId
      })
    });
  }

  // What was pushed before (per Carbon account, with the last fingerprint)?
  const { data: mappingRows, error: mappingError } = await serviceRole
    .from("externalIntegrationMapping")
    .select("entityId, externalId, metadata")
    .eq("companyId", companyId)
    .eq("integration", RAMP)
    .eq("entityType", "account");
  if (mappingError) {
    throw new Error(
      `Failed to load Ramp account mappings: ${mappingError.message}`
    );
  }
  const mappings: RampAccountMapping[] = (mappingRows ?? []).map((row) => ({
    entityId: row.entityId,
    externalId: row.externalId,
    fingerprint:
      (row.metadata as { fingerprint?: string } | null)?.fingerprint ?? null
  }));

  const { toCreate, toUpdate } = diffChartOfAccounts(desired, mappings);
  if (toCreate.length === 0 && toUpdate.length === 0) {
    return { created: 0, updated: 0, pushed: 0 };
  }

  // Resolve Ramp's internal ids once: PATCH keys on `ramp_id`, and it's stored
  // as the mapping's external id.
  const rampIdByAccountId = await fetchRampAccountRampIds(client);

  // Creates — batch POST; on an already-exists conflict retry per account so a
  // first-run backfill (accounts pushed before this was mapping-tracked) records
  // the mapping instead of failing the whole batch atomically.
  let created = 0;
  for (const batch of chunk(toCreate, RAMP_ACCOUNTS_BATCH_SIZE)) {
    try {
      await client.postAccountingAccounts({
        gl_accounts: batch.map(toRampGlAccountPayload)
      });
      created += batch.length;
    } catch (err) {
      if (!(err instanceof RampApiError && err.code === "DEVELOPER_7020")) {
        throw err;
      }
      for (const account of batch) {
        try {
          await client.postAccountingAccounts({
            gl_accounts: [toRampGlAccountPayload(account)]
          });
          created += 1;
        } catch (perErr) {
          // Already in Ramp from an earlier push — record the mapping anyway.
          if (
            !(
              perErr instanceof RampApiError && perErr.code === "DEVELOPER_7020"
            )
          ) {
            throw perErr;
          }
        }
      }
    }
    await upsertAccountMappings(
      serviceRole,
      companyId,
      batch,
      rampIdByAccountId
    );
  }

  // Updates — PATCH by the Ramp UUID (the Carbon account.id 404s), then bump the
  // mapping. An account with no resolvable `ramp_id` is left for the next run
  // (its create/backfill will have registered it by then).
  let updated = 0;
  for (const { account } of toUpdate) {
    const rampId = rampIdByAccountId.get(account.id);
    if (!rampId) {
      console.warn(
        `[ramp] no ramp_id for account ${account.id}; skipping update this run`
      );
      continue;
    }
    // name, code and visibility are PATCHable in Ramp; classification is
    // create-only. Visibility is what scopes the coding picker (isCodableAccount).
    await client.patchAccountingAccount(rampId, {
      name: account.name,
      code: account.code,
      visibility: account.visible === false ? "HIDDEN" : "VISIBLE"
    });
    await upsertAccountMappings(
      serviceRole,
      companyId,
      [account],
      rampIdByAccountId
    );
    updated += 1;
  }

  return { created, updated, pushed: created + updated };
}
