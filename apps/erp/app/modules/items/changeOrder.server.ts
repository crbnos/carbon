import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { trigger } from "@carbon/jobs";
import { NotificationEvent } from "@carbon/notifications";
import type { SupabaseClient } from "@supabase/supabase-js";
import { activateMethodVersion, upsertItemSupersession } from "~/modules/items";
import {
  buildReleaseConflictEntries,
  getCurrentActiveMakeMethodId
} from "./changeOrder.diff";
import type { ChangeOrderMergeResolution } from "./changeOrder.models";
import { changeOrderMergeEntryKey } from "./changeOrder.models";
import { supersessionModes } from "./items.models";

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
    console.error("Failed to trigger change order notification", e);
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
    // Release-time 2-way merge (Q3): the user's per-line picks and an explicit
    // acknowledgement. Empty/false on a plain release (no moved base).
    resolutions?: ChangeOrderMergeResolution[];
    mergeAcknowledged?: boolean;
  }
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const {
    changeOrderId,
    userId,
    companyId,
    resolutions = [],
    mergeAcknowledged = false
  } = args;

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
      affected,
      resolutions,
      mergeAcknowledged
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
    resolutions: ChangeOrderMergeResolution[];
    mergeAcknowledged: boolean;
  }
): Promise<{ error: { message: string } | null }> {
  const {
    changeOrderId,
    companyId,
    userId,
    affected,
    resolutions,
    mergeAcknowledged
  } = input;
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

  // Release-time 2-way merge (Q3). A Version activates the Draft over the item's
  // CURRENT live method; if that live method moved since the draft was created
  // (a same-part parallel CO released first), reconcile draft-vs-live first so
  // the other CO's work isn't silently clobbered.
  if (changeType === "Version") {
    const reconciled = await reconcileDraftWithLive(client, {
      affected,
      draftMakeMethodId,
      resolutions,
      mergeAcknowledged,
      companyId,
      userId
    });
    if (reconciled.error) return { error: reconciled.error };
  }

  // Activate the Draft method (Draft → Active; prior Active → Archived).
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

  // Clear CO ownership on the Draft — it's now normal method history.
  const clear = await client
    .from("makeMethod")
    .update({ changeOrderId: null })
    .eq("id", draftMakeMethodId)
    .eq("companyId", companyId);
  if (clear.error) return { error: clear.error };

  // Auto supersession: Revision (oldRev→newRev) / New Part (affectedPart→newPart).
  // Version keeps the same item — no supersession (Q2).
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
      console.error("Failed to write revision supersession", sup.error);
    }
  }

  return { error: null };
}

// -----------------------------------------------------------------------------
// Release-time 2-way merge (Q3). When the live method moved under a Version
// draft, reconcile draft("mine") vs current live("theirs") per the user's picks
// (default = the safe choice the diff computed), then activation reflects the
// merged end-state. "Keep mine" is a no-op; "take theirs" makes the draft line
// match live — drop the draft's version (if any) and re-insert live's (if any).
// -----------------------------------------------------------------------------
const AUDIT_COLUMNS = [
  "id",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy"
];

// Every method-row table this merge copies between. `never` casts below are
// confined to this set — a generic column spread can't be expressed across the
// tables' distinct Insert types, and the rows are read straight back from the DB.
type MethodRowTable =
  | "methodMaterial"
  | "methodOperation"
  | "methodOperationStep"
  | "methodOperationParameter"
  | "methodOperationTool";

// Copy one live row into the target method, re-pointing linkage/tenancy via
// `overrides` (audit + id columns are dropped so the DB assigns fresh ones).
async function insertRowCopy(
  client: SupabaseClient<Database>,
  table: MethodRowTable,
  sourceId: string,
  companyId: string,
  overrides: Record<string, unknown>
): Promise<{ id: string | null; error: { message: string } | null }> {
  const src = await client
    .from(table)
    .select("*")
    .eq("id", sourceId)
    .eq("companyId", companyId)
    .single();
  if (src.error) return { id: null, error: src.error };
  const cols = { ...(src.data as Record<string, unknown>) };
  for (const k of AUDIT_COLUMNS) delete cols[k];
  const ins = await client
    .from(table)
    .insert({ ...cols, ...overrides } as never)
    .select("id")
    .single();
  return { id: ins.data?.id ?? null, error: ins.error };
}

// Remove a draft operation and everything hanging off it (children + any draft
// material links) so a subsequent copy/activation has no dangling references.
async function deleteDraftOperation(
  client: SupabaseClient<Database>,
  operationId: string,
  companyId: string
): Promise<{ error: { message: string } | null }> {
  await client
    .from("methodMaterial")
    .update({ methodOperationId: null })
    .eq("methodOperationId", operationId)
    .eq("companyId", companyId);
  for (const table of [
    "methodOperationStep",
    "methodOperationParameter",
    "methodOperationTool"
  ] as const) {
    await client
      .from(table)
      .delete()
      .eq("operationId", operationId)
      .eq("companyId", companyId);
  }
  const del = await client
    .from("methodOperation")
    .delete()
    .eq("id", operationId)
    .eq("companyId", companyId);
  return { error: del.error };
}

// Apply one "take theirs" pick: make the draft's line match live. Material and
// operation share the same drop-then-insert shape; an operation carries its
// children (steps/parameters/tools) as a unit.
async function applyTheirs(
  client: SupabaseClient<Database>,
  input: {
    kind: ChangeOrderMergeResolution["kind"];
    draftMakeMethodId: string;
    draftId: string | null;
    liveId: string | null;
    companyId: string;
    userId: string;
  }
): Promise<{ error: { message: string } | null }> {
  const { kind, draftMakeMethodId, draftId, liveId, companyId, userId } = input;

  // Drop the draft's version of the line (if it has one).
  if (draftId) {
    if (kind === "operation") {
      const del = await deleteDraftOperation(client, draftId, companyId);
      if (del.error) return del;
    } else {
      const del = await client
        .from("methodMaterial")
        .delete()
        .eq("id", draftId)
        .eq("companyId", companyId);
      if (del.error) return { error: del.error };
    }
  }

  // Live-only removal (draft never had it / just dropped it) → nothing to add.
  if (!liveId) return { error: null };

  if (kind === "material") {
    // methodOperationId points at a LIVE operation — null it, don't dangle it.
    const copied = await insertRowCopy(
      client,
      "methodMaterial",
      liveId,
      companyId,
      {
        makeMethodId: draftMakeMethodId,
        methodOperationId: null,
        companyId,
        createdBy: userId
      }
    );
    return { error: copied.error };
  }

  const op = await insertRowCopy(client, "methodOperation", liveId, companyId, {
    makeMethodId: draftMakeMethodId,
    companyId,
    createdBy: userId
  });
  if (op.error || !op.id) {
    return { error: op.error ?? { message: "Failed to copy operation" } };
  }
  for (const table of [
    "methodOperationStep",
    "methodOperationParameter",
    "methodOperationTool"
  ] as const) {
    const kids = await client
      .from(table)
      .select("id")
      .eq("operationId", liveId)
      .eq("companyId", companyId);
    if (kids.error) return { error: kids.error };
    for (const kid of kids.data ?? []) {
      const copied = await insertRowCopy(client, table, kid.id, companyId, {
        operationId: op.id,
        companyId,
        createdBy: userId
      });
      if (copied.error) return { error: copied.error };
    }
  }
  return { error: null };
}

// Reconcile a Version draft against the item's current live method before it is
// activated. No-op when the base hasn't moved. When it has, blocks release until
// the merge is acknowledged, then applies each conflicting line's resolution
// (client pick, else the diff's safe default).
async function reconcileDraftWithLive(
  client: SupabaseClient<Database>,
  input: {
    affected: { id: string; itemId: string; baseMakeMethodId: string | null };
    draftMakeMethodId: string;
    resolutions: ChangeOrderMergeResolution[];
    mergeAcknowledged: boolean;
    companyId: string;
    userId: string;
  }
): Promise<{ error: { message: string } | null }> {
  const { affected, draftMakeMethodId, resolutions, companyId, userId } = input;

  const liveId = await getCurrentActiveMakeMethodId(
    client,
    affected.itemId,
    companyId
  );
  if (!liveId || liveId === affected.baseMakeMethodId) return { error: null };

  const built = await buildReleaseConflictEntries(
    client,
    { id: affected.id, itemId: affected.itemId, draftMakeMethodId },
    liveId,
    companyId
  );
  if (built.error) return { error: built.error };
  if (built.entries.length === 0) return { error: null };
  if (!input.mergeAcknowledged) {
    return {
      error: {
        message:
          "The live method changed since this change order started. Review and resolve the merge before releasing."
      }
    };
  }

  const picks = new Map(
    resolutions
      .filter((r) => r.affectedItemId === affected.id)
      .map((r) => [changeOrderMergeEntryKey(r), r.choice])
  );
  for (const entry of built.entries) {
    const choice =
      picks.get(changeOrderMergeEntryKey(entry)) ?? entry.defaultChoice;
    if (choice !== "theirs") continue;
    const applied = await applyTheirs(client, {
      kind: entry.kind,
      draftMakeMethodId,
      draftId: entry.draftId,
      liveId: entry.liveId,
      companyId,
      userId
    });
    if (applied.error) return applied;
  }
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
