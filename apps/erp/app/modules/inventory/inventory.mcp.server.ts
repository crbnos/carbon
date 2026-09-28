import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { commandError } from "~/services/mcp-command-error";
import {
  requireToolCompanyRecord,
  requireToolPermission
} from "~/services/mcp-guards.server";
import {
  transitionInventoryCountStatus,
  transitionPickingListStatus,
  transitionStockTransferStatus
} from "./inventory-transitions.server";

// Inventory status transitions published under the tool names of the bare
// status writers they replace (a same-named export here SHADOWS the
// `inventory.service.ts` one; the registry spreads this module last). Each
// wrapper re-applies the route's request gates, adapts the payload and turns
// the command's result into `{ data, error }`; the transition itself lives in
// `inventory-transitions.server.ts`, shared with the routes.
//
// `client` MUST stay named `client` and first — the dispatcher injects it by
// name. Server-only: never re-export from the module barrel.

function describeViolations(blocked: {
  violations: { ruleId: string; message?: string | null }[];
  ruleNames: Record<string, string>;
}): string {
  return blocked.violations
    .map((v) => {
      const name = blocked.ruleNames[v.ruleId] ?? v.ruleId;
      return v.message ? `${name} (${v.message})` : name;
    })
    .join("; ");
}

/**
 * Change a stock transfer's status as its status buttons do: Released and Completed check storage rules first; reopening a Completed transfer needs inventory delete.
 *
 * A storage-rule warning is reported as an error until the call is repeated
 * with `acknowledged: true`; an error-severity rule refuses regardless.
 * Completed stamps the completion time and clears the assignee. Stock moves
 * when lines are picked, not on this status change. `id` is the transfer's
 * uuid.
 */
export async function updateStockTransferStatus(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    id: string;
    status: Database["public"]["Enums"]["stockTransferStatus"];
    acknowledged?: boolean;
  }
) {
  await requireToolPermission(
    userId,
    companyId,
    "inventory",
    "update",
    "change stock transfer status"
  );
  await requireToolCompanyRecord(
    "stockTransfer",
    companyId,
    { id: args.id },
    "Stock transfer"
  );
  const result = await transitionStockTransferStatus(client, {
    id: args.id,
    companyId,
    userId,
    status: args.status,
    acknowledged: args.acknowledged,
    requireReopenPermission: () =>
      requireToolPermission(
        userId,
        companyId,
        "inventory",
        "delete",
        "reopen a completed stock transfer"
      )
  });
  if ("blocked" in result) {
    return {
      data: null,
      error: {
        message: `Blocked by storage rules: ${describeViolations(result.blocked)}. Warnings can be accepted by repeating the call with acknowledged: true; an error-severity rule refuses regardless.`
      }
    };
  }
  if (result.error) {
    return {
      data: null,
      error: commandError(result.error.message, result.cause)
    };
  }
  return { data: result.data, error: null };
}

/**
 * Confirm (Draft to Pending) or reopen (Pending to Draft) an inventory count, as its Confirm and Reopen buttons do; Posted is refused.
 *
 * Posting books one ledger adjustment per counted variance and is done from
 * the count page, not by a status change. `id` is the count's uuid.
 */
export async function updateInventoryCountStatus(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    id: string;
    /** Pending confirms a Draft count; Draft reopens a Pending one. */
    status: "Pending" | "Draft";
  }
) {
  await requireToolPermission(
    userId,
    companyId,
    "inventory",
    "update",
    "change inventory count status"
  );
  // Callers outside TypeScript (MCP, HTTP) can still send Posted.
  if (args.status !== "Pending" && args.status !== "Draft") {
    throw new Error(
      "Posted is reached only by posting the count, which books its variances; set Pending to confirm a count or Draft to reopen it."
    );
  }
  const result = await transitionInventoryCountStatus(client, {
    id: args.id,
    companyId,
    userId,
    status: args.status
  });
  if (result.error) {
    return {
      data: null,
      error: commandError(result.error.message, result.cause)
    };
  }
  return { data: result.data, error: null };
}

/**
 * Change a picking list's status as its status buttons do: finishing applies the company's incomplete-list policy and lands on Partial when anything is short.
 *
 * With lines still unpicked, an `error` policy refuses and a `warn` policy
 * reports an error until the call is repeated with `acknowledged: true`.
 * Reopening a Completed, Partial or Cancelled list needs inventory delete.
 * Returns the status actually written. `pickingListId` is the list's uuid.
 */
export async function updatePickingListStatus(
  client: SupabaseClient<Database>,
  pickingListId: string,
  status: Database["public"]["Enums"]["pickingListStatus"],
  companyId: string,
  userId: string,
  acknowledged?: boolean
) {
  await requireToolPermission(
    userId,
    companyId,
    "inventory",
    "update",
    "change picking list status"
  );
  await requireToolCompanyRecord(
    "pickingList",
    companyId,
    { id: pickingListId },
    "Picking list"
  );
  const result = await transitionPickingListStatus(client, {
    id: pickingListId,
    companyId,
    userId,
    status,
    acknowledged,
    requireReopenPermission: () =>
      requireToolPermission(
        userId,
        companyId,
        "inventory",
        "delete",
        "reopen a closed picking list"
      )
  });
  if ("needsAcknowledgement" in result) {
    return {
      data: null,
      error: {
        message: `Still unpicked: ${result.unresolvedLines
          .map((l) => l.itemName)
          .join(
            ", "
          )}. Repeat the call with acknowledged: true to finish anyway; the list will be Partial.`
      }
    };
  }
  if (result.error) {
    return {
      data: null,
      error: commandError(result.error.message, result.cause)
    };
  }
  return { data: result.data, error: null };
}
