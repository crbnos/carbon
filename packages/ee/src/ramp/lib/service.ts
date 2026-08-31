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
import { buildRampIdempotencyKey, RampClient } from "./client";
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

// /********************************************************\
// *                     Connection                        *
// \********************************************************/

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

  // Carbon's OAuth app — needed to refresh oauth2 access tokens. Read lazily
  // from process.env (importing @carbon/env here would eagerly validate
  // unrelated required vars and break server-only tests).
  const rampClientId = process.env.RAMP_CLIENT_ID;
  const rampClientSecret = process.env.RAMP_CLIENT_SECRET;
  const oauthApp =
    rampClientId && rampClientSecret
      ? { clientId: rampClientId, clientSecret: rampClientSecret }
      : undefined;

  const client = new RampClient(parsed.data.credentials, {
    oauthApp,
    // Persist a refreshed access token + expiry back to the vault (Ramp does not
    // rotate the refresh token, so it is left untouched). Only relevant to oauth2.
    onTokensRefreshed:
      parsed.data.credentials.type === "oauth2"
        ? async ({ accessToken, expiresAt }) => {
            const current = resolved as {
              credentials?: Record<string, unknown>;
            };
            await persistIntegrationSecrets(serviceRole, companyId, RAMP, {
              ...resolved,
              credentials: {
                ...(current.credentials ?? {}),
                accessToken,
                expiresAt
              }
            });
          }
        : undefined
  });

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
    await client.createAccountingConnection({ remote_provider_name: "Carbon" })
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

/**
 * Push Carbon's active, non-group chart of accounts into Ramp as coding options
 * (`POST /accounting/accounts`, `id` = Carbon `account.id`). Batches at 500. A
 * re-push is an upsert per Ramp semantics.
 */
export async function pushChartOfAccounts(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<{ pushed: number }> {
  const integration = await getRampIntegration(serviceRole, companyId);
  if (!integration) return { pushed: 0 };

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
  const glAccounts = (accounts ?? [])
    .map((account) => {
      const classification = rampClassificationForClass(
        account.class,
        account.id === cardLiabilityId
      );
      if (!classification) return null;
      return {
        id: account.id,
        name: account.name,
        code: account.number ?? undefined,
        classification
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  let pushed = 0;
  for (const batch of chunk(glAccounts, RAMP_ACCOUNTS_BATCH_SIZE)) {
    await client.postAccountingAccounts({ gl_accounts: batch });
    pushed += batch.length;
  }

  return { pushed };
}

/**
 * Push Carbon cost centers into Ramp as a single-choice coding field. Skips
 * silently (returns `{ pushed: 0 }`) when the `costCenter` table is unreadable or
 * empty for the company.
 */
export async function pushCostCenters(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<{ pushed: number }> {
  const integration = await getRampIntegration(serviceRole, companyId);
  if (!integration) return { pushed: 0 };

  const { client } = integration;

  const { data: costCenters, error } = await serviceRole
    .from("costCenter")
    .select("id, name")
    .eq("companyId", companyId);

  // No cost-center table / unreadable / none for this company -> nothing to push.
  if (error || !costCenters || costCenters.length === 0) {
    return { pushed: 0 };
  }

  await client.postAccountingFields({
    id: "carbon-cost-center",
    name: "Cost Center",
    input_type: "SINGLE_CHOICE",
    is_splittable: true
  });

  await client.postAccountingFieldOptions({
    field_id: "carbon-cost-center",
    options: costCenters.map((costCenter) => ({
      id: costCenter.id,
      value: costCenter.name
    }))
  });

  return { pushed: costCenters.length };
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

  const client = new RampClient(parsed.data.credentials);
  const created = RampWebhookCreateResponseSchema.parse(
    await client.createWebhook({
      endpoint_url: `${originUrl}/api/webhook/ramp/${companyId}`,
      event_types: [...RAMP_WEBHOOK_EVENT_TYPES]
    })
  );

  // Re-vault the FULL secret bag (the vault RPC replaces, not merges) plus the
  // new webhookSecret; persistIntegrationSecrets strips secrets back out and
  // writes `webhookId` to the plaintext column.
  const next: Record<string, unknown> = { ...resolved, webhookId: created.id };
  if (created.secret) next.webhookSecret = created.secret;
  await persistIntegrationSecrets(serviceRole, companyId, RAMP, next);

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

  await client.postAccountingSyncs({
    sync_type: args.syncType,
    idempotency_key: idempotencyKey,
    successful_syncs: args.successful.map((item) => ({
      id: item.id,
      reference_id: item.referenceId,
      ...(item.deepLinkUrl ? { deep_link_url: item.deepLinkUrl } : {})
    })),
    failed_syncs: args.failed.map((item) => ({
      id: item.id,
      message: item.message
    }))
  });
}

// /********************************************************\
// *                  Supplier resolution                  *
// \********************************************************/

/**
 * Resolve a Ramp vendor to a Carbon `supplier` id: mapping-first (`vendor`
 * entityType), then a case-insensitive exact `supplier.name` match, then
 * auto-create. Links the `externalIntegrationMapping` when a Ramp vendor id is
 * available. The Kysely handle is a PARAM so the calling job passes its own.
 */
export async function resolveRampSupplier(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  vendor: { id?: string; name: string },
  userId: string,
  kyselyDb: Kysely<KyselyDatabase>
): Promise<string> {
  const mapping = createMappingService(kyselyDb, companyId);

  // 1. Mapping-first.
  if (vendor.id) {
    const mapped = await mapping.getEntityId(RAMP, vendor.id, "vendor");
    if (mapped) return mapped;
  }

  // 2. Case-insensitive exact name match.
  const { data: matches } = await serviceRole
    .from("supplier")
    .select("id")
    .eq("companyId", companyId)
    .ilike("name", vendor.name)
    .limit(1);
  let supplierId = matches?.[0]?.id ?? null;

  // 3. Auto-create.
  if (!supplierId) {
    const { data: created, error } = await serviceRole
      .from("supplier")
      .insert([{ name: vendor.name, companyId, createdBy: userId }])
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
    await mapping.link("vendor", supplierId, RAMP, vendor.id, {
      createdBy: userId
    });
  }

  return supplierId;
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
  supplier: RampVendorSupplier
): Promise<string | null> {
  const existing = await mapping.getExternalId("vendor", supplier.id, RAMP);
  if (existing) return existing;

  const name = (supplier.name ?? "").trim();
  if (!name) return null;

  const byExternal = await findRampSpendVendor(client, {
    external_vendor_id: supplier.id
  });
  const byName = byExternal ?? (await findRampSpendVendor(client, { name }));
  const matched =
    byExternal ??
    (byName && (byName.name ?? "").trim().toLowerCase() === name.toLowerCase()
      ? byName
      : null);
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
    created = (await client.createSpendVendor({
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
    })) as { id?: string } | null;
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
  po: RampPurchaseOrderPush
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
    po.supplier
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

  const created = (await client.createPurchaseOrder({
    purchase_order_number: po.readableId,
    external_id: po.id,
    three_way_match_enabled: false,
    ...(po.currencyCode ? { currency: po.currencyCode } : {}),
    ...(po.entityId ? { entity_id: po.entityId } : {}),
    ...(rampVendorId ? { vendor_id: rampVendorId } : {}),
    line_items: lineItems
  })) as { id?: string } | null;
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
    invoice.supplier
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
  const created = (await client.createDraftBill({
    vendor_id: rampVendorId,
    invoice_number: invoiceNumber,
    ...(invoice.currencyCode ? { invoice_currency: invoice.currencyCode } : {}),
    ...(invoice.dateIssued ? { issued_at: invoice.dateIssued } : {}),
    ...(invoice.dateDue ? { due_at: invoice.dateDue } : {}),
    remote_id: invoice.id,
    ...(documentUrls ? { document_urls: documentUrls } : {}),
    line_items: invoice.lines.map((line) => ({
      memo: line.description ?? undefined,
      amount: line.amount
    }))
  })) as { id?: string } | null;
  const draftId = created?.id ?? null;
  if (!draftId) {
    throw new Error(
      `Ramp did not return a draft-bill id for invoice ${invoice.readableId}`
    );
  }

  // TODO(task-1): confirm whether submit returns the draft id or a promoted bill
  // id; store WHICH id the submit returns (falls back to the draft id).
  const submitted = (await client.submitDraftBill(draftId)) as {
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
