import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import type { SupabaseClient } from "@supabase/supabase-js";
import { data } from "react-router";
import {
  activateMethodVersion,
  findChangeNoticesForItem,
  upsertItemSupersession
} from "~/modules/items";
import { getCompanySettings } from "~/modules/settings";
import { requireUnlockedBulk } from "~/utils/lockedGuard.server";
import type { plmReleaseControl } from "./items.models";
import {
  canEditChangeNoticeEngineering,
  canEditChangeNoticeWorkflow,
  changeNoticeLockedMessage,
  changeNoticeOpenStatuses,
  supersessionModes
} from "./items.models";

const logger = getLogger("erp", "change-orders");

// Release-lock helpers — gate BOM/BOP mutations on a released (Production)
// revision. A Production revision is the controlled, released make method;
// changes must flow through a change notice. The pending revision an ECO creates
// is Design/Prototype (NOT Production), so it stays editable.

export type ReleaseControl = (typeof plmReleaseControl)[number];

type ItemRevisionStatus = Database["public"]["Enums"]["itemRevisionStatus"];

export const LOCKED_REVISION_MESSAGE =
  "This revision is released (Production). Open a change notice to modify it.";

export type LockKind =
  | "item"
  | "makeMethod"
  | "material"
  | "operation"
  | "tool"
  | "parameter";

export type RevisionLock = {
  isLocked: boolean;
  releaseControl: ReleaseControl;
  revisionStatus: ItemRevisionStatus | null;
};

export type LockCheck =
  | { ok: true; warn: false }
  | { ok: true; warn: true; message: string }
  | { ok: false; warn: false; message: string };

export function getLockVerdict(lock: {
  isLocked: boolean;
  releaseControl: ReleaseControl;
}): LockCheck {
  if (!lock.isLocked || lock.releaseControl === "off") {
    return { ok: true, warn: false };
  }
  if (lock.releaseControl === "warn") {
    return { ok: true, warn: true, message: LOCKED_REVISION_MESSAGE };
  }
  return { ok: false, warn: false, message: LOCKED_REVISION_MESSAGE };
}

type MethodLock = {
  revisionStatus: ItemRevisionStatus | null;
  changeNoticeStatus: string | null;
};

const NO_LOCK: MethodLock = { revisionStatus: null, changeNoticeStatus: null };

// The FK chain from each lock kind up to its owning make method, expressed once.
// The two lock inputs (the item's revisionStatus and the owning change notice's
// status) hang off that method, so one nested select answers both — walking the
// chain twice would double a query that runs on every BOM/BOP mutation.
// `methodMaterial` has two FKs to `makeMethod` (makeMethodId and
// materialMakeMethodId); the parent method is methodMaterial_methodId_fkey.
const METHOD_LOCK_SOURCE = "changeOrder(status), item(revisionStatus)";

const methodLockQueries = {
  makeMethod: ["makeMethod", METHOD_LOCK_SOURCE],
  material: [
    "methodMaterial",
    `makeMethod!methodMaterial_methodId_fkey(${METHOD_LOCK_SOURCE})`
  ],
  operation: ["methodOperation", `makeMethod(${METHOD_LOCK_SOURCE})`],
  tool: [
    "methodOperationTool",
    `methodOperation(makeMethod(${METHOD_LOCK_SOURCE}))`
  ],
  parameter: [
    "methodOperationParameter",
    `methodOperation(makeMethod(${METHOD_LOCK_SOURCE}))`
  ]
} as const satisfies Partial<Record<LockKind, readonly [string, string]>>;

// Every base query is scoped by companyId (defense-in-depth; the id is a global
// UUID but tenant scoping is a golden rule). The lock is advisory — RLS +
// requirePermissions are the real boundary — so a null/unresolvable status
// leaves the gate open by design (see checkRevisionLock).
async function resolveMethodLock(
  client: SupabaseClient<Database>,
  kind: LockKind,
  id: string,
  companyId: string
): Promise<MethodLock> {
  if (kind === "item") {
    const item = await client
      .from("item")
      .select("revisionStatus")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle();
    // item.changeOrderId is a PERMANENT back-link stamped at release (not cleared
    // like makeMethod's), so it means "was created by" — never "is owned by".
    // Resolving it would lock every CO-created item forever once its CO hit Done.
    return { ...NO_LOCK, revisionStatus: item.data?.revisionStatus ?? null };
  }

  const [table, select] = methodLockQueries[kind];
  const result = await client
    .from(table)
    .select(select)
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();

  // The select is built from a lookup, so PostgREST's row typing degrades to a
  // generic shape — narrow it once, here, rather than at each read below.
  const method = unwrapMakeMethod(result.data as MethodLockRow | null, kind);
  return {
    revisionStatus: method?.item?.revisionStatus ?? null,
    changeNoticeStatus: method?.changeOrder?.status ?? null
  };
}

type MakeMethodLockRow = {
  changeOrder: { status: string | null } | null;
  item: { revisionStatus: ItemRevisionStatus | null } | null;
};

type MethodLockRow =
  | MakeMethodLockRow
  | { makeMethod: MakeMethodLockRow | null }
  | { methodOperation: { makeMethod: MakeMethodLockRow | null } | null };

function unwrapMakeMethod(
  row: MethodLockRow | null,
  kind: LockKind
): MakeMethodLockRow | null {
  if (!row) return null;
  if (kind === "makeMethod") return row as MakeMethodLockRow;
  if (kind === "tool" || kind === "parameter") {
    return (
      (row as { methodOperation: { makeMethod: MakeMethodLockRow | null } })
        .methodOperation?.makeMethod ?? null
    );
  }
  return (row as { makeMethod: MakeMethodLockRow | null }).makeMethod ?? null;
}

async function getReleaseControl(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<ReleaseControl> {
  const settings = await getCompanySettings(client, companyId);
  return (settings.data?.plmReleaseControl ?? "enforce") as ReleaseControl;
}

// Read variant for loaders that need the raw lock state (revisionStatus +
// releaseControl) to drive read-only UI. A revision is locked ONLY when it is
// "Production".
export async function getRevisionLock(
  client: SupabaseClient<Database>,
  args: { itemId: string | null; companyId: string }
): Promise<RevisionLock> {
  const [lock, releaseControl] = await Promise.all([
    args.itemId
      ? resolveMethodLock(client, "item", args.itemId, args.companyId)
      : Promise.resolve(NO_LOCK),
    getReleaseControl(client, args.companyId)
  ]);

  return {
    isLocked: lock.revisionStatus === "Production",
    releaseControl,
    revisionStatus: lock.revisionStatus
  };
}

// The single guard entry point for mutation routes: resolves the entity's
// parent item and returns the enforce/warn/off verdict. A missing/null id
// (cannot resolve) leaves the lock unlocked, so the gate is safely skipped.
export async function checkRevisionLock(
  client: SupabaseClient<Database>,
  args: { kind: LockKind; id: string | null | undefined; companyId: string }
): Promise<LockCheck> {
  const [lock, releaseControl] = await Promise.all([
    args.id
      ? resolveMethodLock(client, args.kind, args.id, args.companyId)
      : Promise.resolve(NO_LOCK),
    getReleaseControl(client, args.companyId)
  ]);

  // Hard block, independent of releaseControl — releaseControl only governs the
  // revision lock.
  if (
    lock.changeNoticeStatus &&
    !canEditChangeNoticeEngineering(lock.changeNoticeStatus)
  ) {
    return {
      ok: false,
      warn: false,
      message: changeNoticeLockedMessage(lock.changeNoticeStatus)
    };
  }

  return getLockVerdict({
    isLocked: lock.revisionStatus === "Production",
    releaseControl
  });
}

// =============================================================================
// Change Notices — server-only helpers (imports @carbon/jobs).
// =============================================================================

type ChangeNoticeEditScope = "engineering" | "workflow";

// One status read + predicate. Mutation routes call this before writing; the
// UI disable is cosmetic on top of it.
export async function requireChangeNoticeEditable(
  client: SupabaseClient<Database>,
  args: {
    changeNoticeId: string;
    companyId: string;
    scope: ChangeNoticeEditScope;
  }
): Promise<{ error: { message: string }; data: null } | null> {
  const existing = await client
    .from("changeOrder")
    .select("status")
    .eq("id", args.changeNoticeId)
    .eq("companyId", args.companyId)
    .maybeSingle();

  if (existing.error || !existing.data) {
    return { error: { message: "Could not find change notice" }, data: null };
  }

  const canEdit =
    args.scope === "engineering"
      ? canEditChangeNoticeEngineering
      : canEditChangeNoticeWorkflow;

  return requireUnlockedBulk({
    statuses: [existing.data.status],
    checkFn: (status) => !canEdit(status),
    message: changeNoticeLockedMessage(existing.data.status)
  });
}

// The inverse gate: an item owned by an open change notice must not get a manual
// revision, because the notice authors it. Fails closed — a lookup we couldn't
// read cannot prove the item is free.
export async function requireItemChangeNoticeUnlocked(
  client: SupabaseClient<Database>,
  args: { itemId: string; companyId: string }
): Promise<{ error: { message: string }; data: null } | null> {
  const open = await findChangeNoticesForItem(client, {
    itemId: args.itemId,
    companyId: args.companyId,
    statuses: changeNoticeOpenStatuses
  });

  if (open.error) {
    return {
      error: { message: "Could not check open change notices for this item" },
      data: null
    };
  }

  if (open.data.length === 0) return null;

  const ids = open.data.map((co) => co.changeOrderId).join(", ");
  return {
    error: {
      message: `This item is open in change notice ${ids}. Release it to create new revisions.`
    },
    data: null
  };
}

// Child rows (affected items, action tasks) are addressed by their own id, so
// authorizing the change notice in the URL proves nothing about the row being
// mutated — an editable notice's URL would otherwise let a user mutate a frozen
// notice's rows. Same failure contract as requireEditableChangeNoticeRoute;
// null means the route may proceed.
export async function requireChangeNoticeChildRoute(
  request: Request,
  args: {
    client: SupabaseClient<Database>;
    table: "changeOrderAffectedItem" | "changeOrderActionTask";
    id: string;
    changeNoticeId: string;
    companyId: string;
  }
) {
  const row = await args.client
    .from(args.table)
    .select("id")
    .eq("id", args.id)
    .eq("changeOrderId", args.changeNoticeId)
    .eq("companyId", args.companyId)
    .maybeSingle();

  if (row.error || !row.data) {
    const message = "Record does not belong to this change notice";
    return data(
      { success: false },
      await flash(request, error(row.error, message))
    );
  }

  return null;
}

// The route-level guard: resolves the change notice from the URL, checks the
// scope, and returns the flashed failure response so all eight mutation routes
// share one failure contract. Returns null when the route may proceed.
export async function requireEditableChangeNoticeRoute(
  request: Request,
  args: {
    client: SupabaseClient<Database>;
    changeNoticeId: string | undefined;
    companyId: string;
    scope: ChangeNoticeEditScope;
  }
) {
  if (!args.changeNoticeId) throw new Error("Could not find id");

  const locked = await requireChangeNoticeEditable(args.client, {
    changeNoticeId: args.changeNoticeId,
    companyId: args.companyId,
    scope: args.scope
  });
  if (!locked) return null;

  return data(
    { success: false },
    await flash(request, error(locked.error, locked.error.message))
  );
}

// Maps a notifying stage to its notification event. Only Start / Implementation
// / Done notify; Draft / Engineering Complete are silent, so callers simply
// don't invoke this for those stages.
export const changeNoticeStageEvent: Record<string, NotificationEvent> = {
  Start: NotificationEvent.ChangeNoticeStarted,
  Implementation: NotificationEvent.ChangeNoticeImplementation,
  Done: NotificationEvent.ChangeNoticeDone
};

// Notifies the people involved in the CO — its assignee plus every action-task
// assignee — on a stage entry (best-effort). Deliberately NOT a company-wide
// broadcast; the notify function dedupes and drops the acting user itself.
export async function notifyChangeNoticeTransition(args: {
  client: SupabaseClient<Database>;
  event: NotificationEvent;
  changeNoticeId: string;
  companyId: string;
  userId: string;
}): Promise<void> {
  try {
    const [changeNotice, actionTasks] = await Promise.all([
      args.client
        .from("changeOrder")
        .select("assignee")
        .eq("id", args.changeNoticeId)
        .eq("companyId", args.companyId)
        .single(),
      args.client
        .from("changeOrderActionTask")
        .select("assignee")
        .eq("changeOrderId", args.changeNoticeId)
        .eq("companyId", args.companyId)
        .not("assignee", "is", null)
    ]);

    if (changeNotice.error) {
      logger.error("Failed to resolve change notice for CO notification", {
        error: changeNotice.error,
        changeNoticeId: args.changeNoticeId,
        companyId: args.companyId
      });
      return;
    }

    if (actionTasks.error) {
      logger.error("Failed to resolve CO action-task assignees", {
        error: actionTasks.error,
        changeNoticeId: args.changeNoticeId,
        companyId: args.companyId
      });
    }

    const userIds = [
      ...new Set(
        [
          changeNotice.data?.assignee,
          ...(actionTasks.data ?? []).map((task) => task.assignee)
        ].filter((id): id is string => !!id)
      )
    ];

    if (userIds.length === 0) return;

    await trigger("notify", {
      event: args.event,
      companyId: args.companyId,
      documentId: args.changeNoticeId,
      recipient: { type: "users", userIds },
      from: args.userId
    });
  } catch (e) {
    logger.error("Failed to trigger change notice notification", { error: e });
  }
}

// =============================================================================
// applyChangeNotice — the top-to-bottom "release", run on the Implementation →
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
export async function applyChangeNotice(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    changeNoticeId: string;
    userId: string;
    companyId: string;
  }
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const { changeNoticeId, userId, companyId } = args;

  const cn = await client
    .from("changeOrder")
    .select("id, status")
    .eq("id", changeNoticeId)
    .eq("companyId", companyId)
    .single();
  if (cn.error || !cn.data) {
    return { data: null, error: { message: "Change notice not found" } };
  }
  if (cn.data.status !== "Implementation") {
    return {
      data: null,
      error: { message: "Change notice must be at Implementation to apply" }
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
    .eq("changeOrderId", changeNoticeId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });
  if (affectedItems.error) {
    return { data: null, error: affectedItems.error };
  }

  // Release New Part (net-new) items first, so a parent assembly whose draft BOM
  // references a new part resolves to an already-active item when its own method
  // activates. Stable sort preserves the sortOrder/createdAt order within groups.
  const ordered = [...(affectedItems.data ?? [])].sort(
    (a, b) =>
      (a.changeType === "New Part" ? 0 : 1) -
      (b.changeType === "New Part" ? 0 : 1)
  );

  for (const affected of ordered) {
    const result = await releaseAffectedItem(client, {
      changeNoticeId,
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
        .where("id", "=", changeNoticeId)
        .where("companyId", "=", companyId)
        .where("status", "=", "Implementation")
        .executeTakeFirst();
      return Number(res.numUpdatedRows);
    });
    if (updated === 0) {
      return {
        data: null,
        error: { message: "Change notice has already been applied" }
      };
    }
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : "Apply failed" }
    };
  }

  return { data: { id: changeNoticeId }, error: null };
}

// -----------------------------------------------------------------------------
// releaseAffectedItem (v2) — dispatch by change type. The CO-owned Draft make
// method already holds the edited BOM/BOP, so release just:
//   Version          → activate the Draft on the SAME item (prior Active →
//                      Archived); no new item, no supersession.
//   Revision         → activate the Draft + reveal the new revision item + auto
//                      oldRev→newRev supersession.
//   Replacement Part → activate the Draft + reveal the new part + auto
//                      affected→new supersession.
//   New Part         → activate the Draft + reveal the net-new part; NO
//                      supersession (no predecessor).
// Idempotent: once the Draft's changeOrderId is cleared it counts as released.
// -----------------------------------------------------------------------------
async function releaseAffectedItem(
  client: SupabaseClient<Database>,
  input: {
    changeNoticeId: string;
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
  const { changeNoticeId, companyId, userId, affected } = input;
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
        changeOrderId: changeNoticeId,
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", newItemId)
      .eq("companyId", companyId);
    if (reveal.error) return { error: reveal.error };
  }

  // Auto supersession: Revision (oldRev→newRev) / Replacement Part (affected→new).
  // Version edits the SAME item, and a net-new New Part has NO predecessor — so
  // neither writes a supersession (they still reveal their item above). This runs
  // BEFORE clearing the CO-ownership marker so a supersession failure leaves the
  // draft still owned by the CO (changeOrderId set) — the item is re-attempted on
  // retry instead of the CO silently completing without its required supersession.
  // Re-runs are safe: activate/reveal are idempotent and upsertItemSupersession is
  // an upsert.
  if (
    (changeType === "Revision" || changeType === "Replacement Part") &&
    newItemId
  ) {
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
