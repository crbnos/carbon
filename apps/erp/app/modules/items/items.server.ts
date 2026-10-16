// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { type Database, fetchAllByIds, type Json } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { approvalDecisionValidator } from "@carbon/ee/approvals";
import {
  cancelPendingApprovals,
  decideApprovalRequest,
  openApprovalRequests
} from "@carbon/ee/approvals/document.server";
import { hasPendingApproval } from "@carbon/ee/approvals.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { oncePerRead } from "@carbon/logger/middleware.server";
import { NotificationEvent } from "@carbon/notifications";
import { datetime, isUniqueViolation, pluckUnique } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { data } from "react-router";
import { z } from "zod";
import { flattenTree } from "~/components/TreeView";
import { replanAfterItemChange } from "~/modules/production/production.server";
import {
  defineServiceFn,
  type ServiceContext
} from "~/modules/service-fn.server";
import { getCompanySettings } from "~/modules/settings/settings.service";
import { methodType, sourcingType } from "~/modules/shared/shared.models";
import {
  isActiveCompanyEmployee,
  refuseUnlessOwned
} from "~/modules/shared/shared.server";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import {
  type BomOperation,
  calculateMadePartCosts,
  resolveOperationRates,
  type WorkCenterRate
} from "~/utils/bom";
import type { plmReleaseControl } from "./items.models";
import {
  applyStorageAndShelfLifeRefines,
  canEditChangeNoticeEngineering,
  canEditChangeNoticeWorkflow,
  changeNoticeAwaitingApprovalMessage,
  changeNoticeChangeTypes,
  changeNoticeLockedMessage,
  changeNoticeNotifyStages,
  changeNoticeOpenStatuses,
  changeNoticeStatusValidator,
  changeNoticeValidator,
  deriveItemMethodUpdate,
  getMethodValidator,
  itemManufacturingValidator,
  itemPlanningValidator,
  itemReplenishmentSystems,
  itemSupersessionValidator,
  itemTrackingTypes,
  makeMethodVersionValidator,
  partFields,
  predecessorSupersessionValidator,
  supersessionModes,
  supplierPartPriceBreaksValidator,
  supplierPartValidator,
  toolFields
} from "./items.models";
import {
  activateMethodVersion,
  addChangeNoticeAffectedItem,
  cascadeItemTrackingType,
  copyItem,
  copyMakeMethod,
  findChangeNoticesForItem,
  getChangeNoticeTypesList,
  getItem,
  getItemSupersededBy,
  getItemSupersession,
  getMakeMethodById,
  getMakeMethods,
  getMethodTree,
  insertChangeNotice,
  SUPERSESSION_CYCLE_CODE,
  updateChangeNoticeStatus,
  updateItemMethodAndSourcing,
  updateMaterialProperties,
  updateServiceName,
  upsertItemManufacturing,
  upsertItemPlanning,
  upsertItemSupersession,
  upsertMakeMethodVersion,
  upsertPart,
  upsertSupplierPart,
  upsertTool
} from "./items.service";

const logger = getLogger("erp", "change-orders");

// An item page's layout and its tab loaders run in ONE request and each read the
// item's methods and change notices. These share that read across the loaders;
// on a mutation they are plain calls, so a revalidation never sees stale rows.

export const getMakeMethodsOnce = (
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) =>
  oncePerRead(`makeMethods:${companyId}:${itemId}`, () =>
    getMakeMethods(client, itemId, companyId)
  );

export const getMakeMethodByIdOnce = (
  client: SupabaseClient<Database>,
  makeMethodId: string,
  companyId: string
) =>
  oncePerRead(`makeMethod:${companyId}:${makeMethodId}`, () =>
    getMakeMethodById(client, makeMethodId, companyId)
  );

export const findChangeNoticesForItemOnce = (
  client: SupabaseClient<Database>,
  args: { itemId: string; companyId: string }
) =>
  oncePerRead(`changeNotices:${args.companyId}:${args.itemId}`, () =>
    findChangeNoticesForItem(client, args)
  );

export async function getItemChangeNoticeDataOnce(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const [changeNotices, changeNoticeTypes] = await Promise.all([
    findChangeNoticesForItemOnce(client, { itemId, companyId }),
    getChangeNoticeTypesList(client, companyId)
  ]);
  return {
    changeNotices: changeNotices.data,
    changeNoticeTypes: changeNoticeTypes.data ?? []
  };
}

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
  changeNoticeId: string | null;
  changeNoticeStatus: string | null;
};

const NO_LOCK: MethodLock = {
  revisionStatus: null,
  changeNoticeId: null,
  changeNoticeStatus: null
};

// The FK chain from each lock kind up to its owning make method, expressed once.
// The two lock inputs (the item's revisionStatus and the owning change notice's
// status) hang off that method, so one nested select answers both — walking the
// chain twice would double a query that runs on every BOM/BOP mutation.
// `methodMaterial` has two FKs to `makeMethod` (makeMethodId and
// materialMakeMethodId); the parent method is methodMaterial_methodId_fkey.
const METHOD_LOCK_SOURCE = "changeOrder(id, status), item(revisionStatus)";

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
    changeNoticeId: method?.changeOrder?.id ?? null,
    changeNoticeStatus: method?.changeOrder?.status ?? null
  };
}

type MakeMethodLockRow = {
  changeOrder: { id: string; status: string | null } | null;
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
  const changeNoticeLock = lock.changeNoticeId
    ? await getChangeNoticeEngineeringLock(
        lock.changeNoticeId,
        lock.changeNoticeStatus
      )
    : null;
  if (changeNoticeLock) {
    return { ok: false, warn: false, message: changeNoticeLock };
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

// Why a change notice's engineering content cannot be edited, or null. An
// approval request can only be pending at Engineering Complete (approval gates
// the move to Implementation), so only that stage pays for the lookup;
// approvalRequest is service-role only.
async function getChangeNoticeEngineeringLock(
  changeNoticeId: string,
  status: string | null | undefined
): Promise<string | null> {
  if (!canEditChangeNoticeEngineering(status)) {
    return changeNoticeLockedMessage(status);
  }
  if (
    status === "Engineering Complete" &&
    (await hasPendingApproval(
      getCarbonServiceRole(),
      "changeOrder",
      changeNoticeId
    ))
  ) {
    return changeNoticeAwaitingApprovalMessage;
  }
  return null;
}

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

  const { status } = existing.data;
  const message =
    args.scope === "engineering"
      ? await getChangeNoticeEngineeringLock(args.changeNoticeId, status)
      : canEditChangeNoticeWorkflow(status)
        ? null
        : changeNoticeLockedMessage(status);

  return message ? { error: { message }, data: null } : null;
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
// Atomicity (G2): createRevision + activateMethodVersion call the get-method /
// convert operations, each of which commits its own transaction, so this CANNOT
// be one Kysely transaction. The apply is therefore an idempotent, CAS-guarded orchestration:
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
    const result = await releaseAffectedItem(client, db, {
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
  db: Kysely<KyselyDatabase>,
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
  const activated = await activateMethodVersion(client, db, {
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

// -----------------------------------------------------------------------------
// Unreleased-change-order guard.
//
// Release is what activates a change notice's items: `applyChangeNotice` flips
// `active` on the revisions and parts the notice minted. Nothing stops a user
// switching the Active toggle on by hand first, and once it is on the item is
// selectable everywhere — carrying the notice's un-approved draft BOM, since a
// minted revision's only make method is that Draft and `activeMakeMethods` falls
// back to it when no Active version exists.
//
// So two kinds of write ask this question: one that would ACTIVATE such an item,
// and one that would CONSUME it (a sales order line, a purchase order line, a
// job).
//
// `item.changeOrderId` is NOT a draft marker on its own — release leaves it in
// place as a provenance back-link, so the owning change order's status decides.
// Release IS the Implementation -> Done transition, so every other status means
// the item is still a draft.
//
// Pass a service-role client: reading `changeOrder` requires `parts_view`, which
// the caller need not have.
// -----------------------------------------------------------------------------
const RELEASED_CHANGE_ORDER_STATUS = "Done";

export type UnreleasedChangeOrderItem = {
  itemId: string;
  itemName: string;
  changeOrderReadableId: string;
};

// Both reads go through fetchAllByIds: an `in` filter rides in the URL and a
// response stops at PostgREST's row cap. Truncating either one would drop an
// item from the answer, and a missing row reads as "no change order holds it".

// Two queries per batch of ids — the bulk item update can carry a whole table
// selection.
//
// `error` is a message to show the user, not a thrown failure — a read that did
// not answer says nothing about the items, so callers block on it rather than
// wave the write through on a database blip.
export async function getUnreleasedChangeOrderItems(
  client: SupabaseClient<Database>,
  args: { itemIds: string[]; companyId: string }
): Promise<{ data: UnreleasedChangeOrderItem[]; error: string | null }> {
  if (args.itemIds.length === 0) return { data: [], error: null };

  const items = await fetchAllByIds(args.itemIds, (batch) =>
    client
      .from("item")
      .select("id, readableIdWithRevision, changeOrderId")
      .in("id", batch)
      .eq("companyId", args.companyId)
      .order("id")
  );

  if (items.error) {
    logger.error("Failed to read items for change order check", {
      error: items.error,
      itemIds: args.itemIds
    });
    return {
      data: [],
      error: "These items could not be checked against their change orders."
    };
  }

  const owned = (items.data ?? []).filter(
    (item): item is typeof item & { changeOrderId: string } =>
      !!item.changeOrderId
  );
  if (owned.length === 0) return { data: [], error: null };

  const changeOrders = await fetchAllByIds(
    [...new Set(owned.map((item) => item.changeOrderId))],
    (batch) =>
      client
        .from("changeOrder")
        .select("id, changeOrderId, status")
        .in("id", batch)
        .eq("companyId", args.companyId)
        .order("id")
  );

  if (changeOrders.error) {
    logger.error("Failed to read change orders for change order check", {
      error: changeOrders.error,
      itemIds: args.itemIds
    });
    return {
      data: [],
      error: "These items could not be checked against their change orders."
    };
  }

  const unreleased = new Map(
    (changeOrders.data ?? [])
      .filter((co) => co.status !== RELEASED_CHANGE_ORDER_STATUS)
      .map((co) => [co.id, co.changeOrderId])
  );

  return {
    data: owned.flatMap((item) => {
      const changeOrderReadableId = unreleased.get(item.changeOrderId);
      if (!changeOrderReadableId) return [];
      return [
        {
          itemId: item.id,
          itemName: item.readableIdWithRevision ?? "This item",
          changeOrderReadableId
        }
      ];
    }),
    error: null
  };
}

// Single-item form for the loaders that only need to know whether to lock the
// Active toggle on this one item's page. Best-effort: a failed read leaves the
// toggle unlocked, and the action behind it still refuses the write.
export async function getUnreleasedChangeOrderForItem(
  client: SupabaseClient<Database>,
  args: { itemId: string; companyId: string }
): Promise<UnreleasedChangeOrderItem | null> {
  const unreleased = await getUnreleasedChangeOrderItems(client, {
    itemIds: [args.itemId],
    companyId: args.companyId
  });
  return unreleased.data[0] ?? null;
}

// Single-item form for the actions that put an item into circulation. Returns
// the reason to refuse, or null. Unlike the loader form this fails closed: a
// read that did not answer says nothing about the item.
//
// Deliberately does NOT judge `active`. Plain inactive items are allowed onto
// these documents today, and changing that is a separate decision from closing
// the change order hole.
export async function getUnreleasedChangeOrderIssue(
  client: SupabaseClient<Database>,
  args: { itemId: string; companyId: string }
): Promise<string | null> {
  const unreleased = await getUnreleasedChangeOrderItems(client, {
    itemIds: [args.itemId],
    companyId: args.companyId
  });
  if (unreleased.error) return unreleased.error;
  if (unreleased.data.length === 0) return null;
  return unreleasedChangeOrderItemsMessage(unreleased.data);
}

// Names every offending item so a bulk edit says which row to fix.
export function unreleasedChangeOrderItemsMessage(
  unreleased: UnreleasedChangeOrderItem[]
) {
  return unreleased
    .map(
      (item) =>
        `${item.itemName} was created by change order ${item.changeOrderReadableId}, which has not been released yet.`
    )
    .join(" ");
}

// Not awaited by the item layouts: only the header badge and the properties
// sidebar read these, so they stream instead of holding the page.
export function streamItemSupersession(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return {
    supersession: getItemSupersession(client, itemId, companyId).then(
      (result) => result.data,
      (error) => {
        logger.error("Failed to load item supersession", {
          companyId,
          itemId,
          error
        });
        return null;
      }
    ),
    supersededBy: getItemSupersededBy(client, itemId, companyId).then(
      (result) => result.data ?? [],
      (error) => {
        logger.error("Failed to load item predecessors", {
          companyId,
          itemId,
          error
        });
        return [];
      }
    )
  };
}

// ── Item fields (the items tables' bulk actions and the properties panels) ──

/** The `custom-*` fields of a form, by field id (`setCustomFields`). */
const customFieldsInput = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .optional();

const itemIdsInput = z.array(z.string()).min(1);

/**
 * Change items' tracking type.
 *
 * @remarks
 * Writes `itemTrackingType` on every item, then carries the serial and batch
 * flags onto the open jobs, receipts, shipments and stock transfers that copied
 * them (`cascadeItemTrackingType`). A failed carry-over leaves the items
 * changed and returns an error.
 *
 * @mcp
 */
export const setItemTrackingType = defineServiceFn({
  input: z.object({
    ids: itemIdsInput,
    itemTrackingType: z.enum(itemTrackingTypes)
  }),
  permission: { update: "parts" },

  async run(ctx, { ids, itemTrackingType }) {
    const companyId = ctx.company.id;
    const update = await ctx.asCaller.supabase
      .from("item")
      .update({
        itemTrackingType,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .in("id", ids)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error("internal", update.error.message, update.error);
    }

    try {
      await cascadeItemTrackingType(ctx.asSystem.pg, {
        itemIds: ids,
        companyId,
        newType: itemTrackingType,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return ctx.error("internal", "Failed to cascade tracking flags", err);
    }
    return { ids };
  }
});

/**
 * Change items' name, description, manufacturer part number or unit of measure.
 *
 * @remarks
 * A field left out is unchanged; every item gets the same value.
 *
 * @mcp
 */
export const setItemFields = defineServiceFn({
  input: z.object({
    ids: itemIdsInput,
    name: z.string().optional(),
    description: z.string().optional(),
    mpn: z.string().optional(),
    unitOfMeasureCode: z.string().optional()
  }),
  permission: { update: "parts" },

  async run(ctx, { ids, ...fields }) {
    const update = await ctx.asCaller.supabase
      .from("item")
      .update({
        ...Object.fromEntries(
          Object.entries(fields).filter(([, value]) => value !== undefined)
        ),
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .in("id", ids)
      .eq("companyId", ctx.company.id);
    if (update.error) {
      return ctx.error("internal", update.error.message, update.error);
    }
    return { ids };
  }
});

/**
 * Change items' replenishment system, default method type or sourcing type.
 *
 * @remarks
 * Exactly one of the three per call. They are interlocked
 * (`deriveItemMethodUpdate`): a concrete replenishment system sets the default
 * method type, a concrete method type sets the replenishment system, and a
 * sourcing type sets the method type. The item columns and their copies on
 * the items' Draft method materials change in one transaction
 * (`updateItemMethodAndSourcing`); Active and Archived methods are left alone.
 *
 * @mcp
 */
export const setItemSourcing = defineServiceFn({
  input: z
    .object({
      ids: itemIdsInput,
      replenishmentSystem: z.enum(itemReplenishmentSystems).optional(),
      defaultMethodType: z.enum(methodType).optional(),
      sourcingType: z.enum(sourcingType).optional()
    })
    .refine(
      (input) =>
        [
          input.replenishmentSystem,
          input.defaultMethodType,
          input.sourcingType
        ].filter((value) => value !== undefined).length === 1,
      {
        message:
          "Set exactly one of replenishmentSystem, defaultMethodType or sourcingType"
      }
    ),
  permission: { update: "parts" },

  async run(
    ctx,
    { ids, replenishmentSystem, defaultMethodType, sourcingType }
  ) {
    const { itemUpdate, cascade } = replenishmentSystem
      ? deriveItemMethodUpdate("replenishmentSystem", replenishmentSystem)
      : defaultMethodType
        ? deriveItemMethodUpdate("defaultMethodType", defaultMethodType)
        : deriveItemMethodUpdate("sourcingType", sourcingType ?? "");
    try {
      await updateItemMethodAndSourcing(ctx.asSystem.pg, {
        itemIds: ids,
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        itemUpdate,
        cascade
      });
    } catch (err) {
      return ctx.error("internal", "Failed to update item", err);
    }
    return { ids };
  }
});

/**
 * Activate or deactivate items.
 *
 * @remarks
 * Activating is refused while a change notice that created an item is not
 * released: release activates the revisions and parts a notice minted, and an
 * item switched on by hand would reach the pickers, MRP and job creation with
 * the notice's unapproved draft method. Deactivating is always allowed.
 *
 * @mcp
 */
export const setItemActive = defineServiceFn({
  input: z.object({ ids: itemIdsInput, active: z.boolean() }),
  permission: { update: "parts" },

  async run(ctx, { ids, active }) {
    const companyId = ctx.company.id;
    if (active) {
      const unreleased = await getUnreleasedChangeOrderItems(
        ctx.asSystem.supabase,
        { itemIds: ids, companyId }
      );
      if (unreleased.error) return ctx.error("internal", unreleased.error);
      if (unreleased.data.length > 0) {
        return ctx.error(
          "rule",
          `${unreleasedChangeOrderItemsMessage(
            unreleased.data
          )} Release the change notice to activate it.`
        );
      }
    }

    const update = await ctx.asCaller.supabase
      .from("item")
      .update({
        active,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .in("id", ids)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error("internal", update.error.message, update.error);
    }
    return { ids };
  }
});

/**
 * Set items' item group (posting group).
 *
 * @remarks
 * The group lives on the item's cost row: it is updated where the item has
 * one, and a Standard cost row of zero is created where it has none. Null
 * clears the group.
 *
 * @mcp
 */
export const setItemPostingGroup = defineServiceFn({
  input: z.object({
    ids: itemIdsInput,
    itemPostingGroupId: z.string().nullable()
  }),
  permission: { update: "parts" },

  async run(ctx, { ids, itemPostingGroupId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const now = datetime.timestamp();

    const existing = await client
      .from("itemCost")
      .select("itemId")
      .in("itemId", ids)
      .eq("companyId", companyId);
    if (existing.error) {
      return ctx.error("internal", existing.error.message, existing.error);
    }
    const costed = new Set(existing.data.map((row) => row.itemId));
    const uncosted = ids.filter((id) => !costed.has(id));

    if (costed.size > 0) {
      const update = await client
        .from("itemCost")
        .update({ itemPostingGroupId, updatedBy: userId, updatedAt: now })
        .in("itemId", [...costed])
        .eq("companyId", companyId);
      if (update.error) {
        return ctx.error("internal", update.error.message, update.error);
      }
    }
    if (uncosted.length > 0) {
      const insert = await client.from("itemCost").insert(
        uncosted.map((itemId) => ({
          itemId,
          itemPostingGroupId,
          costingMethod: "Standard" as const,
          standardCost: 0,
          unitCost: 0,
          costIsAdjusted: false,
          companyId,
          createdBy: userId,
          updatedBy: userId,
          createdAt: now,
          updatedAt: now
        }))
      );
      if (insert.error) {
        return ctx.error("internal", insert.error.message, insert.error);
      }
    }
    return { ids };
  }
});

const renumberedTable = {
  Part: "part",
  Consumable: "consumable",
  Material: "material",
  Tool: "tool"
} as const;

/**
 * Change the readable id (part number) of a part, consumable, material or tool.
 *
 * @remarks
 * Every revision of the item takes the new id, and so does its type row
 * (`part`, `consumable`, `material`, `tool`), which is keyed by it. Refused
 * when the item is not of `type`.
 *
 * @mcp
 */
export const setItemReadableId = defineServiceFn({
  input: z.object({
    id: z.string(),
    type: z.enum(["Part", "Consumable", "Material", "Tool"]),
    readableId: z.string().min(1)
  }),
  permission: { update: "parts" },

  async run(ctx, { id, type, readableId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const item = await client
      .from("item")
      .select("readableId")
      .eq("id", id)
      .eq("type", type)
      .eq("companyId", companyId)
      .maybeSingle();
    if (item.error) {
      return ctx.error("internal", item.error.message, item.error);
    }
    if (!item.data) {
      return ctx.error("notFound", `Item is not a ${type.toLowerCase()}`);
    }
    const current = item.data.readableId;

    const revisions = await client
      .from("item")
      .select("id")
      .eq("readableId", current)
      .eq("type", type)
      .eq("companyId", companyId);
    if (revisions.error) {
      return ctx.error("internal", revisions.error.message, revisions.error);
    }

    const audit = {
      updatedBy: ctx.auditUserId,
      updatedAt: datetime.timestamp()
    };
    const [itemUpdate, typedUpdate] = await Promise.all([
      client
        .from("item")
        .update({ readableId, ...audit })
        .in(
          "id",
          revisions.data.map((revision) => revision.id)
        )
        .eq("companyId", companyId),
      client
        .from(renumberedTable[type] as "part")
        .update({ id: readableId, ...audit })
        .eq("id", current)
        .eq("companyId", companyId)
    ]);
    const failed = typedUpdate.error ?? itemUpdate.error;
    if (failed) return ctx.error("internal", failed.message, failed);
    return { id, readableId };
  }
});

/**
 * Rename a service.
 *
 * @remarks
 * A service is identified by its name, so every revision's readable id and the
 * service row's id follow it (`updateServiceName`, one transaction). Refused
 * when the name is empty or another service already has it.
 *
 * @mcp
 */
export const renameService = defineServiceFn({
  input: z.object({ itemId: z.string(), name: z.string() }),
  permission: { update: "parts" },

  async run(ctx, { itemId, name }) {
    let renamed: Awaited<ReturnType<typeof updateServiceName>>;
    try {
      renamed = await updateServiceName(ctx.asSystem.pg, {
        itemId,
        name,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return ctx.error("internal", "Failed to update service name", err);
    }
    if (renamed.error) return ctx.error("rule", renamed.error.message);
    return renamed.data;
  }
});

/**
 * Change materials' substance, shape, type, finish, grade or dimension.
 *
 * @remarks
 * For each material among `ids` (its revisions count once), the change goes
 * through `updateMaterialProperties`: dependent properties reset, each value
 * must fit the substance and shape, and generated material ids are renamed.
 * Each material commits on its own, so every material is tried and every
 * refusal is named. A field left out is unchanged; null clears it.
 *
 * @mcp
 */
export const setMaterialProperties = defineServiceFn({
  input: z.object({
    ids: itemIdsInput,
    materialSubstanceId: z.string().nullable().optional(),
    materialFormId: z.string().nullable().optional(),
    materialTypeId: z.string().nullable().optional(),
    finishId: z.string().nullable().optional(),
    gradeId: z.string().nullable().optional(),
    dimensionId: z.string().nullable().optional()
  }),
  permission: { update: "parts" },

  async run(ctx, { ids, ...properties }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const items = await client
      .from("item")
      .select("readableId")
      .in("id", ids)
      .eq("companyId", companyId);
    if (items.error) {
      return ctx.error("internal", items.error.message, items.error);
    }
    const materialIds = [...new Set(items.data.map((item) => item.readableId))];
    if (materialIds.length === 0) {
      return ctx.error("notFound", "No materials found");
    }

    const changes = Object.fromEntries(
      Object.entries(properties)
        .filter(([, value]) => value !== undefined)
        .map(([field, value]) => [field, value || null])
    );
    const failures: string[] = [];
    for (const materialId of materialIds) {
      const update = await updateMaterialProperties(client, ctx.asSystem.pg, {
        id: materialId,
        companyId,
        updatedBy: ctx.auditUserId,
        ...changes
      });
      if (update.error) failures.push(`${materialId}: ${update.error.message}`);
    }
    if (failures.length > 0) return ctx.error("rule", failures.join("; "));
    return { materialIds };
  }
});

// ── Part and tool details, manufacturing and planning ───────────────────────

const partInput = applyStorageAndShelfLifeRefines(
  partFields.extend({ customFields: customFieldsInput })
);

/**
 * Create a part.
 *
 * @remarks
 * Writes the item and its part row, its item group and unit cost, batch size,
 * default storage unit and shelf life (`upsertPart`). A part created with a
 * CAD model queues the model's optimisation, which also renders its
 * thumbnail.
 *
 * @mcp
 */
export const createPart = defineServiceFn({
  input: partInput,
  permission: { create: "parts" },

  async run(ctx, part) {
    const companyId = ctx.company.id;
    const created = await upsertPart(ctx.asCaller.supabase, {
      ...part,
      companyId,
      createdBy: ctx.auditUserId
    });
    const id = created.data?.id;
    if (created.error || !id) {
      return ctx.error("internal", "Failed to insert part", created.error);
    }

    if (part.modelUploadId) {
      await trigger("model-optimize", {
        modelUploadId: part.modelUploadId,
        companyId,
        userId: ctx.auditUserId
      }).catch((err) =>
        logger.error("Failed to queue the new part's model optimisation", {
          companyId,
          itemId: id,
          error: err
        })
      );
    }
    return { id };
  }
});

/**
 * Save a part's details.
 *
 * @remarks
 * `id` is the item id or the part number. A full replace: an optional field
 * left out is cleared (`upsertPart`), including the default storage unit and
 * shelf life.
 *
 * @mcp
 */
export const updatePart = defineServiceFn({
  input: partInput,
  permission: { update: "parts" },

  async run(ctx, part) {
    const updated = await upsertPart(ctx.asCaller.supabase, {
      ...part,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId
    });
    if (updated.error) {
      return ctx.error("internal", "Failed to update part", updated.error);
    }
    return { id: part.id };
  }
});

/**
 * Save a tool's details.
 *
 * @remarks
 * `id` is the item id or the tool number. A full replace: an optional field
 * left out is cleared (`upsertTool`).
 *
 * @mcp
 */
export const updateTool = defineServiceFn({
  input: applyStorageAndShelfLifeRefines(
    toolFields.extend({ customFields: customFieldsInput })
  ),
  permission: { update: "parts" },

  async run(ctx, tool) {
    const updated = await upsertTool(ctx.asCaller.supabase, {
      ...tool,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId
    });
    if (updated.error) {
      return ctx.error("internal", "Failed to update tool", updated.error);
    }
    return { id: tool.id };
  }
});

/**
 * Save an item's manufacturing settings, then re-plan it.
 *
 * @remarks
 * Batch size, scrap percentage, lead time and whether it must be configured.
 * MRP then re-plans the item, so the planning pages' suggestions follow the
 * new settings now rather than at the next scheduled run; a failed run does
 * not fail the save.
 *
 * @mcp
 */
export const updateItemManufacturing = defineServiceFn({
  input: itemManufacturingValidator.safeExtend({
    customFields: customFieldsInput
  }),
  permission: { update: "parts" },

  async run(ctx, { customFields, ...manufacturing }) {
    const update = await upsertItemManufacturing(ctx.asCaller.supabase, {
      ...manufacturing,
      ...(customFields && { customFields }),
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update item manufacturing",
        update.error
      );
    }
    await replanAfterItemChange(ctx, { itemId: manufacturing.itemId });
    return { itemId: manufacturing.itemId };
  }
});

/**
 * Save an item's planning settings at a location, then re-plan it.
 *
 * @remarks
 * The reordering policy and its sizing parameters, the planning horizon and
 * the responsible employee. A full replace: an optional field left out is
 * cleared. The responsible employee must be an active employee of the
 * company. MRP then re-plans the item, so the planning pages' suggestions
 * follow the new settings now; a failed run does not fail the save.
 *
 * @mcp
 */
export const updateItemPlanning = defineServiceFn({
  input: itemPlanningValidator.safeExtend({ customFields: customFieldsInput }),
  permission: { update: "parts" },

  async run(ctx, { customFields, ...planning }) {
    const client = ctx.asCaller.supabase;
    // The column references the global user table, so the database would
    // take a person from another company, or one since deactivated.
    if (
      planning.responsibleEmployee &&
      !(await isActiveCompanyEmployee(
        client,
        ctx.company.id,
        planning.responsibleEmployee
      ))
    ) {
      return ctx.error("rule", "Choose an employee of this company");
    }

    const update = await upsertItemPlanning(client, {
      ...planning,
      ...(customFields && { customFields }),
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update item planning",
        update.error
      );
    }
    await replanAfterItemChange(ctx, { itemId: planning.itemId });
    return { itemId: planning.itemId, locationId: planning.locationId };
  }
});

/**
 * Set or clear an item's supersession: the successor that replaces it and how
 * it is phased out.
 *
 * @remarks
 * Mode, successor, discontinuation and successor effectivity dates, and the
 * conversion factor (1 old = N new). No mode clears the supersession. With
 * `locationId`, also the minimum service-stock reserve at that location.
 * Refused (`rule`) when the successor would close a loop, or make a chain
 * longer than ten hops.
 *
 * @mcp destructive
 */
export const setItemSupersession = defineServiceFn({
  input: itemSupersessionValidator,
  permission: { update: "parts" },

  async run(ctx, supersession) {
    const upsert = await upsertItemSupersession(ctx.asCaller.supabase, {
      ...supersession,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId,
      updatedBy: ctx.auditUserId
    });
    if (upsert.error) {
      return upsert.error.code === SUPERSESSION_CYCLE_CODE
        ? ctx.error("rule", upsert.error.message)
        : ctx.error("internal", "Failed to update supersession", upsert.error);
    }
    return { itemId: supersession.itemId };
  }
});

/**
 * Make another part a predecessor of this one: the other part is phased out
 * in favour of `itemId`.
 *
 * @remarks
 * The supersession is written on the predecessor, with `itemId` as its
 * successor. Refused when the predecessor is the part itself, is not one of
 * the company's parts, already has a different successor (change it from that
 * part's planning page), or would close a loop.
 *
 * @mcp
 */
export const addItemPredecessor = defineServiceFn({
  input: predecessorSupersessionValidator.safeExtend({ itemId: z.string() }),
  permission: { update: "parts" },

  async run(ctx, { itemId, predecessorItemId, ...supersession }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    if (predecessorItemId === itemId) {
      return ctx.error("rule", "A part cannot be its own predecessor");
    }

    const [predecessor, existing] = await Promise.all([
      client
        .from("item")
        .select("id, readableIdWithRevision")
        .eq("id", predecessorItemId)
        .eq("companyId", companyId)
        .maybeSingle(),
      getItemSupersession(client, predecessorItemId, companyId)
    ]);
    if (!predecessor.data) return ctx.error("notFound", "Part not found");
    if (existing.error) {
      return ctx.error(
        "internal",
        "Failed to read the part's supersession",
        existing.error
      );
    }
    if (
      existing.data?.successorItemId &&
      existing.data.successorItemId !== itemId
    ) {
      return ctx.error(
        "rule",
        `${predecessor.data.readableIdWithRevision ?? predecessorItemId} already has a successor (${existing.data.successor?.readableIdWithRevision ?? existing.data.successorItemId}). Change it from that part's planning page.`
      );
    }

    const upsert = await upsertItemSupersession(client, {
      ...supersession,
      itemId: predecessorItemId,
      successorItemId: itemId,
      companyId,
      createdBy: ctx.auditUserId,
      updatedBy: ctx.auditUserId
    });
    if (upsert.error) {
      return upsert.error.code === SUPERSESSION_CYCLE_CODE
        ? ctx.error("rule", upsert.error.message)
        : ctx.error("internal", "Failed to add predecessor", upsert.error);
    }
    return { itemId: predecessorItemId, successorItemId: itemId };
  }
});

// ── Supplier parts ──────────────────────────────────────────────────────────

const supplierPartInput = supplierPartValidator.omit({ id: true }).extend({
  priceBreaks: supplierPartPriceBreaksValidator.optional(),
  customFields: customFieldsInput
});

const supplierPartTaken =
  "This item already has a supplier part for this supplier";

function priceBreakRows(
  ctx: ServiceContext,
  supplierPartId: string,
  priceBreaks: z.output<typeof supplierPartPriceBreaksValidator>
) {
  return priceBreaks.map((priceBreak) => ({
    supplierPartId,
    quantity: priceBreak.quantity,
    supplierUnitPrice: priceBreak.supplierUnitPrice,
    leadTime: priceBreak.leadTime ?? 0,
    sourceType: "Manual Entry" as const,
    companyId: ctx.company.id,
    createdBy: ctx.auditUserId,
    updatedBy: ctx.auditUserId
  }));
}

/**
 * Add a supplier part to an item: what the supplier calls it, and what it
 * costs.
 *
 * @remarks
 * The supplier's part number, unit of measure and conversion factor, minimum
 * order quantity, order multiple, and the price per purchase unit in
 * `currencyCode` (the base currency when empty). One supplier part per item
 * and supplier (`conflict`). `priceBreaks` are saved as Manual Entry price
 * breaks; a failed price break write is logged and does not undo the
 * supplier part.
 *
 * @mcp
 */
export const createSupplierPart = defineServiceFn({
  input: supplierPartInput,
  permission: { create: "parts" },

  async run(ctx, { priceBreaks, customFields, ...supplierPart }) {
    const client = ctx.asCaller.supabase;
    const created = await upsertSupplierPart(client, {
      ...supplierPart,
      ...(customFields && { customFields }),
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
    if (isUniqueViolation(created.error)) {
      return ctx.error("conflict", supplierPartTaken);
    }
    if (created.error) {
      return ctx.error(
        "internal",
        "Failed to create supplier part",
        created.error
      );
    }
    const id = created.data.id;

    if (priceBreaks?.length) {
      const inserted = await client
        .from("supplierPartPrice")
        .insert(priceBreakRows(ctx, id, priceBreaks));
      if (inserted.error) {
        logger.error("Failed to save a new supplier part's price breaks", {
          companyId: ctx.company.id,
          supplierPartId: id,
          error: inserted.error
        });
      }
    }
    return { id };
  }
});

/**
 * Save a supplier part.
 *
 * @remarks
 * A full replace of the supplier part's fields. One supplier part per item and
 * supplier (`conflict`). With `priceBreaks`, the supplier part's price breaks
 * are replaced by them as Manual Entry breaks, in one transaction; without,
 * they are left as they are.
 *
 * @mcp
 */
export const updateSupplierPart = defineServiceFn({
  input: supplierPartInput.extend({ id: z.string() }),
  permission: { update: "parts" },

  async run(ctx, { id, priceBreaks, customFields, ...supplierPart }) {
    const companyId = ctx.company.id;
    const updated = await upsertSupplierPart(ctx.asCaller.supabase, {
      ...supplierPart,
      ...(customFields && { customFields }),
      id,
      companyId,
      updatedBy: ctx.auditUserId
    });
    if (isUniqueViolation(updated.error)) {
      return ctx.error("conflict", supplierPartTaken);
    }
    if (updated.error) {
      return ctx.error(
        "internal",
        "Failed to update supplier part",
        updated.error
      );
    }

    // The caller's update above proved the supplier part is the company's.
    if (priceBreaks) {
      await ctx.transaction(async (tx) => {
        await tx.asSystem.pg
          .deleteFrom("supplierPartPrice")
          .where("supplierPartId", "=", id)
          .where("companyId", "=", companyId)
          .execute();
        if (priceBreaks.length > 0) {
          await tx.asSystem.pg
            .insertInto("supplierPartPrice")
            .values(priceBreakRows(ctx, id, priceBreaks))
            .execute();
        }
      });
    }
    return { id };
  }
});

// ── Make methods ────────────────────────────────────────────────────────────

const isMakeMethodId = (id: string) => id.startsWith("make_");

/**
 * Copy one make method onto another: Get Method and Save Method.
 *
 * @remarks
 * `sourceId` and `targetId` are items (their active method) or make method
 * versions (`make_` ids). The target's bill of materials, bill of process,
 * parameters, tools, steps and work instructions are replaced by the source's,
 * each as its flag says (get-method). Refused when the target's revision is
 * released and release control enforces it, or a change notice holds it; with
 * release control on warn the copy goes ahead and `notice` says why it would
 * have been held.
 *
 * @mcp destructive
 */
export const copyMethod = defineServiceFn({
  input: getMethodValidator,
  permission: { update: "parts" },

  async run(ctx, input) {
    const companyId = ctx.company.id;
    const system = ctx.asSystem.supabase;
    // Copying overwrites the target's materials and operations.
    const lock = await checkRevisionLock(system, {
      kind: isMakeMethodId(input.targetId) ? "makeMethod" : "item",
      id: input.targetId,
      companyId
    });
    if (!lock.ok) return ctx.error("rule", lock.message);

    const args = { ...input, companyId, userId: ctx.auditUserId };
    const copy =
      isMakeMethodId(input.sourceId) || isMakeMethodId(input.targetId)
        ? await copyMakeMethod(system, ctx.asSystem.pg, args)
        : await copyItem(system, ctx.asSystem.pg, args);
    if (copy.error) {
      return ctx.error("internal", "Failed to copy method", copy.error);
    }
    return {
      targetId: input.targetId,
      notice: lock.warn ? lock.message : undefined
    };
  }
});

/**
 * Create a new Draft version of an item's make method, copied from one of its
 * versions.
 *
 * @remarks
 * The new version takes `copyFromId`'s header and, through get-method, its
 * whole bill of materials and process. `activeVersionId` is made Active first
 * (the item's only version, when its successor is drafted).
 *
 * @mcp
 */
export const createMethodVersion = defineServiceFn({
  input: makeMethodVersionValidator,
  permission: { create: "parts" },

  async run(ctx, input) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const insert = await upsertMakeMethodVersion(ctx.asCaller.supabase, {
      ...input,
      companyId,
      createdBy: userId
    });
    const version = insert.data;
    if (insert.error || !version?.id || !version.type || !version.itemId) {
      return ctx.error(
        "internal",
        "Failed to insert new version",
        insert.error
      );
    }

    const copy = await copyMakeMethod(ctx.asSystem.supabase, ctx.asSystem.pg, {
      sourceId: input.copyFromId,
      targetId: version.id,
      billOfMaterial: true,
      billOfProcess: true,
      parameters: true,
      tools: true,
      steps: true,
      workInstructions: true,
      companyId,
      userId
    });
    if (copy.error) {
      return ctx.error("internal", "Failed to copy make method", copy.error);
    }
    return { id: version.id, itemId: version.itemId, type: version.type };
  }
});

/**
 * Delete an operation from a make method's bill of process.
 *
 * @remarks
 * Refused when the method's revision is released and release control enforces
 * it, or a change notice holds it; with release control on warn the delete
 * goes ahead and `notice` says why it would have been held.
 *
 * @mcp destructive
 */
export const deleteMethodOperation = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { delete: "parts" },

  async run(ctx, { id }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const lock = await checkRevisionLock(client, {
      kind: "operation",
      id,
      companyId
    });
    if (!lock.ok) return ctx.error("rule", lock.message);

    const deleted = await client
      .from("methodOperation")
      .delete()
      .eq("id", id)
      .eq("companyId", companyId);
    if (deleted.error) {
      return ctx.error("internal", deleted.error.message, deleted.error);
    }
    return { id, notice: lock.warn ? lock.message : undefined };
  }
});

/**
 * Recalculate a made item's unit cost from its make method.
 *
 * @remarks
 * Rolls up the active make method (or the newest Draft) and every sub-method:
 * material costs, and each operation's setup, labor, machine and overhead at
 * its work center's rates (or the rates of the work centers that run its
 * process), spread over each item's batch size, as the bill of materials CSV
 * export does. Overwrites the item's unit cost with the result.
 *
 * @mcp
 */
export const recalculateItemCost = defineServiceFn({
  input: z.object({ itemId: z.string() }),
  permission: { update: "parts" },

  async run(ctx, { itemId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const makeMethod = await client
      .from("activeMakeMethods")
      .select("id")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (makeMethod.error || !makeMethod.data?.id) {
      return ctx.error(
        "notFound",
        "No make method found for this item",
        makeMethod.error
      );
    }

    const methodTree = await getMethodTree(client, makeMethod.data.id);
    if (methodTree.error) {
      return ctx.error(
        "internal",
        "Failed to load method tree",
        methodTree.error
      );
    }
    const methods =
      methodTree.data.length > 0 ? flattenTree(methodTree.data[0]) : [];
    if (methods.length === 0) {
      return ctx.error("notFound", "No methods found in the method tree");
    }

    const makeMethodIds = pluckUnique(methods, (m) => m.data.makeMethodId);
    const itemIds = pluckUnique(methods, (m) => m.data.itemId);
    const [methodOperations, workCentersResult, lotSizesResult] =
      await Promise.all([
        client
          .from("methodOperation")
          .select(
            "*, ...process(processName:name), ...workCenter(workCenterName:name, laborRate, machineRate, overheadRate)"
          )
          .in("makeMethodId", makeMethodIds)
          .eq("companyId", companyId),
        client
          .from("workCenters")
          .select("id, active, laborRate, machineRate, overheadRate, processes")
          .eq("companyId", companyId),
        client
          .from("itemReplenishment")
          .select("itemId, lotSize")
          .in("itemId", itemIds)
      ]);

    const lotSizesByItemId = new Map(
      (lotSizesResult.data ?? []).map((r) => [r.itemId, r.lotSize ?? 1])
    );
    const workCenters: WorkCenterRate[] = (workCentersResult.data ?? []).map(
      (wc) => ({
        id: wc.id!,
        active: wc.active ?? false,
        laborRate: wc.laborRate,
        machineRate: wc.machineRate,
        overheadRate: wc.overheadRate,
        processes: wc.processes
      })
    );

    const bomOperationsByKey: Record<string, BomOperation[]> = {};
    for (const op of methodOperations.data ?? []) {
      const rates = resolveOperationRates(
        op.workCenterId,
        op.processId,
        op.laborRate,
        op.machineRate,
        op.overheadRate,
        workCenters
      );
      (bomOperationsByKey[op.makeMethodId] ??= []).push({
        operationType: op.operationType,
        setupTime: op.setupTime,
        setupUnit: op.setupUnit,
        laborTime: op.laborTime,
        laborUnit: op.laborUnit,
        machineTime: op.machineTime,
        machineUnit: op.machineUnit,
        operationUnitCost: op.operationUnitCost,
        operationMinimumCost: op.operationMinimumCost,
        ...rates
      } as BomOperation);
    }

    const computedCosts = calculateMadePartCosts(
      methods,
      bomOperationsByKey,
      (node) => node.data.materialMakeMethodId,
      lotSizesByItemId
    );
    // The top-level cost is the root node's.
    const unitCost = computedCosts.get(methods[0].id) ?? 0;

    const update = await client
      .from("itemCost")
      .update({ unitCost, updatedBy: ctx.auditUserId })
      .eq("itemId", itemId)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error("internal", "Failed to update item cost", update.error);
    }
    return { itemId, unitCost };
  }
});

// ── Change notices ──────────────────────────────────────────────────────────

// Reason and description arrive as plain text; the columns are tiptap JSON, so
// non-empty text becomes a one-paragraph doc the detail page's editor can edit.
function toRichText(value: string | undefined): Json | undefined {
  if (!value) return undefined;
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: value }] }]
  } as unknown as Json;
}

/**
 * Create a change notice, with the parts it changes.
 *
 * @remarks
 * The number comes from the change notice sequence unless `changeOrderId` is
 * given; the open date defaults to today in the company's timezone. Each of
 * `affectedItemIds` that is one of the company's parts is added as a Version
 * change (`addChangeNoticeAffectedItem`, which makes a bought part a Revision
 * and creates the notice's draft method). Anything that is not a part is
 * skipped. The notice stays when an item cannot be added: `warning` says so.
 *
 * @mcp
 */
export const createChangeNotice = defineServiceFn({
  input: changeNoticeValidator.omit({ id: true, type: true }).extend({
    openDate: z.string().optional(),
    customFields: customFieldsInput
  }),
  permission: { create: "parts" },

  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const created = await insertChangeNotice(client, {
      changeNoticeId: input.changeOrderId || undefined,
      name: input.name,
      reasonForChange: toRichText(input.reasonForChange),
      description: toRichText(input.description),
      priority: input.priority,
      changeNoticeTypeId: input.changeOrderTypeId || undefined,
      nonConformanceId: input.nonConformanceId || undefined,
      openDate:
        input.openDate ||
        datetime.today(await getCompanyTimeZone(client, companyId)).toString(),
      dueDate: input.dueDate || undefined,
      assignee: input.assignee || undefined,
      companyId,
      createdBy: userId,
      customFields: input.customFields
    });
    if (created.error || !created.data) {
      return ctx.error(
        "internal",
        "Failed to create change notice",
        created.error
      );
    }
    const id = created.data.id;

    // Change notices change parts only; the create modal opens from tool
    // pages too.
    const submitted = [...new Set(input.affectedItemIds ?? [])];
    const items = submitted.length
      ? await client
          .from("item")
          .select("id, type")
          .in("id", submitted)
          .eq("companyId", companyId)
      : null;
    const partIds = (items?.data ?? [])
      .filter((item) => item.type === "Part")
      .map((item) => item.id);

    let failed = !!items?.error;
    for (const itemId of partIds) {
      const added = await addChangeNoticeAffectedItem(client, ctx.asSystem.pg, {
        changeNoticeId: id,
        itemId,
        changeType: "Version",
        companyId,
        userId
      });
      if (added.error) {
        logger.error("Failed to add an affected item to a new change notice", {
          companyId,
          changeNoticeId: id,
          itemId,
          error: added.error
        });
        failed = true;
      }
    }

    const warning = failed
      ? "Change notice created, but some items could not be added"
      : partIds.length < submitted.length
        ? "Change notice created. Change notices support Parts only, so non-Part items were skipped"
        : undefined;
    return { id, warning };
  }
});

/**
 * Create a change notice for one item.
 *
 * @remarks
 * Named "Change for" the item, opened today in the company's timezone, with
 * the item as its first affected item (`addChangeNoticeAffectedItem`, a
 * Version change unless `changeType` says otherwise; `revision` names a
 * Revision's new revision). The notice stays when the item cannot be added:
 * `warning` says so.
 *
 * @mcp
 */
export const createChangeNoticeForItem = defineServiceFn({
  input: z.object({
    itemId: z.string(),
    changeType: z.enum(changeNoticeChangeTypes).default("Version"),
    revision: z.string().optional()
  }),
  permission: { create: "parts" },

  async run(ctx, { itemId, changeType, revision }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const owned = await refuseUnlessOwned(ctx, "item", { id: itemId });
    if (owned) return owned;

    const item = await getItem(client, itemId);
    const label =
      item.data?.readableIdWithRevision ?? item.data?.readableId ?? itemId;

    const created = await insertChangeNotice(client, {
      companyId,
      createdBy: userId,
      name: `Change for ${label}`,
      openDate: datetime
        .today(await getCompanyTimeZone(client, companyId))
        .toString()
    });
    if (created.error || !created.data) {
      return ctx.error(
        "internal",
        "Failed to create change notice",
        created.error
      );
    }
    const id = created.data.id;

    const added = await addChangeNoticeAffectedItem(client, ctx.asSystem.pg, {
      changeNoticeId: id,
      itemId,
      changeType,
      revision,
      companyId,
      userId
    });
    if (added.error) {
      logger.error("Failed to add the item to its new change notice", {
        companyId,
        changeNoticeId: id,
        itemId,
        error: added.error
      });
      return {
        id,
        warning: "Change notice created, but the item could not be added"
      };
    }
    return { id, warning: undefined };
  }
});

/**
 * Move a change notice to another stage.
 *
 * @remarks
 * `fromStatus` is the stage the caller saw: the move is a compare-and-swap on
 * it, and only the transitions `changeNoticeStatusTransitions` allows are
 * taken. With an approval rule, Engineering Complete → Implementation opens an
 * approval request and notifies the approvers instead of moving
 * (`approvalRequested`); approving it moves the notice. Implementation → Done
 * is the release (`applyChangeNotice`): it activates each affected item's
 * draft method, reveals new revisions and parts, and writes their
 * supersessions. Cancelling, or advancing past the gate after the rule was
 * turned off, withdraws a pending request. Entering Start, Implementation or
 * Done notifies the assignee and the action-task assignees.
 *
 * @mcp
 */
export const setChangeNoticeStatus = defineServiceFn({
  input: changeNoticeStatusValidator,
  permission: { update: "parts" },

  async run(ctx, { id, fromStatus, status, assignee }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const isGatedAdvance =
      fromStatus === "Engineering Complete" && status === "Implementation";
    if (isGatedAdvance) {
      // A stale page must not open a request for a notice that has moved on.
      const current = await client
        .from("changeOrder")
        .select("status")
        .eq("id", id)
        .eq("companyId", companyId)
        .maybeSingle();
      if (current.data?.status !== fromStatus) {
        return ctx.error(
          "conflict",
          "The change notice was updated by someone else. Refresh and try again.",
          current.error
        );
      }

      const opened = await openApprovalRequests(ctx.asSystem.supabase, {
        documentType: "changeOrder",
        documentIds: [id],
        companyId,
        userId
      });
      if (opened.status === "opened" && opened.approverIds.length > 0) {
        await trigger("notify", {
          event: NotificationEvent.ApprovalRequested,
          companyId,
          documentId: id,
          documentType: "changeOrder",
          recipient: { type: "users", userIds: opened.approverIds },
          from: userId
        }).catch((e) =>
          logger.error("Failed to notify change notice approvers", {
            companyId,
            changeNoticeId: id,
            error: e
          })
        );
      }
      if (opened.status === "failed") {
        return ctx.error("internal", "Failed to submit for approval");
      }
      if (opened.status === "opened") {
        if (opened.requested.length === 0) {
          return ctx.error(
            "conflict",
            "This change notice is already waiting for approval"
          );
        }
        return { id, status: fromStatus, approvalRequested: true };
      }
    }

    if (status === "Done") {
      const applied = await applyChangeNotice(client, ctx.asSystem.pg, {
        changeNoticeId: id,
        userId,
        companyId
      });
      if (applied.error || !applied.data) {
        return ctx.error(
          "internal",
          "Failed to apply change notice",
          applied.error
        );
      }
    } else {
      const update = await updateChangeNoticeStatus(client, {
        id,
        companyId,
        fromStatus,
        toStatus: status,
        assignee,
        updatedBy: userId
      });
      if (update.error || !update.data) {
        return ctx.error(
          "internal",
          "Failed to update change notice status",
          update.error
        );
      }
    }

    if (status === "Cancelled" || isGatedAdvance) {
      const cancelled = await cancelPendingApprovals(ctx.asSystem.supabase, {
        documentType: "changeOrder",
        documentIds: [id],
        companyId,
        userId
      });
      if (cancelled.error) {
        logger.error("Failed to cancel change notice approval requests", {
          companyId,
          changeNoticeId: id,
          error: cancelled.error
        });
      }
    }

    if (changeNoticeNotifyStages.includes(status)) {
      await notifyChangeNoticeTransition({
        client,
        event: changeNoticeStageEvent[status],
        changeNoticeId: id,
        companyId,
        userId
      });
    }
    return { id, status, approvalRequested: false };
  }
});

/**
 * Approve or reject a change notice's pending approval request.
 *
 * @remarks
 * Approving moves the notice from Engineering Complete to Implementation, in
 * the decision's transaction, and notifies the notice's assignee and
 * action-task assignees as an advance would. Rejecting leaves the stage. The
 * requester is told either way, unless they decided it themselves.
 *
 * @mcp
 */
export const decideChangeNoticeApproval = defineServiceFn({
  input: approvalDecisionValidator.extend({ changeNoticeId: z.string() }),
  permission: { update: "parts" },

  async run(ctx, { changeNoticeId, approvalRequestId, decision, notes }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const owned = await refuseUnlessOwned(ctx, "changeOrder", {
      id: changeNoticeId
    });
    if (owned) return owned;

    const result = await decideApprovalRequest(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        documentType: "changeOrder",
        documentId: changeNoticeId,
        companyId,
        userId,
        approvalRequestId,
        decision,
        notes
      }
    );
    if (result.error) {
      return ctx.error(
        result.error.code === "not-found"
          ? "notFound"
          : result.error.code === "forbidden"
            ? "forbidden"
            : "internal",
        result.error.message,
        result.error
      );
    }

    if (result.requestedBy !== userId) {
      await trigger("notify", {
        event:
          decision === "Approved"
            ? NotificationEvent.ApprovalApproved
            : NotificationEvent.ApprovalRejected,
        companyId,
        documentId: changeNoticeId,
        documentType: "changeOrder",
        recipient: { type: "user", userId: result.requestedBy },
        from: userId
      }).catch((e) =>
        logger.error("Failed to notify the approval requester", {
          companyId,
          changeNoticeId,
          error: e
        })
      );
    }

    if (decision === "Approved") {
      await notifyChangeNoticeTransition({
        client: ctx.asCaller.supabase,
        event: changeNoticeStageEvent.Implementation,
        changeNoticeId,
        companyId,
        userId
      });
    }
    return { changeNoticeId, decision };
  }
});
