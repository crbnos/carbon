import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { evaluateLinesForSurface, isBlocked } from "@carbon/ee/rules.server";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanySettings } from "~/modules/settings/settings.service";
import {
  type CommandResult,
  commandFailed,
  commandOk
} from "~/services/command-result";
import { isPickingListLocked } from "./inventory.models";
import {
  getInventoryCount,
  getUnresolvedPickingListLines,
  updateInventoryCountStatus,
  updatePickingListStatus,
  updateStockTransferStatus
} from "./inventory.service";

// Server-only inventory status transitions. Each is ONE UI action, called by
// its route and published by `inventory.mcp.server.ts` under the tool name of
// the bare status writer it replaces, so MCP, the in-app agent and workflows
// run what the UI runs. Request concerns (auth, form parsing, flash, redirect)
// stay in the route.
//
// Reopening a closed document needs a stronger permission than the
// transition's own. The route and the wrapper check it differently (a
// redirect vs a thrown error), so the command takes it as
// `requireReopenPermission` and calls it only when the transition reopens.

type Enums = Database["public"]["Enums"];

type RuleViolations = Awaited<ReturnType<typeof evaluateLinesForSurface>>;

/** Storage rules refused the transition; the route shows them in its dialog. */
export type BlockedByRules = {
  blocked: {
    violations: RuleViolations["violations"];
    ruleNames: RuleViolations["ruleNames"];
  };
};

/**
 * Move a stock transfer to a new status as its status buttons do
 * (`x+/stock-transfer+/$id.status.tsx`):
 * - leaving Completed calls `requireReopenPermission` (inventory delete);
 * - Released and Completed evaluate the storage rules against each line's
 *   destination; a blocking violation returns `blocked` unless
 *   `acknowledged` covers it (warnings only);
 * - Completed stamps `completedAt` and clears the assignee.
 *
 * Stock moves when lines are picked (`post-stock-transfer`), not here.
 */
export async function transitionStockTransferStatus(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    userId: string;
    status: Enums["stockTransferStatus"];
    acknowledged?: boolean;
    requireReopenPermission: () => Promise<void>;
  }
): Promise<CommandResult<{ id: string }> | (BlockedByRules & { error: null })> {
  const { id, companyId, userId, status } = args;

  if (status !== "Completed") {
    const current = await client
      .from("stockTransfer")
      .select("status")
      .eq("id", id)
      .eq("companyId", companyId)
      .single();
    if (current.data?.status === "Completed") {
      await args.requireReopenPermission();
    }
  }

  // Released is the user's commitment to the transfer plan; Completed is a
  // defense-in-depth gate. Draft is editing; In Progress is set by picking.
  if (status === "Released" || status === "Completed") {
    const serviceRole = getCarbonServiceRole();
    const { data: lines } = await serviceRole
      .from("stockTransferLine")
      .select("id, itemId, fromStorageUnitId, toStorageUnitId, quantity")
      .eq("stockTransferId", id)
      .eq("companyId", companyId);

    const { violations, ruleNames } = await evaluateLinesForSurface({
      client: serviceRole,
      companyId,
      userId,
      targetType: "item",
      surface: "stockTransfer",
      // Evaluated against the destination side, where stock lands.
      lines: (lines ?? []).map((l) => ({
        lineId: l.id as string,
        itemId: l.itemId as string | null,
        storageUnitId: l.toStorageUnitId as string | null,
        quantity: Number(l.quantity ?? 0),
        locationId: null
      }))
    });
    if (
      violations.length > 0 &&
      isBlocked(violations, args.acknowledged === true)
    ) {
      return { error: null, blocked: { violations, ruleNames } };
    }
  }

  const completed = status === "Completed";
  const update = await updateStockTransferStatus(client, {
    id,
    status,
    assignee: completed ? null : undefined,
    completedAt: completed ? new Date().toISOString() : null,
    updatedBy: userId
  });
  if (update.error) {
    return commandFailed(
      "Failed to update stock transfer status",
      update.error
    );
  }
  return commandOk({ id });
}

/**
 * Confirm (Draft -> Pending) or reopen (Pending -> Draft) an inventory count,
 * as its Confirm and Reopen buttons do (`x+/inventory-count+/$id.confirm.tsx`,
 * `$id.reopen.tsx`). The write only applies while the count is still in the
 * expected status. Posted is reached only by posting the count, which books
 * the variances; it is not a transition here.
 */
export async function transitionInventoryCountStatus(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    userId: string;
    status: "Pending" | "Draft";
  }
): Promise<CommandResult<{ id: string }>> {
  const { id, companyId, userId, status } = args;
  const confirming = status === "Pending";
  const expectedStatus = confirming ? "Draft" : "Pending";

  const header = await getInventoryCount(client, id, companyId);
  if (header.error || !header.data) {
    return commandFailed("Inventory count not found", header.error);
  }
  if (header.data.status !== expectedStatus) {
    return commandFailed(
      confirming
        ? "Only a draft count can be confirmed"
        : "Only a pending count can be reopened"
    );
  }

  const update = await updateInventoryCountStatus(client, {
    id,
    companyId,
    status,
    expectedStatus,
    updatedBy: userId
  });
  if (update.error) {
    return commandFailed(
      confirming ? "Failed to confirm count" : "Failed to reopen count",
      update.error
    );
  }
  return commandOk({ id });
}

type UnresolvedLines = Awaited<
  ReturnType<typeof getUnresolvedPickingListLines>
>["unresolved"];

/**
 * Move a picking list to a new status as its status buttons do
 * (`x+/picking-list+/$pickingListId.status.tsx`):
 * - reopening a Completed/Partial/Cancelled list calls
 *   `requireReopenPermission` (inventory delete);
 * - Completed applies the company's incomplete-picking-list policy: with
 *   lines still unpicked, `error` refuses and `warn` returns
 *   `needsAcknowledgement` until `acknowledged`; any shortfall lands the list
 *   on Partial instead of Completed.
 *
 * Returns the status actually written.
 */
export async function transitionPickingListStatus(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    userId: string;
    status: Enums["pickingListStatus"];
    acknowledged?: boolean;
    requireReopenPermission: () => Promise<void>;
  }
): Promise<
  | CommandResult<{ id: string; status: Enums["pickingListStatus"] }>
  | {
      error: null;
      needsAcknowledgement: true;
      unresolvedLines: UnresolvedLines;
    }
> {
  const { id, companyId, userId } = args;
  let status = args.status;

  const current = await client
    .from("pickingList")
    .select("status")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  if (
    isPickingListLocked(current.data?.status) &&
    !isPickingListLocked(status)
  ) {
    await args.requireReopenPermission();
  }

  if (status === "Completed") {
    const [lineResult, settings] = await Promise.all([
      getUnresolvedPickingListLines(client, id, companyId),
      getCompanySettings(client, companyId)
    ]);
    if (lineResult.error) {
      return commandFailed(
        "Failed to check picking list lines",
        lineResult.error
      );
    }
    // Fail closed: an unreadable policy must not fall back to 'warn'.
    if (settings.error || !settings.data) {
      return commandFailed(
        "Failed to read the picking list completion policy",
        settings.error
      );
    }

    const policy =
      settings.data.incompletePickingListPolicy === "error" ? "error" : "warn";
    const { unresolved, hasShort } = lineResult;
    if (unresolved.length > 0) {
      if (policy === "error") {
        return commandFailed(
          `Can't finish — still unpicked: ${unresolved.map((l) => l.itemName).join(", ")}`
        );
      }
      if (args.acknowledged !== true) {
        return {
          error: null,
          needsAcknowledgement: true,
          unresolvedLines: unresolved
        };
      }
    }
    status = unresolved.length === 0 && !hasShort ? "Completed" : "Partial";
  }

  const update = await updatePickingListStatus(client, id, status, userId);
  if (update.error) {
    return commandFailed("Failed to update picking list status", update.error);
  }

  if (status === "Completed" || status === "Partial") {
    // Keyed on the status too: a list goes Partial and later Completed, and
    // both are real occurrences.
    trackWorkEvent(
      "picking_list_completed",
      {
        companyId,
        userId,
        pickingListId: id,
        finalStatus: status,
        source: "erp"
      },
      { discriminator: status }
    );
  }
  return commandOk({ id, status });
}
