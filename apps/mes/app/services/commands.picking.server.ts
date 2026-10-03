// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanySettings } from "~/services/inventory.service";
import { isPickingListLocked, pickingListStatus } from "~/services/models";
import type { UnresolvedPickingListLine } from "~/services/picking.service";
import {
  getUnresolvedPickingListLines,
  setPickingListLineQuantity,
  setPickingListLineTrackedEntity,
  updatePickingListStatus
} from "~/services/picking.service";
import type { CommandFailure, CommandResult } from "./api-result.server";
import { failed, ok } from "./api-result.server";

/**
 * The three picking commands, lifted out of
 * `x+/picking.$pickingListId.line.quantity.tsx`,
 * `x+/picking.$pickingListId.tracked.$lineId.tsx` and
 * `x+/picking.$pickingListId.status.tsx`.
 *
 * The bodies are unchanged. What the routes used to read from the request —
 * `companyId`, the EFFECTIVE user (`userContext.effectiveUserId ?? userId`, the
 * pinned operator on a shared terminal) and the form fields — arrives as
 * arguments, because `userContext` is null under `api+/`.
 *
 * `setPickingListStatus` keeps the `incompletePickingListPolicy` enforcement
 * SERVER-side, including the fail-closed branch when the policy cannot be read:
 * an `acknowledged: true` body must never be able to talk its way past an
 * `error` policy, and that is only true while the decision lives here.
 */

// Scope names kept as they were in the route files so existing log queries for
// these two messages keep matching.
const trackedLog = getLogger("mes", "picking-tracked-line");
const statusLog = getLogger("mes", "picking-status");

type PickingListStatus = (typeof pickingListStatus)[number];

export type PickingCommandContext = {
  companyId: string;
  /** The pinned operator on a shared terminal, else the signed-in user. */
  userId: string;
};

/** `details` on a `blocked` / `needs_acknowledgement` picking failure. */
export type UnresolvedLinesDetails = {
  unresolvedLines: UnresolvedPickingListLine[];
};

/** Narrows the `details` the two 409 picking outcomes carry. */
export function unresolvedLinesFrom(
  failure: CommandFailure
): UnresolvedPickingListLine[] {
  return (
    (failure.details as UnresolvedLinesDetails | undefined)?.unresolvedLines ??
    []
  );
}

// The web routes rendered a service error as `string | { message }` with a
// per-route fallback; keep both the branch and the fallback text.
function serviceErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string") return error;
  return (error as { message?: string } | null)?.message ?? fallback;
}

export type PickQuantityArgs = {
  pickingListLineId: string | null | undefined;
  quantity: number;
  markShort: boolean;
};

export async function pickQuantity(
  client: SupabaseClient<Database>,
  ctx: PickingCommandContext,
  args: PickQuantityArgs
): Promise<CommandResult<{ id: string } | null>> {
  if (!args.pickingListLineId) {
    return failed({ kind: "validation", message: "Missing pickingListLineId" });
  }

  const result = await setPickingListLineQuantity(client, {
    pickingListLineId: args.pickingListLineId,
    quantity: args.quantity,
    markShort: args.markShort,
    userId: ctx.userId,
    companyId: ctx.companyId
  });

  if (result.error) {
    // `conflict`, not `error`: every refusal this service returns is a state the
    // operator can read and act on (the list is closed, the line is tracked, no
    // lineside destination, `post-picking` said no). A 500 would tell the app to
    // retry a write instead of showing the reason.
    return failed({
      kind: "conflict",
      message: serviceErrorMessage(result.error, "Failed to update pick line")
    });
  }

  return ok(result.data);
}

export type PickTrackedArgs = {
  pickingListLineId: string | null | undefined;
  trackedEntityId: string | null | undefined;
  fromStorageUnitId: string | null;
  quantity: number;
  unpick: boolean;
};

export async function pickTrackedEntity(
  client: SupabaseClient<Database>,
  ctx: PickingCommandContext,
  args: PickTrackedArgs
): Promise<CommandResult<{ id: string } | null>> {
  if (!args.pickingListLineId) {
    return failed({ kind: "validation", message: "Missing line" });
  }
  if (!args.trackedEntityId) {
    return failed({ kind: "validation", message: "Missing tracked entity" });
  }

  const result = await setPickingListLineTrackedEntity(client, {
    pickingListLineId: args.pickingListLineId,
    trackedEntityId: args.trackedEntityId,
    fromStorageUnitId: args.fromStorageUnitId,
    quantity: args.quantity,
    unpick: args.unpick,
    userId: ctx.userId,
    companyId: ctx.companyId
  });

  if (result.error) {
    trackedLog.error("Failed to pick tracked entity", {
      companyId: ctx.companyId,
      lineId: args.pickingListLineId,
      trackedEntityId: args.trackedEntityId,
      error: result.error
    });
    return failed({
      kind: "conflict",
      message: serviceErrorMessage(result.error, "Failed to pick line")
    });
  }

  return ok(result.data);
}

export type SetPickingListStatusArgs = {
  pickingListId: string | null | undefined;
  status: string;
  /** The operator confirmed the shortfall the server raised the first time. */
  acknowledged: boolean;
};

export async function setPickingListStatus(
  client: SupabaseClient<Database>,
  ctx: PickingCommandContext,
  args: SetPickingListStatusArgs
): Promise<CommandResult<{ status: PickingListStatus }>> {
  const { companyId, userId } = ctx;
  const { pickingListId, status } = args;

  if (!pickingListId) {
    return failed({ kind: "validation", message: "Missing pickingListId" });
  }
  if (!pickingListStatus.includes(status as PickingListStatus)) {
    return failed({ kind: "validation", message: "Invalid status" });
  }

  // Reopening a closed picking list is ERP-only — MES may not unlock one.
  const current = await client
    .from("pickingList")
    .select("status")
    .eq("id", pickingListId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (current.error || !current.data) {
    statusLog.warn("Picking list not found for company", {
      companyId,
      pickingListId,
      error: current.error
    });
    return failed({ kind: "not_found", message: "Picking list not found" });
  }
  if (
    isPickingListLocked(current.data?.status) &&
    !isPickingListLocked(status)
  ) {
    return failed({
      kind: "conflict",
      message: "Reopen this picking list from the ERP."
    });
  }

  // Finishing a list must not silently complete with material still unpicked.
  // Enforce the company policy server-side and pick the terminal status:
  // fully picked → Completed, any shortfall → Partial.
  if (status === "Completed") {
    const [lineResult, settings] = await Promise.all([
      getUnresolvedPickingListLines(client, pickingListId, companyId),
      getCompanySettings(client, companyId)
    ]);

    if (lineResult.error) {
      return failed({
        kind: "error",
        message: "Failed to check picking list lines"
      });
    }

    // Fail closed: if the policy can't be read, don't silently fall back to
    // 'warn' (which an `acknowledged=true` submit could bypass). Refuse the
    // finish instead.
    if (settings.error || !settings.data) {
      return failed({
        kind: "error",
        message: "Failed to read the picking list completion policy"
      });
    }

    const policy =
      settings.data.incompletePickingListPolicy === "error" ? "error" : "warn";
    const { unresolved, hasShort } = lineResult;

    if (unresolved.length > 0) {
      if (policy === "error") {
        return failed({
          kind: "blocked",
          message: "Some material is still unpicked.",
          details: {
            unresolvedLines: unresolved
          } satisfies UnresolvedLinesDetails
        });
      }
      if (!args.acknowledged) {
        // The web body for this outcome carries no message (the dialog names
        // the lines); the API needs one, so it reuses the blocked text.
        return failed({
          kind: "needs_acknowledgement",
          message: "Some material is still unpicked.",
          details: {
            unresolvedLines: unresolved
          } satisfies UnresolvedLinesDetails
        });
      }
    }

    const finalStatus: PickingListStatus =
      unresolved.length === 0 && !hasShort ? "Completed" : "Partial";

    const finishResult = await updatePickingListStatus(
      client,
      pickingListId,
      finalStatus,
      userId,
      companyId
    );

    if (finishResult.error) {
      return failed({
        kind: "error",
        message: "Failed to update picking list status"
      });
    }

    // Discriminated on the status for the same reason as the ERP route: a list
    // that goes Partial and later Completed must produce two events.
    trackWorkEvent(
      "picking_list_completed",
      {
        companyId,
        userId,
        pickingListId,
        finalStatus: finalStatus,
        source: "mes"
      },
      { discriminator: finalStatus }
    );

    return ok({ status: finalStatus });
  }

  const result = await updatePickingListStatus(
    client,
    pickingListId,
    status as PickingListStatus,
    userId,
    companyId
  );

  if (result.error) {
    return failed({
      kind: "error",
      message: "Failed to update picking list status"
    });
  }

  return ok({ status: status as PickingListStatus });
}
