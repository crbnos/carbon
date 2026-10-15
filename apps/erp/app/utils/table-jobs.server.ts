// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getClaims, makePermissionsFromClaims } from "@carbon/auth";
import {
  getCarbonServiceRole,
  getUserScopedClient
} from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import { companyHasFeature } from "@carbon/ee/plan.server";
import { trigger } from "@carbon/jobs";
import {
  MAX_BULK_PROBLEMS,
  releaseTableJobLock,
  type TableBulkAction,
  type TableBulkActionCarry,
  type TableBulkActionResult,
  type TableJobContext,
  type TableJobHandlers,
  takeTableJobLock
} from "@carbon/jobs/inngest";
import { getLogger } from "@carbon/logger";
import { nanoid } from "nanoid";
import { isItemBulkUpdateField } from "~/modules/items";
import { bulkUpdateItems } from "~/modules/items/bulk-actions.server";
import {
  bulkDeleteJobs,
  bulkDissolveBatches,
  bulkReleaseBatches,
  bulkReleaseJobs
} from "~/modules/production/bulk-actions.server";
import { bulkDeletePurchaseOrders } from "~/modules/purchasing/purchasing.server";
import { userPermissionsValidator } from "~/modules/users";
import {
  queueInviteResends,
  queuePermissionUpdates,
  queueUserDeactivations,
  selectUsersForBulkAction
} from "~/modules/users/users.server";
import { getDatabaseClient } from "~/services/database.server";
import { decodeCursor } from "./cursor";
import { fetchListPage, getListDefinition } from "./list-registry/index.server";
import {
  type AllMatchingRequest,
  type BulkActionStart,
  bulkActionServesList,
  getBulkActionMeta,
  hasListPermission,
  parseAllMatching,
  refreshingClientFactory,
  rowLimitRefusal,
  type TableBulkActionKey,
  type TableJobClaims,
  tableJobBusyMessage,
  tableJobBusyRefusal
} from "./table-jobs";

const logger = getLogger("erp", "table-jobs");

/**
 * Every table job reads as the requesting user (`getUserScopedClient`), so RLS
 * applies as it does to a loader that keeps the RLS client. A loader that
 * bypasses RLS checks the same permission first (`hasListPermission`), so the
 * user client returns the same rows unless a policy is stricter than the
 * permission. A service-role read would rely on every list query to filter by
 * `companyId` itself, and the queries of the RLS-client lists were never
 * written or reviewed for that.
 */
async function canReadList(
  listKey: string,
  context: TableJobContext
): Promise<boolean> {
  const definition = getListDefinition(listKey);
  if (!definition) return false;

  const claims = await readClaims(context);
  if (!claims) return false;
  return hasListPermission(claims, definition.permission, context.companyId);
}

/** The user's claims for the company, read fresh as the user (not through
 *  the permission cache, which can hold a revoked permission for an hour).
 *  Null when the user has none. Throws when the read fails, so a job step
 *  retries or fails instead of telling the user they lost access. */
async function readClaims({
  companyId,
  userId
}: TableJobContext): Promise<TableJobClaims | null> {
  const client = await getUserScopedClient(userId);
  const claims = await getClaims(client, userId, companyId);
  if (claims.error) {
    logger.error("Failed to read the claims of a table job's user", {
      companyId,
      userId,
      error: claims.error
    });
    throw new Error("Failed to read the claims of a table job's user");
  }
  if (claims.data === null) return null;
  return makePermissionsFromClaims(claims.data as Json[]) ?? null;
}

async function fetchPage(
  listKey: string,
  { companyId, userId }: TableJobContext,
  search: string,
  page: { cursor: string | null; limit: number; forExport?: boolean }
) {
  const definition = getListDefinition(listKey);
  if (!definition) {
    return { rows: [], nextCursor: null, error: `Unknown list "${listKey}"` };
  }
  const params = new URLSearchParams(search);
  // The job pages with its own cursor; a cursor in the saved search is stale.
  params.delete("after");

  // One token per page: it lives five minutes, and a page is one query.
  const client = await getUserScopedClient(userId);
  const result = await fetchListPage(definition, client, companyId, params, {
    limit: page.limit,
    cursor: decodeCursor(page.cursor)
  });
  if (result.error || !page.forExport || !definition.exportRows) {
    return {
      rows: result.rows,
      nextCursor: result.nextCursor,
      error: result.error ?? undefined
    };
  }
  // The values the list's loader adds per page, so the export's columns
  // match the table's. A failed lookup fails the page, not a blank column.
  try {
    return {
      rows: await definition.exportRows(result.rows, { client, companyId }),
      nextCursor: result.nextCursor
    };
  } catch (error) {
    logger.error("Failed to add the export values of a list page", {
      companyId,
      listKey,
      error
    });
    return { rows: [], nextCursor: null, error };
  }
}

type BulkActionRunContext = TableJobContext & {
  /** The user's client, signed again when its token is four minutes old:
   *  RLS applies as it does to the action route. */
  getClient: ReturnType<typeof userClientFactory>;
  db: ReturnType<typeof getDatabaseClient>;
};

/** What a bulk action does to one chunk of ids (at most 100); throws only
 *  when nothing ran. Its metadata is `BULK_ACTIONS` in `./table-jobs`.
 *  `carry` is what the previous chunk of the same run returned. */
type BulkActionRun = (
  ids: string[],
  params: Record<string, unknown>,
  context: BulkActionRunContext,
  carry?: TableBulkActionCarry
) => Promise<TableBulkActionResult>;

/** The supplier → PO map a Jobs Release chunk carries to the next one. */
function carriedPurchaseOrders(
  carry: TableBulkActionCarry | undefined
): Record<string, string> {
  const value = carry?.purchaseOrdersBySupplierId;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

type RowProblem = { readableId: string; message: string };

/** The notification's line per failed row, then per row done with a warning. */
function problemLines(
  failed: RowProblem[],
  warnings: RowProblem[] = []
): Pick<TableBulkActionResult, "problems" | "problemCount"> {
  const lines = [
    ...failed.map((p) => `${p.readableId}: ${p.message}`),
    ...warnings.map((p) => `${p.readableId} (done): ${p.message}`)
  ];
  if (lines.length === 0) return {};
  return {
    problems: lines.slice(0, MAX_BULK_PROBLEMS),
    problemCount: lines.length
  };
}

function userClientFactory(userId: string) {
  return refreshingClientFactory(() => getUserScopedClient(userId));
}

/**
 * Each bulk action with a background path runs the same server function as
 * its action route, so the per-row checks are the same on both paths.
 */
const BULK_ACTION_RUNS: Record<TableBulkActionKey, BulkActionRun> = {
  "items.update": async (ids, { field, value }, context) => {
    if (!isItemBulkUpdateField(field) || typeof value !== "string") {
      throw new Error("The item update is not valid");
    }
    const result = await bulkUpdateItems(
      await context.getClient(),
      context.db,
      {
        itemIds: ids,
        field,
        value,
        companyId: context.companyId,
        userId: context.userId
      }
    );
    return {
      done: result.done,
      skipped: result.skipped,
      failed: result.failed
    };
  },
  "jobs.release": async (ids, _params, context, carry) => {
    const result = await bulkReleaseJobs({
      client: context.getClient,
      db: context.db,
      jobIds: ids,
      companyId: context.companyId,
      userId: context.userId,
      // A PO an earlier chunk created is this run's own, not a Draft to
      // choose from: the jobs after it go on the same PO.
      purchaseOrdersBySupplierId: carriedPurchaseOrders(carry)
    });
    if (!result.success) throw new Error(result.message);
    return {
      done: result.released,
      skipped: result.skipped,
      failed: result.failed.length,
      // Released jobs with something left to fix (a PO that failed) are named
      // too: the in-request release shows them, and so must the notification.
      ...problemLines(result.failed, result.warnings),
      carry: { purchaseOrdersBySupplierId: result.purchaseOrdersBySupplierId }
    };
  },
  "jobs.delete": async (ids, _params, context) => {
    const result = await bulkDeleteJobs({
      client: await context.getClient(),
      jobIds: ids,
      companyId: context.companyId
    });
    return {
      done: result.deleted,
      skipped: result.skipped,
      failed: result.failed
    };
  },
  "purchase-orders.delete": async (ids, _params, context) => {
    const result = await bulkDeletePurchaseOrders(await context.getClient(), {
      purchaseOrderIds: ids,
      companyId: context.companyId
    });
    return {
      done: result.deleted,
      skipped: result.skipped,
      failed: result.failed
    };
  },
  "batches.release": async (ids, _params, context) => {
    const result = await bulkReleaseBatches({
      client: context.getClient,
      db: context.db,
      batchIds: ids,
      companyId: context.companyId,
      userId: context.userId
    });
    if (!result.success) throw new Error(result.message);
    return {
      done: result.done,
      skipped: result.skipped,
      failed: result.failed.length,
      ...problemLines(result.failed)
    };
  },
  "batches.dissolve": async (ids, _params, context) => {
    const result = await bulkDissolveBatches({
      client: context.getClient,
      db: context.db,
      batchIds: ids,
      companyId: context.companyId,
      userId: context.userId
    });
    if (!result.success) throw new Error(result.message);
    return {
      done: result.done,
      skipped: result.skipped,
      failed: result.failed.length,
      ...problemLines(result.failed)
    };
  },
  "users.deactivate": async (ids, { ip }, { companyId, userId }) => {
    const { allowed, skipped } = await selectUsersForBulkAction({
      action: "deactivate",
      userIds: ids,
      companyId,
      actorId: userId
    });
    if (allowed.length > 0) {
      await queueUserDeactivations({
        userIds: allowed,
        companyId,
        actorId: userId,
        ip: typeof ip === "string" ? ip : undefined
      });
    }
    // Done = queued: the user-admin job deactivates each user.
    return { done: allowed.length, skipped, failed: 0 };
  },
  "users.invite": async (ids, { location, ip }, { companyId, userId }) => {
    const { allowed, skipped } = await selectUsersForBulkAction({
      action: "invite",
      userIds: ids,
      companyId,
      actorId: userId
    });
    if (allowed.length > 0) {
      await queueInviteResends({
        userIds: allowed,
        companyId,
        location: typeof location === "string" ? location : "Unknown",
        ip: typeof ip === "string" ? ip : "127.0.0.1"
      });
    }
    return { done: allowed.length, skipped, failed: 0 };
  },
  "users.permissions": async (
    ids,
    { permissions, addOnly, ip },
    { companyId, userId }
  ) => {
    if (!isModulePermissions(permissions) || typeof addOnly !== "boolean") {
      throw new Error("The permission update is not valid");
    }
    const { allowed, skipped } = await selectUsersForBulkAction({
      action: "permissions",
      userIds: ids,
      companyId,
      actorId: userId
    });
    if (allowed.length > 0) {
      await queuePermissionUpdates({
        userIds: allowed,
        companyId,
        actorId: userId,
        permissions,
        addOnly,
        ip: typeof ip === "string" ? ip : undefined
      });
    }
    return { done: allowed.length, skipped, failed: 0 };
  }
};

/** The `permissions` param of `users.permissions`, checked again in the job:
 *  a module name to its four switches, as the route validated it. */
function isModulePermissions(
  value: unknown
): value is Record<
  string,
  { view: boolean; create: boolean; update: boolean; delete: boolean }
> {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.values(value).every(
      (permission) => userPermissionsValidator.safeParse(permission).success
    )
  );
}

/** Whether the user may still run the action on the list: an employee with
 *  the list's view permission and the action's own permission, in a company
 *  whose plan has the action's feature. */
async function canRunBulkAction(
  listKey: string,
  action: TableBulkAction,
  context: TableJobContext
): Promise<boolean> {
  const bulkAction = getBulkActionMeta(action.key);
  const list = getListDefinition(listKey);
  if (!bulkAction || !list || !bulkActionServesList(action.key, listKey)) {
    return false;
  }
  const claims = await readClaims(context);
  if (!claims) return false;
  if (
    !hasListPermission(claims, list.permission, context.companyId) ||
    !hasListPermission(claims, bulkAction.permission, context.companyId)
  ) {
    return false;
  }
  return bulkAction.feature
    ? companyHasFeature(getCarbonServiceRole(), context.companyId, {
        feature: bulkAction.feature
      })
    : true;
}

async function runBulkAction(
  action: TableBulkAction,
  ids: string[],
  context: TableJobContext,
  carry?: TableBulkActionCarry
): Promise<TableBulkActionResult> {
  const run = getBulkActionMeta(action.key)
    ? BULK_ACTION_RUNS[action.key as TableBulkActionKey]
    : undefined;
  if (!run) throw new Error(`Unknown bulk action "${action.key}"`);
  return run(
    ids,
    action.params,
    {
      ...context,
      getClient: userClientFactory(context.userId),
      db: getDatabaseClient()
    },
    carry
  );
}

/** The ERP side of the table jobs, handed to packages/jobs by api+/inngest.ts. */
export const tableJobHandlers: TableJobHandlers = {
  canReadList,
  fetchListPage: fetchPage,
  listIdColumn: (listKey) => getListDefinition(listKey)?.idColumn ?? "id",
  canRunBulkAction,
  runBulkAction
};

/** The list's matching rows as its header counts them: exact up to 1,000,
 *  the planner's estimate above. Null when the count cannot be read. */
async function countMatchingRows(
  listKey: string,
  { companyId, userId }: TableJobContext,
  search: string
): Promise<number | null> {
  const definition = getListDefinition(listKey);
  if (!definition) return null;
  const params = new URLSearchParams(search);
  params.delete("after");
  const result = await fetchListPage(
    definition,
    await getUserScopedClient(userId),
    companyId,
    params,
    { limit: 1, cursor: null }
  );
  if (result.error) {
    logger.error("Failed to count the rows of a bulk action", {
      companyId,
      listKey,
      error: result.error
    });
    return null;
  }
  return result.count;
}

/**
 * Starts the background bulk action on every row of the list that matches its
 * URL search: the action routes call it when the request holds `allMatching`
 * in place of ids. The route has already checked the action's permission; this
 * checks the list's too, the action's row limit, takes the company's bulk lock
 * and sends the event.
 */
export function startTableBulkAction({
  allMatching,
  ...args
}: BulkRunArgs & {
  allMatching: AllMatchingRequest;
}): Promise<BulkActionStart> {
  return startBulkRun({
    ...args,
    listKey: allMatching.listKey,
    search: allMatching.search
  });
}

/**
 * Starts the background bulk action on rows the user selected, when there are
 * too many for one request (`fitsOneRequest`). The job acts on these ids and
 * reads no list pages; the per-row checks are the same as on the route.
 */
export function startSelectedBulkAction({
  listKey,
  ids,
  ...args
}: BulkRunArgs & { listKey: string; ids: string[] }): Promise<BulkActionStart> {
  return startBulkRun({ ...args, listKey, search: "", ids });
}

type BulkRunArgs = {
  companyId: string;
  userId: string;
  actionKey: TableBulkActionKey;
  params: Record<string, unknown>;
};

async function startBulkRun({
  companyId,
  userId,
  actionKey,
  params,
  listKey,
  search,
  ids
}: BulkRunArgs & {
  listKey: string;
  search: string;
  ids?: string[];
}): Promise<BulkActionStart> {
  const bulkAction = getBulkActionMeta(actionKey);
  if (
    !bulkAction ||
    !bulkActionServesList(actionKey, listKey) ||
    !getListDefinition(listKey)
  ) {
    logger.error("A bulk action was requested for a list it does not serve", {
      companyId,
      actionKey,
      listKey
    });
    return {
      success: false,
      message: "This action cannot run on this list",
      refusal: { code: "not-supported" }
    };
  }

  const context = { companyId, userId };
  let allowed: boolean;
  try {
    allowed = await canRunBulkAction(
      listKey,
      { key: actionKey, params },
      context
    );
  } catch {
    // `readClaims` logged it.
    return {
      success: false,
      message: "The bulk action could not start",
      refusal: { code: "not-started" }
    };
  }
  if (!allowed) {
    return {
      success: false,
      message: "You do not have permission to do this on every matching row",
      refusal: { code: "no-permission" }
    };
  }

  if (bulkAction.maxRows !== undefined) {
    const matching = ids
      ? ids.length
      : await countMatchingRows(listKey, context, search);
    if (matching === null) {
      return {
        success: false,
        message: "The bulk action could not start",
        refusal: { code: "not-started" }
      };
    }
    const refusal = rowLimitRefusal(bulkAction, matching);
    if (refusal) {
      return {
        success: false,
        message: refusal,
        refusal: { code: "row-limit", maxRows: bulkAction.maxRows }
      };
    }
  }

  const bulkActionId = nanoid();
  const lock = await takeTableJobLock("bulk", companyId, bulkActionId);
  if (lock.status === "busy") {
    return {
      success: false,
      message: tableJobBusyMessage("bulk", lock.retryAfterSeconds),
      refusal: tableJobBusyRefusal("bulk", lock.retryAfterSeconds)
    };
  }
  if (lock.status === "unavailable") {
    // Fail-open: Inngest's per-company concurrency still runs one at a time.
    logger.warn("Starting a table bulk action without the Redis lock", {
      companyId,
      actionKey
    });
  }

  try {
    await trigger("table-bulk-action", {
      companyId,
      userId,
      bulkActionId,
      actionKey,
      actionLabel: bulkAction.label,
      params,
      listKey,
      search,
      ...(bulkAction.maxRows !== undefined
        ? { maxRows: bulkAction.maxRows }
        : {}),
      ...(bulkAction.idsPerStep !== undefined
        ? { idsPerStep: bulkAction.idsPerStep }
        : {}),
      ...(ids ? { ids } : {})
    });
  } catch (error) {
    logger.error("Failed to start a table bulk action", {
      companyId,
      actionKey,
      error
    });
    await releaseTableJobLock("bulk", companyId, bulkActionId);
    return {
      success: false,
      message: "The bulk action could not start",
      refusal: { code: "not-started" }
    };
  }
  return { success: true, background: true };
}

/**
 * The `allMatching` branch every bulk action route shares: when the request
 * names every matching row (`allMatching` in a form field or a JSON body), it
 * starts the background job and answers what the route returns. Null when the
 * request names ids instead, so the route goes on with its own path.
 */
export async function startAllMatchingBulkAction(
  allMatching: unknown,
  args: {
    companyId: string;
    userId: string;
    actionKey: TableBulkActionKey;
    params: Record<string, unknown>;
  }
): Promise<BulkActionStart | null> {
  const request = parseAllMatching(allMatching);
  return request
    ? startTableBulkAction({ ...args, allMatching: request })
    : null;
}
