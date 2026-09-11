import { createHash } from "node:crypto";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildRampIdempotencyKey } from "./client";
import { getRampIntegration } from "./connection";

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
