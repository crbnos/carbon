import { createHash } from "node:crypto";
import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildRampIdempotencyKey } from "./client";
import { getRampIntegration } from "./connection";
import { rampOwnsCodingSurface } from "./modes";

const logger = getLogger("ee", "ramp");

// /********************************************************\
// *                    Sync confirms                      *
// \********************************************************/

/**
 * Confirm a batch of postings back to Ramp (`POST /accounting/syncs`). A no-op
 * batch is skipped.
 *
 * The idempotency key hashes the OUTCOME of each id, not just the id set.
 * Hashing ids alone permanently wedges an item that fails once: the failure is
 * confirmed under key K, and after the underlying bug is fixed the retry
 * rebuilds the same id set, so Ramp rejects the identical key with
 * `400 DEVELOPER_7005 "Idempotency key already exists"` — Ramp does NOT replay
 * a stored response here. Because the throw aborted the whole family, one
 * previously-failed item blocked every later item too. Live-hit 2026-09-24.
 *
 * Including `ok`/`message` keeps genuine duplicates idempotent (identical
 * outcome ⇒ identical key ⇒ Ramp rejects the repeat, which is what we want)
 * while letting a CHANGED outcome (failed ⇒ succeeded) through as new work.
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

  // `POST /accounting/syncs` needs `accounting:write`, which a push-only install
  // does not hold — and confirming is the SEAT-HOLDER's job anyway: the sync
  // status Carbon would be clearing belongs to whichever system Ramp is
  // connected to. Push-only still pulls bill payments, so this path IS reached;
  // without the gate every run would 403.
  //
  // Skipping is safe: idempotency here is the `externalIntegrationMapping`, not
  // the confirm — the same reason repayments have never confirmed.
  if (!rampOwnsCodingSurface(integration.metadata)) return;

  const { client } = integration;

  const outcomes = [
    ...args.successful.map((item) => `${item.id}:ok`),
    ...args.failed.map((item) => `${item.id}:fail:${item.message}`)
  ].sort();
  const scope = createHash("sha256").update(outcomes.join(",")).digest("hex");
  const idempotencyKey = buildRampIdempotencyKey({
    companyId,
    operation: args.syncType,
    scope
  });

  try {
    await client.postAccountingSyncs(
      buildSyncConfirmBody(args, idempotencyKey)
    );
  } catch (err) {
    // A duplicate key means THIS EXACT outcome was already confirmed — the
    // desired end state. Swallow it rather than throwing: the confirm is the
    // last step of a family sync, and letting it abort the run stops every
    // later family from syncing at all.
    if (
      err instanceof Error &&
      /DEVELOPER_7005|Idempotency key already exists/i.test(err.message)
    ) {
      // Still say so. Silence here means a family that never confirms — because
      // the outcome hash matched a PREVIOUS run's — is indistinguishable from
      // one that confirmed cleanly, and Ramp keeps showing the transactions as
      // SYNC_READY with nothing in Carbon to explain it.
      logger.warning("Ramp sync confirm already recorded — skipping", {
        companyId,
        syncType: args.syncType,
        successful: args.successful.length,
        failed: args.failed.length,
        idempotencyKey,
        error: err.message
      });
      return;
    }
    throw err;
  }
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
