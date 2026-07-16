import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import type { SupabaseClient } from "@supabase/supabase-js";
import { activateMethodVersion, upsertItemSupersession } from "~/modules/items";
import { supersessionModes } from "./items.models";

const logger = getLogger("erp", "change-orders");

// =============================================================================
// Change Orders — server-only helpers (imports @carbon/jobs).
// =============================================================================

// Maps a broadcast stage to its notification event. Only Start / Implementation
// / Done broadcast (PRD §3.1); Draft / Engineering Complete are silent, so
// callers simply don't invoke this for those stages.
export const changeOrderStageEvent: Record<string, NotificationEvent> = {
  Start: NotificationEvent.ChangeOrderStarted,
  Implementation: NotificationEvent.ChangeOrderImplementation,
  Done: NotificationEvent.ChangeOrderDone
};

// notifyChangeOrderTransition — broadcasts a stage transition to the whole
// company team (PRD §3.1 "Broadcast to team"). The recipient is the company
// employee group; the `notify` job expands it via the users_for_groups RPC.
// Best-effort: never throws into the caller's redirect path.
export async function notifyChangeOrderTransition(args: {
  event: NotificationEvent;
  changeOrderId: string;
  companyId: string;
  companyGroupId: string;
  userId: string;
}): Promise<void> {
  try {
    await trigger("notify", {
      event: args.event,
      companyId: args.companyId,
      documentId: args.changeOrderId,
      recipient: { type: "group", groupIds: [args.companyGroupId] },
      from: args.userId
    });
  } catch (e) {
    logger.error("Failed to trigger change order notification", { error: e });
  }
}

// =============================================================================
// applyChangeOrder — the top-to-bottom "release", run on the Implementation →
// Done transition (this function IS that transition). It materializes each
// affected item's CO-staged end-state onto a NEW inactive revision, activates
// it, then auto-writes the oldRev → newRev supersession (Q1/Q2/Q5).
//
// Atomicity (G2): createRevision + activateMethodVersion are edge-function
// (functions.invoke → get-method / convert) calls, so this CANNOT be one Kysely
// transaction. The apply is therefore an idempotent, CAS-guarded orchestration:
//   - PER-AFFECTED-ITEM idempotency: each changeOrderAffectedItem gets its
//     created revision id stamped into `newItemId` at the END of its processing.
//     A re-run skips any affected item whose `newItemId` is already set, so a
//     partial failure re-run resumes at the first unprocessed item instead of
//     re-creating revisions.
//   - CO-LEVEL idempotency: the final flip to 'Done' is a compare-and-swap on
//     status='Implementation', so a re-run can't double-transition the CO; only
//     the closing status flip is transactional.
// =============================================================================
export async function applyChangeOrder(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    changeOrderId: string;
    userId: string;
    companyId: string;
  }
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const { changeOrderId, userId, companyId } = args;

  const co = await client
    .from("changeOrder")
    .select("id, status")
    .eq("id", changeOrderId)
    .eq("companyId", companyId)
    .single();
  if (co.error || !co.data) {
    return { data: null, error: { message: "Change order not found" } };
  }
  if (co.data.status !== "Implementation") {
    return {
      data: null,
      error: { message: "Change order must be at Implementation to apply" }
    };
  }

  // Load the affected items with change type + draft refs + cutover config.
  // v2: the draft make method already holds the edited BOM/BOP; release just
  // activates it (and reveals the new item for Revision/New Part). Idempotency
  // is per-item inside releaseAffectedItem (skip once the draft is no longer
  // CO-owned).
  const affectedItems = await client
    .from("changeOrderAffectedItem")
    .select(
      "id, itemId, changeType, draftMakeMethodId, baseMakeMethodId, newItemId, supersessionMode, discontinuationDate, successorEffectivityDate"
    )
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });
  if (affectedItems.error) {
    return { data: null, error: affectedItems.error };
  }

  for (const affected of affectedItems.data ?? []) {
    const result = await releaseAffectedItem(client, {
      changeOrderId,
      companyId,
      userId,
      affected
    });
    if (result.error) return { data: null, error: result.error };
  }

  // Final compare-and-swap: Implementation → Done (the only transactional write).
  try {
    const updated = await db.transaction().execute(async (trx) => {
      const res = await trx
        .updateTable("changeOrder")
        .set({ status: "Done", updatedBy: userId })
        .where("id", "=", changeOrderId)
        .where("companyId", "=", companyId)
        .where("status", "=", "Implementation")
        .executeTakeFirst();
      return Number(res.numUpdatedRows);
    });
    if (updated === 0) {
      return {
        data: null,
        error: { message: "Change order has already been applied" }
      };
    }
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : "Apply failed" }
    };
  }

  return { data: { id: changeOrderId }, error: null };
}

// -----------------------------------------------------------------------------
// releaseAffectedItem (v2) — dispatch by change type. The CO-owned Draft make
// method already holds the edited BOM/BOP, so release just:
//   Version  → activate the Draft on the SAME item (prior Active → Archived);
//              no new item, no supersession (Q2).
//   Revision → activate the Draft + reveal the new revision item + auto
//              oldRev→newRev supersession.
//   New Part → activate the Draft + reveal the new part + auto affectedPart→
//              newPart supersession.
// Idempotent: once the Draft's changeOrderId is cleared it counts as released.
// -----------------------------------------------------------------------------
async function releaseAffectedItem(
  client: SupabaseClient<Database>,
  input: {
    changeOrderId: string;
    companyId: string;
    userId: string;
    affected: {
      id: string;
      itemId: string;
      changeType: Database["public"]["Enums"]["changeOrderChangeType"];
      draftMakeMethodId: string | null;
      baseMakeMethodId: string | null;
      newItemId: string | null;
      supersessionMode: Database["public"]["Enums"]["supersessionMode"] | null;
      discontinuationDate: string | null;
      successorEffectivityDate: string | null;
    };
  }
): Promise<{ error: { message: string } | null }> {
  const { changeOrderId, companyId, userId, affected } = input;
  const { changeType, draftMakeMethodId, newItemId } = affected;
  const sourceItemId = affected.itemId;

  if (!draftMakeMethodId) {
    return { error: { message: "Affected item has no draft make method" } };
  }

  // Idempotency: a Draft still owned by this CO has not been released yet; once
  // released we clear changeOrderId, so a re-run skips it.
  const draft = await client
    .from("makeMethod")
    .select("changeOrderId")
    .eq("id", draftMakeMethodId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (draft.error) return { error: draft.error };
  if (!draft.data || !draft.data.changeOrderId) {
    return { error: null };
  }

  // Activate the Draft method (Draft → Active; prior Active → Archived). A
  // Version simply appends a new Active version and archives the prior one — the
  // prior version's rows are preserved as method history, so there is nothing to
  // merge even if another CO released a newer version in the meantime.
  const activated = await activateMethodVersion(client, {
    id: draftMakeMethodId,
    companyId,
    userId
  });
  if (activated.error) {
    return { error: { message: "Failed to activate method" } };
  }

  // Reveal the new item for Revision / New Part (Version edits the same item).
  if (newItemId) {
    const reveal = await client
      .from("item")
      .update({
        active: true,
        changeOrderId,
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", newItemId)
      .eq("companyId", companyId);
    if (reveal.error) return { error: reveal.error };
  }

  // Auto supersession: Revision (oldRev→newRev) / New Part (affectedPart→newPart).
  // Version keeps the same item — no supersession (Q2). This runs BEFORE clearing
  // the CO-ownership marker so a supersession failure leaves the draft still owned
  // by the CO (changeOrderId set) — the item is re-attempted on retry instead of
  // the CO silently completing without its required supersession. Re-runs are
  // safe: activate/reveal are idempotent and upsertItemSupersession is an upsert.
  if (changeType !== "Version" && newItemId) {
    const sup = await upsertItemSupersession(client, {
      itemId: sourceItemId,
      successorItemId: newItemId,
      supersessionMode: normalizeSupersessionMode(affected.supersessionMode),
      // Empty per-item dates mean "effective immediately at release" — the
      // supersession redirect map treats a null successorEffectivityDate as
      // always-effective. Cutover timing is driven purely per affected item now.
      discontinuationDate: affected.discontinuationDate ?? undefined,
      successorEffectivityDate: affected.successorEffectivityDate ?? undefined,
      companyId,
      createdBy: userId,
      updatedBy: userId
    });
    if (sup.error) {
      logger.error("Failed to write revision supersession", {
        error: sup.error
      });
      return { error: sup.error };
    }
  }

  // Clear CO ownership on the Draft — the FINAL, idempotency-marking step. Once
  // cleared the draft is normal method history and a re-run skips this item.
  const clear = await client
    .from("makeMethod")
    .update({ changeOrderId: null })
    .eq("id", draftMakeMethodId)
    .eq("companyId", companyId);
  if (clear.error) return { error: clear.error };

  return { error: null };
}

// Coerce a possibly-null DB supersession mode to a valid enum member, defaulting
// to 'Consume First' (Q3 default) when unset/invalid.
function normalizeSupersessionMode(
  mode: string | null | undefined
): Database["public"]["Enums"]["supersessionMode"] {
  return (supersessionModes as readonly string[]).includes(mode ?? "")
    ? (mode as Database["public"]["Enums"]["supersessionMode"])
    : "Consume First";
}
