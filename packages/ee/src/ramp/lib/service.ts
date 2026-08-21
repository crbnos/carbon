import { createHash } from "node:crypto";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { round } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createMappingService } from "../../accounting/core/external-mapping";
import {
  persistIntegrationSecrets,
  resolveIntegrationSecrets
} from "../../integrations/secrets";
import { buildRampIdempotencyKey, RampClient } from "./client";
import {
  RampAccountingConnectionSchema,
  type RampIntegrationMetadata,
  RampIntegrationMetadataSchema
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

  return {
    client: new RampClient(parsed.data.credentials),
    metadata: parsed.data
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

  const { data: accounts, error } = await serviceRole
    .from("account")
    .select("id, number, name, class")
    .eq("companyId", companyId)
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
