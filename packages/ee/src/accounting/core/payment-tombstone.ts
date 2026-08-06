import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolve the composite `payment` external ids for a bare provider payment id.
 *
 * A hard-deleted QBO `Payment`/`BillPayment` arrives as a CDC tombstone that
 * carries only the bare payment id (no lines → no settled document), so the
 * canonical composite (`<documentRemoteId>:<paymentRemoteId>` for AR, or
 * `bill:<documentRemoteId>:<paymentRemoteId>` for AP) can no longer be rebuilt
 * from the wire. But it was persisted when the payment first synced: both
 * composite forms END with `:<paymentRemoteId>`, so a suffix match against the
 * `externalIntegrationMapping` rows recovers the composite(s) the caller needs
 * to enqueue the reversing (void) pull.
 *
 * Returns `[]` when nothing maps (the payment was never synced, or belongs to
 * another Carbon instance) — the caller then skips it exactly as before. A
 * lookup failure also returns `[]` (logged): the sweep leaves the tombstone
 * unhandled rather than fabricating a void.
 *
 * The DB `LIKE` is a coarse prefilter (`%:<paymentRemoteId>`); the JS
 * `endsWith` guard makes the suffix match exact regardless of `LIKE`
 * metacharacters in the id.
 */
export async function findPaymentCompositesByRemoteId(
  client: SupabaseClient<Database>,
  args: { companyId: string; integration: string; paymentRemoteId: string }
): Promise<string[]> {
  const suffix = `:${args.paymentRemoteId}`;

  const result = await client
    .from("externalIntegrationMapping")
    .select("externalId")
    .eq("companyId", args.companyId)
    .eq("integration", args.integration)
    .eq("entityType", "payment")
    .like("externalId", `%${suffix}`);

  if (result.error) {
    console.error(
      `[PAYMENT TOMBSTONE] ${args.companyId}/${args.integration}: failed to resolve composites for payment ${args.paymentRemoteId}: ${result.error.message}`
    );
    return [];
  }

  return (result.data ?? []).flatMap((row) =>
    row.externalId && row.externalId.endsWith(suffix) ? [row.externalId] : []
  );
}
