import { createHash } from "node:crypto";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { round } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  createMappingService,
  type ExternalIntegrationMapping,
  type ExternalIntegrationMappingService
} from "../../accounting/core/external-mapping";
import {
  persistIntegrationSecrets,
  resolveIntegrationSecrets
} from "../../integrations/secrets";
import { buildRampIdempotencyKey, RampApiError, RampClient } from "./client";
import { RAMP_COST_CENTER_FIELD_ID } from "./coding";
import {
  RampAccountingConnectionSchema,
  type RampCredentials,
  type RampCursors,
  type RampIntegrationMetadata,
  RampIntegrationMetadataSchema,
  type RampVendor
} from "./models";

/**
 * Ramp integration service — the server-only glue between Carbon and Ramp's
 * accounting-provider API. Every function takes a SERVICE-ROLE supabase client
 * (`serviceRole`) plus a `companyId`, loads the company's Ramp metadata (secrets
 * resolved from the vault), and constructs a {@link RampClient}.
 *
 * This module is server-only (it reaches the vault + a privileged client) and is
 * exported via `@carbon/ee/ramp.server` — never import it from `config.tsx`.
 */

const RAMP = "ramp";

/** Ramp caps a `POST /accounting/accounts` batch at 500 gl_accounts. */
export const RAMP_ACCOUNTS_BATCH_SIZE = 500;

/**
 * Webhook events Carbon subscribes to on install (spec §Install step 5). The
 * ready-to-sync / updated / paid events are what drive the `ramp-sync` pulls.
 */
export const RAMP_WEBHOOK_EVENT_TYPES = [
  "transactions.ready_to_sync",
  "transactions.cleared",
  "bills.ready_to_sync",
  "bills.updated",
  "bills.paid",
  "payments.updated",
  "reimbursements.ready_to_sync",
  "purchase_orders.updated"
] as const;

// /********************************************************\
// *                Pure, testable helpers                 *
// \********************************************************/

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
// *                 Metadata read/write                   *
// \********************************************************/

/** The webhook-create response Carbon reads (`id` + signing `secret`). */
const RampWebhookCreateResponseSchema = z
  .object({
    id: z.string(),
    secret: z.string().optional()
  })
  .passthrough();

/**
 * Read the RAW stored (secret-free) metadata for the company's Ramp integration.
 * Returns `null` when the integration is not installed or not active.
 */
async function readStoredRampMetadata(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceRole
    .from("companyIntegration")
    .select("metadata, active")
    .eq("id", RAMP)
    .eq("companyId", companyId)
    .maybeSingle();

  if (error || !data || !data.active) return null;
  return (data.metadata as Record<string, unknown> | null) ?? {};
}

/**
 * Read-merge-write against the RAW stored metadata column (which holds only the
 * secret-free config) so no sibling key — and no vaulted secret — is clobbered.
 * Clone of `storePullCursor`'s shape. Use this for NON-secret keys only
 * (`connectionId`, `webhookId`); secret keys go through
 * {@link persistIntegrationSecrets}.
 */
async function updateStoredRampMetadata(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  mutate: (metadata: Record<string, unknown>) => void
): Promise<void> {
  const current = await serviceRole
    .from("companyIntegration")
    .select("metadata")
    .eq("id", RAMP)
    .eq("companyId", companyId)
    .single();

  if (current.error) {
    throw new Error(
      `Failed to read Ramp integration metadata: ${current.error.message}`
    );
  }

  const metadata =
    (current.data?.metadata as Record<string, unknown> | null) ?? {};
  mutate(metadata);

  const updated = await serviceRole
    .from("companyIntegration")
    .update({ metadata: metadata as never })
    .eq("id", RAMP)
    .eq("companyId", companyId);

  if (updated.error) {
    throw new Error(
      `Failed to update Ramp integration metadata: ${updated.error.message}`
    );
  }
}

/**
 * Advance a single Ramp sync cursor (`metadata.cursors.<key>`) via the same
 * read-merge-write against the secret-free metadata column as
 * {@link updateStoredRampMetadata}, so no sibling cursor or config key — and no
 * vaulted secret — is clobbered. The outbound push steps (Task 10) persist their
 * `updatedAt` high-water marks through here; the repayment family (Task 9) writes
 * `repaymentsRepaidAt` the same way inside the job.
 */
export async function advanceRampCursor(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  key: keyof NonNullable<RampCursors>,
  value: string
): Promise<void> {
  await updateStoredRampMetadata(serviceRole, companyId, (metadata) => {
    const cursors = (metadata.cursors as Record<string, unknown> | null) ?? {};
    cursors[key] = value;
    metadata.cursors = cursors;
  });
}

/**
 * Clear the stored `webhookId` and `connectionId` from the (secret-free)
 * metadata column. Called on uninstall so a later reinstall re-creates both at
 * Ramp instead of trusting ids that no longer exist there. Leaves every sibling
 * key (cursors, account-mapping config, vaulted secrets) untouched.
 */
export async function clearRampConnectionMetadata(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<void> {
  await updateStoredRampMetadata(serviceRole, companyId, (metadata) => {
    delete metadata.webhookId;
    delete metadata.connectionId;
  });
}

// /********************************************************\
// *                     Connection                        *
// \********************************************************/

/**
 * Build a {@link RampClient} wired for OAuth2 token refresh: it carries Carbon's
 * OAuth app credentials (from env, needed to run the `refresh_token` grant) and
 * an `onTokensRefreshed` hook that persists a refreshed oauth2 access token back
 * to the vault. Shared by every caller that constructs a client so none of them
 * builds one that cannot refresh an expired oauth2 token.
 */
function buildRampClient(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  credentials: RampCredentials
): RampClient {
  // Carbon's OAuth app — read lazily from process.env (importing @carbon/env
  // here would eagerly validate unrelated required vars and break server-only
  // tests).
  const rampClientId = process.env.RAMP_CLIENT_ID;
  const rampClientSecret = process.env.RAMP_CLIENT_SECRET;
  const oauthApp =
    rampClientId && rampClientSecret
      ? { clientId: rampClientId, clientSecret: rampClientSecret }
      : undefined;

  return new RampClient(credentials, {
    oauthApp,
    // Only oauth2 connections refresh; client-credentials mint fresh tokens.
    onTokensRefreshed:
      credentials.type === "oauth2"
        ? (tokens) => persistRefreshedRampTokens(serviceRole, companyId, tokens)
        : undefined
  });
}

/**
 * Persist a refreshed oauth2 access token + expiry. Re-reads the LATEST stored
 * metadata (and re-resolves its vaulted secrets) immediately before writing, so
 * a token refresh cannot clobber sibling metadata — cursors, `webhookId`,
 * `connectionId` — that another operation wrote after the client was built.
 * Only the two token fields are overwritten; Ramp does not rotate the refresh
 * token, so it is left untouched.
 */
async function persistRefreshedRampTokens(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  tokens: { accessToken: string; expiresAt: string }
): Promise<void> {
  const stored = await readStoredRampMetadata(serviceRole, companyId);
  if (!stored) return;
  const latest = await resolveIntegrationSecrets(
    serviceRole,
    companyId,
    RAMP,
    stored
  );
  const current = latest as { credentials?: Record<string, unknown> };
  await persistIntegrationSecrets(serviceRole, companyId, RAMP, {
    ...latest,
    credentials: {
      ...(current.credentials ?? {}),
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt
    }
  });
}

/**
 * Load the company's Ramp integration — a ready {@link RampClient} plus parsed
 * metadata (vaulted secrets resolved). Returns `null` when Ramp is not
 * installed/active or the metadata does not parse.
 */
export async function getRampIntegration(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<{ client: RampClient; metadata: RampIntegrationMetadata } | null> {
  const stored = await readStoredRampMetadata(serviceRole, companyId);
  if (!stored) return null;

  const resolved = await resolveIntegrationSecrets(
    serviceRole,
    companyId,
    RAMP,
    stored
  );

  const parsed = RampIntegrationMetadataSchema.safeParse(resolved);
  if (!parsed.success) return null;

  const client = buildRampClient(
    serviceRole,
    companyId,
    parsed.data.credentials
  );

  return { client, metadata: parsed.data };
}

/**
 * Exchange an OAuth authorization code (the Connect-flow callback) for oauth2
 * credentials, using Carbon's registered Ramp OAuth app. OAuth is the production
 * flow, so the returned credentials are pinned to `environment: "production"`.
 * The caller stores these via `upsertCompanyIntegration` (which vaults the
 * access + refresh tokens) and then runs `rampOnInstall`.
 */
export async function exchangeRampOAuthCode(
  code: string,
  redirectUri: string
): Promise<Extract<RampCredentials, { type: "oauth2" }>> {
  const clientId = process.env.RAMP_CLIENT_ID;
  const clientSecret = process.env.RAMP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Ramp OAuth is not configured (set RAMP_CLIENT_ID / RAMP_CLIENT_SECRET)"
    );
  }
  // A placeholder access token just to construct the client; the exchange only
  // uses the OAuth app credentials + host (production).
  const client = new RampClient(
    { type: "oauth2", accessToken: "", environment: "production" },
    { oauthApp: { clientId, clientSecret } }
  );
  const tokens = await client.exchangeAuthorizationCode(code, redirectUri);
  return {
    type: "oauth2",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    environment: "production"
  };
}

/**
 * Ensure a Ramp accounting connection exists for the company. Creates one with
 * `remote_provider_name: "Carbon"` when `metadata.connectionId` is unset and
 * stores the returned id back into the (secret-free) metadata column.
 */
export async function ensureRampConnection(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<{ connectionId: string } | null> {
  const integration = await getRampIntegration(serviceRole, companyId);
  if (!integration) return null;

  const { client, metadata } = integration;
  if (metadata.connectionId) return { connectionId: metadata.connectionId };

  const connection = RampAccountingConnectionSchema.parse(
    await client.createAccountingConnection(
      { remote_provider_name: "Carbon" },
      // Entity-scoped idempotency key — one accounting connection per company, so
      // a retried install cannot create a second one at Ramp.
      buildRampIdempotencyKey({
        companyId,
        operation: "createAccountingConnection",
        scope: companyId
      })
    )
  );
  const connectionId = connection.connection_id ?? connection.id;
  if (!connectionId) {
    throw new Error("Ramp did not return a connection id");
  }

  await updateStoredRampMetadata(serviceRole, companyId, (m) => {
    m.connectionId = connectionId;
  });

  return { connectionId };
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

// /********************************************************\
// *        Cost centers — the custom "project" field        *
// \********************************************************/

/** The Carbon cost center as a Ramp option: `id` = costCenter.id, `value` = name. */
export type RampCostCenterOption = { id: string; value: string };

/** A `costCenter` mapping row: Carp id ↔ Ramp option UUID + last-pushed fingerprint. */
export type RampCostCenterMapping = {
  entityId: string;
  externalId: string | null;
  fingerprint: string | null;
};

/** The subset of a Ramp field option the converge reads back. */
export type RampRemoteFieldOption = {
  id?: string | null;
  ramp_id?: string | null;
  value?: string | null;
  display_name?: string | null;
  visibility?: string | null;
};

/** What Carbon last pushed for an option: its label and whether it is selectable. */
export function costCenterFingerprint(option: {
  value: string;
  visible: boolean;
}): string {
  return `${option.value}|${option.visible ? "VISIBLE" : "HIDDEN"}`;
}

/**
 * `POST /accounting/fields` body. Ramp keys a custom field by `id` — the
 * "remote/external ID … from the ERP system" — and assigns its own `ramp_id`
 * UUID, which is what the field-OPTIONS endpoints want in `field_id`. (The old
 * push sent `external_id` here and then passed this string id as `field_id`,
 * which is the "Not a valid UUID" 422 it recorded.) `display_name` is the label
 * card holders see; it is set from the same name so nobody has to rename it.
 */
export function buildCostCenterFieldBody(name: string) {
  return {
    id: RAMP_COST_CENTER_FIELD_ID,
    name,
    display_name: name,
    input_type: "SINGLE_CHOICE",
    is_splittable: true
  };
}

/** `POST /accounting/field-options` body: option `id` is the Carbon costCenter.id. */
export function buildCostCenterOptionsBody(
  fieldRampId: string,
  options: RampCostCenterOption[]
) {
  return {
    field_id: fieldRampId,
    options: options.map((option) => ({ id: option.id, value: option.value }))
  };
}

/**
 * Pure diff of Carbon's cost centers against the options Ramp already holds
 * (existence + `ramp_id` come from the remote listing) and against what Carbon
 * last pushed (the mapping fingerprint decides whether a rename or a visibility
 * change is Carbon's to make). A Ramp-side manual edit therefore survives until
 * the Carbon side changes. A cost center gone from Carbon is HIDDEN, never
 * deleted — the option may still be on synced transactions.
 */
export function diffCostCenterOptions(
  desired: RampCostCenterOption[],
  remote: RampRemoteFieldOption[],
  mappings: RampCostCenterMapping[]
): {
  toCreate: RampCostCenterOption[];
  toRename: Array<{ option: RampCostCenterOption; rampId: string }>;
  toShow: Array<{ option: RampCostCenterOption; rampId: string }>;
  toHide: Array<{ id: string; value: string; rampId: string }>;
} {
  const remoteById = new Map<string, RampRemoteFieldOption>();
  for (const option of remote) {
    if (option.id && option.ramp_id) remoteById.set(option.id, option);
  }
  const mappingById = new Map(mappings.map((m) => [m.entityId, m]));
  const desiredIds = new Set(desired.map((option) => option.id));

  const toCreate: RampCostCenterOption[] = [];
  const toRename: Array<{ option: RampCostCenterOption; rampId: string }> = [];
  const toShow: Array<{ option: RampCostCenterOption; rampId: string }> = [];
  const toHide: Array<{ id: string; value: string; rampId: string }> = [];

  for (const option of desired) {
    const existing = remoteById.get(option.id);
    if (!existing?.ramp_id) {
      toCreate.push(option);
      continue;
    }
    const last = mappingById.get(option.id)?.fingerprint;
    const current = costCenterFingerprint({
      value: option.value,
      visible: true
    });
    if (last === current) continue;
    const [lastValue, lastVisibility] = last ? last.split("|") : [];
    if (last === undefined) {
      // Never recorded (pushed before this was mapping-tracked): adopt the
      // remote option, correcting only what visibly disagrees with Carbon.
      if ((existing.display_name ?? existing.value) !== option.value) {
        toRename.push({ option, rampId: existing.ramp_id });
      }
      if (existing.visibility === "HIDDEN") {
        toShow.push({ option, rampId: existing.ramp_id });
      }
      continue;
    }
    if (lastValue !== option.value) {
      toRename.push({ option, rampId: existing.ramp_id });
    }
    if (lastVisibility === "HIDDEN") {
      toShow.push({ option, rampId: existing.ramp_id });
    }
  }

  for (const option of remote) {
    if (!option.id || !option.ramp_id || desiredIds.has(option.id)) continue;
    const last = mappingById.get(option.id)?.fingerprint;
    const alreadyHidden = last ? last.endsWith("|HIDDEN") : false;
    if (alreadyHidden || option.visibility === "HIDDEN") continue;
    toHide.push({
      id: option.id,
      value: option.value ?? option.display_name ?? "",
      rampId: option.ramp_id
    });
  }

  return { toCreate, toRename, toShow, toHide };
}

async function loadCostCenterMappings(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<RampCostCenterMapping[]> {
  const { data, error } = await serviceRole
    .from("externalIntegrationMapping")
    .select("entityId, externalId, metadata")
    .eq("companyId", companyId)
    .eq("integration", RAMP)
    .eq("entityType", "costCenter");
  if (error) {
    throw new Error(
      `Failed to load Ramp cost-center mappings: ${error.message}`
    );
  }
  return (data ?? []).map((row) => ({
    entityId: row.entityId,
    externalId: row.externalId,
    fingerprint:
      (row.metadata as { fingerprint?: string } | null)?.fingerprint ?? null
  }));
}

/** Record what Carbon just pushed for each option (Ramp UUID + fingerprint). */
async function upsertCostCenterMappings(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  rows: Array<{ id: string; rampId: string; value: string; visible: boolean }>
): Promise<void> {
  if (rows.length === 0) return;
  const now = new Date().toISOString();
  const { error } = await serviceRole.from("externalIntegrationMapping").upsert(
    rows.map((row) => ({
      entityType: "costCenter",
      entityId: row.id,
      integration: RAMP,
      externalId: row.rampId,
      companyId,
      metadata: {
        fingerprint: costCenterFingerprint({
          value: row.value,
          visible: row.visible
        })
      },
      lastSyncedAt: now,
      remoteUpdatedAt: now,
      updatedAt: now
    })),
    { onConflict: "entityType,entityId,integration,companyId" }
  );
  if (error) {
    throw new Error(
      `Failed to record Ramp cost-center mappings: ${error.message}`
    );
  }
}

/**
 * The company group's active `CostCenter` dimension — created if missing. The
 * posting function writes every card line's cost center as a
 * `journalLineDimension` against this row, so without it the tag is dropped at
 * posting time; and its `name` is what the customer calls the concept, so it
 * names the Ramp field (and, already, the Rillet Field). `dimension` is
 * companyGroup-scoped.
 */
export async function ensureCostCenterDimension(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<{ id: string; name: string }> {
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
  const companyGroupId = company.companyGroupId;

  const existing = await serviceRole
    .from("dimension")
    .select("id, name")
    .eq("companyGroupId", companyGroupId)
    .eq("entityType", "CostCenter")
    .eq("active", true)
    .order("createdAt", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing.error) {
    throw new Error(
      `Failed to load the Cost Center dimension: ${existing.error.message}`
    );
  }
  if (existing.data) return existing.data;

  const created = await serviceRole
    .from("dimension")
    .insert([
      {
        name: "Cost Center",
        entityType: "CostCenter",
        companyGroupId,
        createdBy: "system"
      }
    ])
    .select("id, name")
    .single();
  if (created.error || !created.data) {
    throw new Error(
      `Failed to create the Cost Center dimension: ${
        created.error?.message ?? "unknown error"
      }`
    );
  }
  return created.data;
}

/**
 * Ensure the custom cost-center field exists in Ramp under
 * {@link RAMP_COST_CENTER_FIELD_ID} and carries the dimension's name. Read
 * first (`GET /accounting/fields?remote_id=`) so a re-run is a no-op; create
 * when absent (the POST is idempotent by `id` anyway); PATCH the name only when
 * Carbon's name changed since Carbon last pushed it, so a Ramp-side rename by
 * the customer survives. Returns Ramp's UUID for the field.
 */
async function ensureCostCenterField(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  client: RampClient,
  name: string
): Promise<string> {
  let field: { ramp_id?: string | null; name?: string | null } | null = null;
  for await (const page of client.listAccountingFields({
    remote_id: RAMP_COST_CENTER_FIELD_ID
  })) {
    field = page.find((row) => row.id === RAMP_COST_CENTER_FIELD_ID) ?? field;
    if (field) break;
  }

  if (!field?.ramp_id) {
    const created = await client.postAccountingFields<{
      ramp_id?: string | null;
    }>(buildCostCenterFieldBody(name));
    let rampId = created?.ramp_id ?? null;
    if (!rampId) {
      // Some responses omit ramp_id on the create; the listing always has it.
      for await (const page of client.listAccountingFields({
        remote_id: RAMP_COST_CENTER_FIELD_ID
      })) {
        rampId =
          page.find((row) => row.id === RAMP_COST_CENTER_FIELD_ID)?.ramp_id ??
          rampId;
        if (rampId) break;
      }
    }
    if (!rampId) {
      throw new Error(
        "Ramp did not return a ramp_id for the cost-center field"
      );
    }
    await upsertCostCenterFieldMapping(serviceRole, companyId, rampId, name);
    return rampId;
  }

  const [mapping] = await loadFieldMapping(serviceRole, companyId);
  if (mapping?.fingerprint !== name) {
    await client.patchAccountingField(field.ramp_id, {
      name,
      display_name: name
    });
    await upsertCostCenterFieldMapping(
      serviceRole,
      companyId,
      field.ramp_id,
      name
    );
  }
  return field.ramp_id;
}

async function loadFieldMapping(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<RampCostCenterMapping[]> {
  const { data, error } = await serviceRole
    .from("externalIntegrationMapping")
    .select("entityId, externalId, metadata")
    .eq("companyId", companyId)
    .eq("integration", RAMP)
    .eq("entityType", "costCenterField")
    .eq("entityId", RAMP_COST_CENTER_FIELD_ID);
  if (error) {
    throw new Error(`Failed to load the Ramp field mapping: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    entityId: row.entityId,
    externalId: row.externalId,
    fingerprint:
      (row.metadata as { fingerprint?: string } | null)?.fingerprint ?? null
  }));
}

async function upsertCostCenterFieldMapping(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  rampId: string,
  name: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await serviceRole.from("externalIntegrationMapping").upsert(
    [
      {
        entityType: "costCenterField",
        entityId: RAMP_COST_CENTER_FIELD_ID,
        integration: RAMP,
        externalId: rampId,
        companyId,
        metadata: { fingerprint: name },
        lastSyncedAt: now,
        remoteUpdatedAt: now,
        updatedAt: now
      }
    ],
    { onConflict: "entityType,entityId,integration,companyId" }
  );
  if (error) {
    throw new Error(
      `Failed to record the Ramp field mapping: ${error.message}`
    );
  }
}

async function listRemoteCostCenterOptions(
  client: RampClient
): Promise<RampRemoteFieldOption[]> {
  const options: RampRemoteFieldOption[] = [];
  for await (const page of client.listAccountingFieldOptions({
    field_remote_id: RAMP_COST_CENTER_FIELD_ID
  })) {
    options.push(...page);
  }
  return options;
}

/**
 * Rename an option. `value` is only PATCHable on non-direct connections per the
 * Ramp spec, and whether an API accounting connection counts is not
 * documented — so try both keys and fall back to `display_name` alone, which is
 * "available to all".
 */
async function renameCostCenterOption(
  client: RampClient,
  rampId: string,
  value: string
): Promise<void> {
  try {
    await client.patchAccountingFieldOption(rampId, {
      value,
      display_name: value
    });
  } catch (err) {
    if (!(err instanceof RampApiError) || err.status >= 500) throw err;
    await client.patchAccountingFieldOption(rampId, { display_name: value });
  }
}

/**
 * Converge Carbon's cost centers into Ramp as the options of one custom
 * single-choice field (the "project" a card holder picks), as a true diff:
 * create new, rename changed, hide removed, re-show restored — tracked per
 * cost center in `externalIntegrationMapping` (entityType `costCenter`). Runs
 * on install / settings save and on every `ramp-sync`, so a cost center added
 * in Carbon reaches Ramp within ≤1h. An unchanged set is a cheap no-op.
 *
 * `POST /accounting/field-options` is all-or-nothing and rejects options that
 * already exist, which is why the diff is driven off the remote listing rather
 * than a blind re-post.
 */
export async function pushCostCenters(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<{
  created: number;
  renamed: number;
  hidden: number;
  shown: number;
  pushed: number;
}> {
  const zero = { created: 0, renamed: 0, hidden: 0, shown: 0, pushed: 0 };
  const integration = await getRampIntegration(serviceRole, companyId);
  if (!integration) return zero;

  const { client } = integration;

  const dimension = await ensureCostCenterDimension(serviceRole, companyId);

  const { data: costCenters, error } = await serviceRole
    .from("costCenter")
    .select("id, name")
    .eq("companyId", companyId);
  if (error) {
    throw new Error(`Failed to load cost centers: ${error.message}`);
  }
  const desired: RampCostCenterOption[] = (costCenters ?? []).map((row) => ({
    id: row.id,
    value: row.name
  }));

  const fieldRampId = await ensureCostCenterField(
    serviceRole,
    companyId,
    client,
    dimension.name
  );

  const remote = await listRemoteCostCenterOptions(client);
  const mappings = await loadCostCenterMappings(serviceRole, companyId);
  const { toCreate, toRename, toShow, toHide } = diffCostCenterOptions(
    desired,
    remote,
    mappings
  );
  if (
    toCreate.length === 0 &&
    toRename.length === 0 &&
    toShow.length === 0 &&
    toHide.length === 0
  ) {
    return zero;
  }

  let created = 0;
  for (const batch of chunk(toCreate, RAMP_ACCOUNTS_BATCH_SIZE)) {
    await client.postAccountingFieldOptions(
      buildCostCenterOptionsBody(fieldRampId, batch)
    );
    created += batch.length;
  }
  // The upload response shape is not relied on: re-list to learn the new
  // options' ramp_ids (the id the PATCH endpoint keys on) for the mappings.
  const rampIdById = new Map<string, string>();
  const afterCreate =
    created > 0 ? await listRemoteCostCenterOptions(client) : remote;
  for (const option of afterCreate) {
    if (option.id && option.ramp_id) rampIdById.set(option.id, option.ramp_id);
  }
  await upsertCostCenterMappings(
    serviceRole,
    companyId,
    toCreate.flatMap((option) => {
      const rampId = rampIdById.get(option.id);
      return rampId
        ? [{ id: option.id, rampId, value: option.value, visible: true }]
        : [];
    })
  );

  for (const { option, rampId } of toRename) {
    await renameCostCenterOption(client, rampId, option.value);
  }
  for (const { rampId } of toShow) {
    await client.patchAccountingFieldOption(rampId, { visibility: "VISIBLE" });
  }
  await upsertCostCenterMappings(
    serviceRole,
    companyId,
    [...toRename, ...toShow].map(({ option, rampId }) => ({
      id: option.id,
      rampId,
      value: option.value,
      visible: true
    }))
  );

  for (const { rampId } of toHide) {
    await client.patchAccountingFieldOption(rampId, { visibility: "HIDDEN" });
  }
  await upsertCostCenterMappings(
    serviceRole,
    companyId,
    toHide.map(({ id, rampId, value }) => ({
      id,
      rampId,
      value,
      visible: false
    }))
  );

  return {
    created,
    renamed: toRename.length,
    hidden: toHide.length,
    shown: toShow.length,
    pushed: created + toRename.length + toShow.length + toHide.length
  };
}

// /********************************************************\
// *                       Webhook                         *
// \********************************************************/

/**
 * Ensure a Ramp webhook is registered for the company. Idempotent: skips when
 * `metadata.webhookId` is already set. On create, persists the `webhookId` to the
 * metadata column and the returned signing `secret` to the vault (under the
 * `webhookSecret` SECRET_KEYS path) via {@link persistIntegrationSecrets}.
 * `originUrl` is the app origin, supplied by the caller.
 */
export async function ensureRampWebhook(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  originUrl: string
): Promise<{ webhookId: string } | null> {
  const stored = await readStoredRampMetadata(serviceRole, companyId);
  if (!stored) return null;

  const resolved = await resolveIntegrationSecrets(
    serviceRole,
    companyId,
    RAMP,
    stored
  );
  const parsed = RampIntegrationMetadataSchema.safeParse(resolved);
  if (!parsed.success) return null;

  if (parsed.data.webhookId) return { webhookId: parsed.data.webhookId };

  // Build via the shared helper so an oauth2 connection whose access token has
  // expired can refresh it before the webhook call (a bare `new RampClient` has
  // no OAuth app and would throw on an expired token).
  const client = buildRampClient(
    serviceRole,
    companyId,
    parsed.data.credentials
  );
  const created = RampWebhookCreateResponseSchema.parse(
    await client.createWebhook(
      {
        endpoint_url: `${originUrl}/api/webhook/ramp/${companyId}`,
        event_types: [...RAMP_WEBHOOK_EVENT_TYPES]
      },
      // Entity-scoped idempotency key — one webhook per company connection, so a
      // retried install cannot register a duplicate webhook at Ramp.
      buildRampIdempotencyKey({
        companyId,
        operation: "createWebhook",
        scope: companyId
      })
    )
  );

  // The webhook route fails closed without a stored signing secret (401), and a
  // persisted `webhookId` makes this function skip re-creation forever. So
  // refuse to persist a webhook Ramp returned without a secret — leaving the
  // metadata clean means the next run re-creates one we can actually verify.
  if (!created.secret) {
    throw new Error(
      "Ramp did not return a webhook signing secret; not persisting the webhook"
    );
  }

  // Re-vault the FULL secret bag (the vault RPC replaces, not merges) plus the
  // new webhookSecret; persistIntegrationSecrets strips secrets back out and
  // writes `webhookId` to the plaintext column.
  await persistIntegrationSecrets(serviceRole, companyId, RAMP, {
    ...resolved,
    webhookId: created.id,
    webhookSecret: created.secret
  });

  return { webhookId: created.id };
}

/**
 * Answer Ramp's webhook challenge verification for the registered webhook.
 * Returns `false` when there is no registered webhook to verify.
 */
export async function completeWebhookVerification(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  challenge: string
): Promise<boolean> {
  const integration = await getRampIntegration(serviceRole, companyId);
  if (!integration) return false;

  const { client, metadata } = integration;
  if (!metadata.webhookId) return false;

  await client.verifyWebhook(metadata.webhookId, challenge);
  return true;
}

// /********************************************************\
// *                    Sync confirms                      *
// \********************************************************/

/**
 * Confirm a batch of postings back to Ramp (`POST /accounting/syncs`). The
 * idempotency key is deterministic over `(companyId, syncType, sha256(sorted
 * ids))` so a retried confirm cannot double-apply. A no-op batch is skipped.
 */
export async function confirmSyncs(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  args: {
    syncType: string;
    successful: Array<{
      id: string;
      referenceId: string;
      deepLinkUrl?: string;
    }>;
    failed: Array<{ id: string; message: string }>;
  }
): Promise<void> {
  if (args.successful.length === 0 && args.failed.length === 0) return;

  const integration = await getRampIntegration(serviceRole, companyId);
  if (!integration) return;

  const { client } = integration;

  const ids = [
    ...args.successful.map((item) => item.id),
    ...args.failed.map((item) => item.id)
  ].sort();
  const scope = createHash("sha256").update(ids.join(",")).digest("hex");
  const idempotencyKey = buildRampIdempotencyKey({
    companyId,
    operation: args.syncType,
    scope
  });

  await client.postAccountingSyncs(buildSyncConfirmBody(args, idempotencyKey));
}

/**
 * The exact `POST /accounting/syncs` body. Two contract details Ramp enforces
 * with a 422 (live-verified 2026-09-10) that used to make EVERY confirm fail
 * silently, leaving synced transactions SYNC_READY in Ramp forever:
 * `successful_syncs` / `failed_syncs` have `minItems: 1`, so an empty list must
 * be OMITTED rather than sent as `[]`; and a failed item is
 * `{ id, error: { message } }`, not `{ id, message }`.
 */
export function buildSyncConfirmBody(
  args: {
    syncType: string;
    successful: Array<{
      id: string;
      referenceId: string;
      deepLinkUrl?: string;
    }>;
    failed: Array<{ id: string; message: string }>;
  },
  idempotencyKey: string
): {
  sync_type: string;
  idempotency_key: string;
  successful_syncs?: Array<{
    id: string;
    reference_id: string;
    deep_link_url?: string;
  }>;
  failed_syncs?: Array<{ id: string; error: { message: string } }>;
} {
  return {
    sync_type: args.syncType,
    idempotency_key: idempotencyKey,
    ...(args.successful.length > 0
      ? {
          successful_syncs: args.successful.map((item) => ({
            id: item.id,
            reference_id: item.referenceId,
            ...(item.deepLinkUrl ? { deep_link_url: item.deepLinkUrl } : {})
          }))
        }
      : {}),
    ...(args.failed.length > 0
      ? {
          failed_syncs: args.failed.map((item) => ({
            id: item.id,
            error: { message: item.message }
          }))
        }
      : {})
  };
}

// /********************************************************\
// *                  Supplier resolution                  *
// \********************************************************/

/**
 * Resolve a Ramp vendor to a Carbon `supplier` id: mapping-first (`vendor`
 * entityType by default), then a case-insensitive exact `supplier.name` match,
 * then auto-create. Links the `externalIntegrationMapping` when a Ramp id is
 * available. The Kysely handle is a PARAM so the calling job passes its own.
 *
 * `opts.entityType` keys the mapping — Ramp bill vendors and card MERCHANTS are
 * different id spaces, so merchants map under `"merchant"` (see
 * {@link resolveMerchantSupplier}). `opts.supplierTypeId` tags an auto-created
 * supplier.
 */
export async function resolveRampSupplier(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  vendor: { id?: string | null; name: string },
  userId: string,
  kyselyDb: Kysely<KyselyDatabase>,
  opts: { entityType?: string; supplierTypeId?: string | null } = {}
): Promise<string> {
  const mapping = createMappingService(kyselyDb, companyId);
  const entityType = opts.entityType ?? "vendor";

  // 1. Mapping-first.
  if (vendor.id) {
    const mapped = await mapping.getEntityId(RAMP, vendor.id, entityType);
    if (mapped) return mapped;
  }

  // 2. Case-insensitive exact name match. `vendor.name` comes from Ramp, so its
  // `%`/`_` must be escaped before `ilike` — otherwise a merchant like
  // "50% Off Supply" becomes a wildcard pattern and matches an unrelated
  // supplier, linking the two permanently.
  const escapedName = vendor.name.replace(/[\\%_]/g, (m) => `\\${m}`);
  const { data: matches } = await serviceRole
    .from("supplier")
    .select("id")
    .eq("companyId", companyId)
    .ilike("name", escapedName)
    .limit(1);
  let supplierId = matches?.[0]?.id ?? null;

  // 3. Auto-create.
  if (!supplierId) {
    const { data: created, error } = await serviceRole
      .from("supplier")
      .insert([
        {
          name: vendor.name,
          companyId,
          createdBy: userId,
          ...(opts.supplierTypeId
            ? { supplierTypeId: opts.supplierTypeId }
            : {})
        }
      ])
      .select("id")
      .single();
    if (error || !created) {
      throw new Error(
        `Failed to create Ramp supplier "${vendor.name}": ${
          error?.message ?? "unknown error"
        }`
      );
    }
    supplierId = created.id;
  }

  if (vendor.id) {
    await mapping.link(entityType, supplierId, RAMP, vendor.id, {
      createdBy: userId
    });
  }

  return supplierId;
}

/** The `supplierType` auto-created suppliers for card merchants are tagged with. */
export const CARD_MERCHANT_SUPPLIER_TYPE = "Card Merchant";

/** Find-or-create a named `supplierType` for the company; returns its id. */
async function ensureSupplierTypeId(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  name: string
): Promise<string> {
  const existing = await serviceRole
    .from("supplierType")
    .select("id")
    .eq("companyId", companyId)
    .eq("name", name)
    .maybeSingle();
  if (existing.data?.id) return existing.data.id;
  const created = await serviceRole
    .from("supplierType")
    .insert([{ name, companyId, createdBy: "system" }])
    .select("id")
    .single();
  if (created.error || !created.data) {
    throw new Error(
      `Failed to create the ${name} supplier type: ${
        created.error?.message ?? "unknown error"
      }`
    );
  }
  return created.data.id;
}

/**
 * Resolve the MERCHANT of a Ramp card transaction to a Carbon `supplier` id so
 * the charge can carry a vendor to the accounting provider (Rillet `charge`,
 * QBO `Purchase`, Xero SPEND bank transaction all require one). Mapping-first
 * under the `"merchant"` entityType keyed by Ramp's `merchant_id`, then a
 * case-insensitive name match, then auto-create tagged "Card Merchant" so the
 * supplier list stays filterable. Modeled on {@link resolveEmployeeSupplier}.
 */
export async function resolveMerchantSupplier(
  serviceRole: SupabaseClient<Database>,
  kyselyDb: Kysely<KyselyDatabase>,
  companyId: string,
  merchant: { id?: string | null; name: string }
): Promise<string> {
  const supplierTypeId = await ensureSupplierTypeId(
    serviceRole,
    companyId,
    CARD_MERCHANT_SUPPLIER_TYPE
  );
  return resolveRampSupplier(
    serviceRole,
    companyId,
    merchant,
    "system",
    kyselyDb,
    { entityType: "merchant", supplierTypeId }
  );
}

/**
 * Resolve a Ramp USER (the employee a reimbursement/repayment belongs to) to a
 * Carbon `supplier` id. Mapping-first on the `vendor` entityType keyed by the
 * Ramp user id; else ensures an "Employee" `supplierType` exists (created once),
 * auto-creates a supplier named `"<First> <Last> (<email>)"`, links the mapping,
 * and returns the supplier id. Created rows are attributed to `"system"`.
 *
 * The `kyselyDb` handle is a PARAM so the calling job passes its own (the mapping
 * service is Kysely-side). Modeled on {@link resolveRampSupplier}.
 */
export async function resolveEmployeeSupplier(
  serviceRole: SupabaseClient<Database>,
  kyselyDb: Kysely<KyselyDatabase>,
  companyId: string,
  rampUser: {
    user_id: string;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  }
): Promise<string> {
  const mapping = createMappingService(kyselyDb, companyId);

  // 1. Mapping-first — a Ramp user reuses the `vendor` entityType id space.
  const mapped = await mapping.getEntityId(RAMP, rampUser.user_id, "vendor");
  if (mapped) return mapped;

  // 2. Ensure the "Employee" supplier type exists (create once per company).
  const existingType = await serviceRole
    .from("supplierType")
    .select("id")
    .eq("companyId", companyId)
    .eq("name", "Employee")
    .maybeSingle();

  let supplierTypeId = existingType.data?.id ?? null;
  if (!supplierTypeId) {
    const createdType = await serviceRole
      .from("supplierType")
      .insert([{ name: "Employee", companyId, createdBy: "system" }])
      .select("id")
      .single();
    if (createdType.error || !createdType.data) {
      throw new Error(
        `Failed to create the Employee supplier type: ${
          createdType.error?.message ?? "unknown error"
        }`
      );
    }
    supplierTypeId = createdType.data.id;
  }

  // 3. Build a human name: "<First> <Last> (<email>)", degrading gracefully.
  const fullName = [rampUser.first_name, rampUser.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const name = rampUser.email
    ? fullName
      ? `${fullName} (${rampUser.email})`
      : rampUser.email
    : fullName || rampUser.user_id;

  const created = await serviceRole
    .from("supplier")
    .insert([{ name, supplierTypeId, companyId, createdBy: "system" }])
    .select("id")
    .single();
  if (created.error || !created.data) {
    throw new Error(
      `Failed to create Ramp employee supplier "${name}": ${
        created.error?.message ?? "unknown error"
      }`
    );
  }
  const supplierId = created.data.id;

  await mapping.link("vendor", supplierId, RAMP, rampUser.user_id, {
    createdBy: "system"
  });

  return supplierId;
}

// /********************************************************\
// *              Repayment line scaling                   *
// \********************************************************/

/** A card-transaction line to be scaled for a partial repayment. */
export type RepaymentLineInput = {
  accountId: string;
  amount: number;
  costCenterId?: string | null;
  description?: string | null;
};

export type ScaledRepaymentLine = {
  accountId: string;
  amount: number;
  costCenterId: string | null;
  description: string | null;
};

/**
 * Scale a set of lines so their amounts sum EXACTLY to `target` (rounded at
 * `decimals`), putting the rounding residual on the largest-magnitude line.
 * PURE. Used to convert a Ramp transaction's line amounts — which come in the
 * MERCHANT currency — into the settlement currency the header (`entity_amount`)
 * is in: a foreign card charge otherwise fails post-card-transaction's
 * "lines must sum to the header" invariant. A no-op for a same-currency
 * transaction (ratio ≈ 1, residual 0). `rawSum === 0` degrades to a zero ratio
 * (the whole target lands as the residual on the largest line).
 */
export function scaleLinesToTotal<T extends { amount: number }>(
  lines: T[],
  target: number,
  decimals: number
): T[] {
  if (lines.length === 0) return [];

  const rawSum = lines.reduce((acc, line) => acc + line.amount, 0);
  const ratio = rawSum === 0 ? 0 : target / rawSum;

  const scaled = lines.map((line) => ({
    ...line,
    amount: round(line.amount * ratio, decimals)
  }));

  const roundedTarget = round(target, decimals);
  const sum = round(
    scaled.reduce((acc, line) => acc + line.amount, 0),
    decimals
  );
  const residual = round(roundedTarget - sum, decimals);

  if (residual !== 0) {
    let largest = 0;
    let largestMagnitude = Math.abs(scaled[0]?.amount ?? 0);
    for (let i = 1; i < scaled.length; i++) {
      const magnitude = Math.abs(scaled[i]?.amount ?? 0);
      if (magnitude > largestMagnitude) {
        largest = i;
        largestMagnitude = magnitude;
      }
    }
    const largestLine = scaled[largest];
    if (largestLine) {
      largestLine.amount = round(largestLine.amount + residual, decimals);
    }
  }

  return scaled;
}

/**
 * Scale a card transaction's original coding lines down to a (possibly partial)
 * repayment. Each line is scaled by `repaymentAmount / originalAmount` and
 * rounded at the currency's decimal places; the rounding residual is added to the
 * LARGEST-magnitude line so the scaled lines sum EXACTLY to the (rounded)
 * repayment amount — the invariant `post-card-transaction` asserts on the header.
 *
 * PURE + exported for unit testing. Uses the shared precision `round` (never a
 * bare `toFixed`/`Math.round`). `originalAmount === 0` degrades to a zero ratio
 * (the whole repayment lands as the residual on the first line) rather than
 * dividing by zero.
 */
export function scaleRepaymentLines(
  originalLines: RepaymentLineInput[],
  repaymentAmount: number,
  originalAmount: number,
  decimals: number
): ScaledRepaymentLine[] {
  if (originalLines.length === 0) return [];

  const ratio = originalAmount === 0 ? 0 : repaymentAmount / originalAmount;

  const scaled: ScaledRepaymentLine[] = originalLines.map((line) => ({
    accountId: line.accountId,
    amount: round(line.amount * ratio, decimals),
    costCenterId: line.costCenterId ?? null,
    description: line.description ?? null
  }));

  const target = round(repaymentAmount, decimals);
  const sum = round(
    scaled.reduce((acc, line) => acc + line.amount, 0),
    decimals
  );
  const residual = round(target - sum, decimals);

  if (residual !== 0) {
    let largest = 0;
    let largestMagnitude = Math.abs(scaled[0]?.amount ?? 0);
    for (let i = 1; i < scaled.length; i++) {
      const magnitude = Math.abs(scaled[i]?.amount ?? 0);
      if (magnitude > largestMagnitude) {
        largest = i;
        largestMagnitude = magnitude;
      }
    }
    const largestLine = scaled[largest];
    if (largestLine) {
      largestLine.amount = round(largestLine.amount + residual, decimals);
    }
  }

  return scaled;
}

// /********************************************************\
// *          Outbound push (POs, draft bills)             *
// \********************************************************/

/** A Carbon purchase-order line, shaped for a Ramp PO push. */
export type RampPurchaseOrderPushLine = {
  id: string;
  description: string | null;
  quantity: number | null;
  unitPrice: number | null;
};

/** The Carbon purchase order the job hands to {@link pushPurchaseOrder}. */
export type RampPurchaseOrderPush = {
  /** Carbon `purchaseOrder.id` (the mapping's entityId + the PO `external_id`). */
  id: string;
  /** Human-readable `purchaseOrder.purchaseOrderId` → Ramp `purchase_order_number`. */
  readableId: string;
  status: Database["public"]["Enums"]["purchaseOrderStatus"];
  supplier: RampVendorSupplier;
  /** The PO currency → Ramp's required `currency` (job falls back to base). */
  currencyCode: string | null;
  /** Ramp's required `entity_id` — the job resolves it before the push. */
  entityId?: string;
  lines: RampPurchaseOrderPushLine[];
};

/** A Carbon purchase-invoice line, shaped for a Ramp draft-bill push. */
export type RampInvoicePushLine = {
  description: string | null;
  amount: number;
};

/** The Carbon purchase invoice the job hands to {@link pushInvoiceDraftBill}. */
export type RampInvoicePush = {
  /** Carbon `purchaseInvoice.id` (the mapping's entityId + the bill `remote_id`). */
  id: string;
  /** Human-readable `purchaseInvoice.invoiceId` (the fallback invoice number). */
  readableId: string;
  supplierReference: string | null;
  currencyCode: string | null;
  dateIssued: string | null;
  dateDue: string | null;
  lines: RampInvoicePushLine[];
};

/**
 * Ensure a Ramp accounting vendor exists for a Carbon supplier — OUTBOUND
 * direction, so the mapping is read Carbon→Ramp via `getExternalId("vendor", …)`
 * (NOT the inbound `getEntityId`). Reuses an existing mapping (including one an
 * inbound bill/reimbursement already linked); otherwise creates a Ramp vendor
 * from the supplier name and links it (`allowDuplicateExternalId` default).
 * Returns the Ramp vendor id, or `null` when the supplier has no usable name.
 */
/**
 * A Carbon supplier resolved with the contact + address a Ramp SPEND vendor
 * needs. `country` (alpha-2, from the supplier's primary `address.countryCode`)
 * and a `contact.email` are what `POST /vendors` requires to CREATE one; without
 * both, only matching an existing Ramp vendor is possible.
 */
export type RampVendorSupplier = {
  id: string;
  name: string | null;
  country: string | null;
  contact: {
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
  } | null;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    stateProvince: string | null;
    postalCode: string | null;
  } | null;
};

/** First Ramp spend vendor matching a filter (`external_vendor_id` or `name`), or null. */
async function findRampSpendVendor(
  client: RampClient,
  params: { external_vendor_id?: string; name?: string }
): Promise<RampVendor | null> {
  for await (const page of client.listVendors(params)) {
    if (page.length > 0) return page[0] ?? null;
  }
  return null;
}

/**
 * The single Ramp spend vendor whose name EXACTLY (case-insensitively) matches
 * `name`, or null when there is none — OR more than one. A vendor name is not an
 * identity key: two Ramp vendors can share one, and binding a Carbon supplier to
 * an arbitrary same-named vendor would push its bills under the wrong Ramp
 * vendor. An ambiguous name therefore falls through to a create instead of
 * linking.
 */
async function findUniqueRampSpendVendorByName(
  client: RampClient,
  name: string
): Promise<RampVendor | null> {
  const target = name.trim().toLowerCase();
  if (!target) return null;
  let match: RampVendor | null = null;
  for await (const page of client.listVendors({ name })) {
    for (const vendor of page) {
      if ((vendor.name ?? "").trim().toLowerCase() !== target) continue;
      if (match) return null; // more than one exact match → ambiguous
      match = vendor;
    }
  }
  return match;
}

/**
 * Resolve the Ramp SPEND-vendor id a PO/bill `vendor_id` needs for a Carbon
 * supplier — matching first, creating only as a last resort (option B):
 *
 * 1. an existing `("vendor", supplier.id, "ramp")` mapping,
 * 2. a Ramp vendor already carrying our `external_vendor_id`,
 * 3. a Ramp vendor whose name matches exactly (case-insensitive) — links to a
 *    pre-existing spend vendor instead of duplicating it,
 * 4. otherwise CREATE one (`POST /vendors`) with the supplier's synced contact
 *    email + country (+ address when present) and `external_vendor_id`.
 *
 * Returns `null` (never throws) when the supplier has no name, or has no
 * matching vendor AND lacks the email/country a create requires — the caller
 * decides (a PO omits the optional `vendor_id`; a bill, which requires one, is
 * skipped). Accounting vendors (`/accounting/vendors`, for coding) are a
 * DIFFERENT id space Ramp rejects here — do not use them.
 */
export async function resolveOrCreateRampSpendVendor(
  mapping: ExternalIntegrationMappingService,
  client: RampClient,
  supplier: RampVendorSupplier,
  companyId?: string
): Promise<string | null> {
  const existing = await mapping.getExternalId("vendor", supplier.id, RAMP);
  if (existing) return existing;

  const name = (supplier.name ?? "").trim();
  if (!name) return null;

  // Prefer an exact identity match on our own external_vendor_id. Fall back to a
  // name match ONLY when it is unambiguous — exactly one Ramp vendor carries
  // this exact (case-insensitive) name — since a shared name is not an identity
  // key and would otherwise link this supplier to the wrong Ramp vendor.
  const byExternal = await findRampSpendVendor(client, {
    external_vendor_id: supplier.id
  });
  const matched =
    byExternal ?? (await findUniqueRampSpendVendorByName(client, name));
  if (matched?.id) {
    await mapping.link("vendor", supplier.id, RAMP, matched.id, {
      createdBy: "system"
    });
    return matched.id;
  }

  // Create — Ramp requires a country and at least one contact email (and, for
  // US, a two-letter state). Best-effort: a create that Ramp rejects (missing
  // state, bad data) returns null rather than throwing, so a PO still pushes
  // without a vendor and a bill is skipped rather than crashing the family.
  const email = supplier.contact?.email?.trim();
  const country = supplier.country?.trim();
  if (!email || !country) return null;

  const { contact, address } = supplier;
  // `business_vendor_contacts` is a SINGLE object despite the plural name
  // (OpenAPI `allOf` of one contact schema — an array is rejected "Invalid input
  // type"). `state` is required for US and lives at the vendor top level.
  let created: { id?: string } | null;
  try {
    created = (await client.createSpendVendor(
      {
        name,
        country,
        ...(address?.stateProvince ? { state: address.stateProvince } : {}),
        external_vendor_id: supplier.id,
        business_vendor_contacts: {
          email,
          ...(contact?.firstName ? { first_name: contact.firstName } : {}),
          ...(contact?.lastName ? { last_name: contact.lastName } : {}),
          ...(contact?.phone ? { phone: contact.phone } : {})
        },
        ...(address?.line1 && address.city && address.postalCode
          ? {
              address: {
                address_line_1: address.line1,
                ...(address.line2 ? { address_line_2: address.line2 } : {}),
                city: address.city,
                postal_code: address.postalCode,
                ...(address.stateProvince
                  ? { state: address.stateProvince }
                  : {}),
                country
              }
            }
          : {})
      },
      // Entity-scoped idempotency key (keyed on the Carbon supplier id) so a
      // retried push cannot create a duplicate Ramp spend vendor. Only when the
      // caller supplied a companyId (the helper needs it to derive the key).
      companyId
        ? buildRampIdempotencyKey({
            companyId,
            operation: "createSpendVendor",
            scope: supplier.id
          })
        : undefined
    )) as { id?: string } | null;
  } catch (createError) {
    console.error(
      `[RAMP] failed to create Ramp spend vendor for supplier "${name}" (${supplier.id})`,
      createError
    );
    return null;
  }

  const rampVendorId = created?.id ?? null;
  if (!rampVendorId) return null;

  await mapping.link("vendor", supplier.id, RAMP, rampVendorId, {
    createdBy: "system"
  });
  return rampVendorId;
}

/**
 * Push one Carbon purchase order to Ramp. Completed/Closed POs that already have
 * a Ramp mapping are archived; every other (released) PO resolves its Ramp SPEND
 * vendor (matched or created — best-effort, since `vendor_id` is optional), then
 * either PATCHes an existing Ramp PO or creates a new one carrying
 * `external_id: po.id` so Ramp's bill-matching flow can find the Carbon PO. The
 * new Ramp PO id is linked under `("purchaseOrder", po.id, "ramp")`.
 * Ramp requires `currency`, `entity_id`, and `three_way_match_enabled` on create.
 */
export async function pushPurchaseOrder(
  mapping: ExternalIntegrationMappingService,
  client: RampClient,
  po: RampPurchaseOrderPush,
  companyId?: string
): Promise<"created" | "patched" | "archived" | "skipped"> {
  const existingRampPoId = await mapping.getExternalId(
    "purchaseOrder",
    po.id,
    RAMP
  );

  // Completed / Closed POs with a mapping → archive; without one → nothing to do.
  if (po.status === "Completed" || po.status === "Closed") {
    if (existingRampPoId) {
      await client.archivePurchaseOrder(existingRampPoId);
      return "archived";
    }
    return "skipped";
  }

  // Best-effort: match/create the Ramp SPEND vendor. `vendor_id` is OPTIONAL on
  // a PO (Ramp still matches its bill by `external_id`), so a supplier we can't
  // resolve/create does not block the push.
  const rampVendorId = await resolveOrCreateRampSpendVendor(
    mapping,
    client,
    po.supplier,
    companyId
  );

  const lineItems = po.lines.map((line) => ({
    description: line.description ?? "",
    unit_quantity: line.quantity ?? 0,
    unit_price: line.unitPrice ?? 0,
    external_id: line.id
  }));

  if (existingRampPoId) {
    await client.patchPurchaseOrder(existingRampPoId, {
      ...(rampVendorId ? { vendor_id: rampVendorId } : {}),
      line_items: lineItems
    });
    return "patched";
  }

  const created = (await client.createPurchaseOrder(
    {
      purchase_order_number: po.readableId,
      external_id: po.id,
      three_way_match_enabled: false,
      ...(po.currencyCode ? { currency: po.currencyCode } : {}),
      ...(po.entityId ? { entity_id: po.entityId } : {}),
      ...(rampVendorId ? { vendor_id: rampVendorId } : {}),
      line_items: lineItems
    },
    // Entity-scoped idempotency key (keyed on the Carbon purchase-order id) so a
    // retried push cannot create a duplicate Ramp PO. Only when the caller
    // supplied a companyId (the helper needs it to derive the key).
    companyId
      ? buildRampIdempotencyKey({
          companyId,
          operation: "createPurchaseOrder",
          scope: po.id
        })
      : undefined
  )) as { id?: string } | null;
  const rampPoId = created?.id ?? null;
  if (!rampPoId) {
    throw new Error(
      `Ramp did not return a purchase order id for ${po.readableId}`
    );
  }

  await mapping.link("purchaseOrder", po.id, RAMP, rampPoId, {
    createdBy: "system"
  });
  return "created";
}

/**
 * Push one posted Carbon purchase invoice to Ramp as a DRAFT bill, then SUBMIT it
 * (draft + submit only — submit lands the bill in Ramp "Pending approval"; an
 * auto-approved `POST /bills` is never used). Ensures the Ramp vendor, creates the
 * draft with `remote_id: invoice.id`, best-effort attaches the invoice PDF when one
 * exists in storage (silently skipped when absent), submits, and links
 * `("bill", invoice.id, "ramp", <submitted id>)`.
 *
 * The CALLER filters candidates (no existing `("bill")` mapping in either
 * direction, not an Employee-supplier reimbursement, view-status Open/Partially
 * Paid). Returns `"pushed"` or `"skipped"` (vendor without a name).
 */
export async function pushInvoiceDraftBill(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  mapping: ExternalIntegrationMappingService,
  client: RampClient,
  invoice: RampInvoicePush & { supplier: RampVendorSupplier }
): Promise<"pushed" | "skipped"> {
  // A bill REQUIRES a `vendor_id`, so a supplier we can't match/create a Ramp
  // spend vendor for is skipped (needs a name, and to create: an email + country).
  const rampVendorId = await resolveOrCreateRampSpendVendor(
    mapping,
    client,
    invoice.supplier,
    companyId
  );
  if (!rampVendorId) return "skipped";

  // Best-effort PDF attach: locate the invoice's PDF document, sign a short-lived
  // URL. Skipped silently when the invoice has no PDF in storage.
  let documentUrls: string[] | undefined;
  const pdf = await serviceRole
    .from("document")
    .select("path")
    .eq("companyId", companyId)
    .eq("sourceDocumentId", invoice.id)
    .eq("type", "PDF")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pdf.data?.path) {
    const signed = await serviceRole.storage
      .from("private")
      .createSignedUrl(pdf.data.path, 3600);
    if (signed.data?.signedUrl) documentUrls = [signed.data.signedUrl];
  }

  const invoiceNumber =
    (invoice.supplierReference ?? "").trim() || invoice.readableId;

  // TODO(task-1): confirm the POST /bills/drafts body — line_items shape (amount
  // as minor units vs decimal, accounting_field_selections) and the PDF-attach
  // field name (document_urls here is a placeholder).
  const created = (await client.createDraftBill(
    {
      vendor_id: rampVendorId,
      invoice_number: invoiceNumber,
      ...(invoice.currencyCode
        ? { invoice_currency: invoice.currencyCode }
        : {}),
      ...(invoice.dateIssued ? { issued_at: invoice.dateIssued } : {}),
      ...(invoice.dateDue ? { due_at: invoice.dateDue } : {}),
      remote_id: invoice.id,
      ...(documentUrls ? { document_urls: documentUrls } : {}),
      line_items: invoice.lines.map((line) => ({
        memo: line.description ?? undefined,
        amount: line.amount
      }))
    },
    // Entity-scoped idempotency key (keyed on the Carbon purchase-invoice id) so a
    // retried push cannot create a duplicate draft bill at Ramp.
    buildRampIdempotencyKey({
      companyId,
      operation: "createDraftBill",
      scope: invoice.id
    })
  )) as { id?: string } | null;
  const draftId = created?.id ?? null;
  if (!draftId) {
    throw new Error(
      `Ramp did not return a draft-bill id for invoice ${invoice.readableId}`
    );
  }

  // TODO(task-1): confirm whether submit returns the draft id or a promoted bill
  // id; store WHICH id the submit returns (falls back to the draft id).
  const submitted = (await client.submitDraftBill(
    draftId,
    // Entity-scoped idempotency key (keyed on the Ramp draft-bill id) so a retried
    // submit cannot promote/duplicate the bill twice at Ramp.
    buildRampIdempotencyKey({
      companyId,
      operation: "submitDraftBill",
      scope: draftId
    })
  )) as {
    id?: string;
  } | null;
  const billId = submitted?.id ?? draftId;

  await mapping.link("bill", invoice.id, RAMP, billId, {
    createdBy: "system"
  });
  return "pushed";
}

/**
 * Archive a pushed Ramp bill once its Carbon invoice has settled (view-status
 * Paid/Voided). Tolerates an already-archived/already-paid bill by logging, then
 * stamps `archived: true` onto the mapping metadata (merging what is already
 * there — e.g. `rampPaid`) via a `link(...)` upsert so the archive never re-fires.
 * The CALLER decides which mappings are eligible (settled + not yet archived).
 */
export async function archiveRampBillForInvoice(
  mapping: ExternalIntegrationMappingService,
  client: RampClient,
  mappingRow: ExternalIntegrationMapping
): Promise<void> {
  try {
    await client.archiveBill(mappingRow.externalId);
  } catch (archiveError) {
    // Tolerate "already paid / already archived" — the goal is the stamped flag.
    console.warn(
      `[RAMP] failed to archive bill ${mappingRow.externalId} for invoice ${mappingRow.entityId} (tolerated)`,
      archiveError
    );
  }

  await mapping.link("bill", mappingRow.entityId, RAMP, mappingRow.externalId, {
    createdBy: mappingRow.createdBy ?? "system",
    metadata: { ...(mappingRow.metadata ?? {}), archived: true }
  });
}
