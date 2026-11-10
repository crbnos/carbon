// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readGate } from "@carbon/api/permissions";
import type { CarbonError } from "@carbon/api/service-fn.server";
import { readClaimsFresh } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import {
  getCarbonServiceRole,
  getUserScopedClient
} from "@carbon/auth/client.server";
import type { Gate } from "@carbon/database/access";
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
import { z } from "zod";
import { itemBulkUpdateValidator } from "~/modules/items/items.models";
import { updateItems } from "~/modules/items/items.server";
import {
  deleteJobs,
  dissolveBatches,
  releaseBatches,
  releaseJobs
} from "~/modules/production/production.server";
import { deletePurchaseOrders } from "~/modules/purchasing/purchasing.server";
import { systemContext } from "~/modules/service-context.server";
import { permissionsValidator } from "~/modules/users/users.models";
import {
  bulkUpdatePermissions,
  deactivateUsers,
  resendInvites
} from "~/modules/users/users.server";
import {
  queueInviteResends,
  queuePermissionUpdates,
  queueUserDeactivations,
  selectUsersForBulkAction
} from "~/modules/users/users.service";
import { decodeCursor } from "./cursor";
import {
  exportListRows,
  fetchListPage,
  getListDefinition
} from "./list-registry/index.server";
import {
  consumablesList,
  materialsList,
  partsList,
  servicesList,
  toolsList
} from "./list-registry/items.server";
import {
  jobsList,
  operationBatchesList
} from "./list-registry/production.server";
import { purchaseOrdersList } from "./list-registry/purchasing.server";
import { employeeAccountsList } from "./list-registry/users.server";
import {
  ALL_MATCHING_RELEASE_LIMIT,
  type BulkActionMeta,
  type BulkActionStart,
  bulkActionGate,
  bulkStartFormResponse,
  holdsListGate,
  itemListType,
  itemsBulkUpdateGate,
  parseAllMatching,
  refreshingClientFactory,
  rowLimitRefusal,
  TABLE_JOBS_FULL_MESSAGE,
  type TableJobClaims,
  type TableJobRefusal,
  tableJobBusyMessage,
  tableJobBusyRefusal
} from "./table-jobs";

const logger = getLogger("erp", "table-jobs");

/**
 * Every table job reads as the requesting user (`getUserScopedClient`), so RLS
 * applies as it does to a loader that keeps the RLS client. A loader that
 * bypasses RLS checks the same gate first (`holdsListGate`), so the
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
  return holdsListGate(claims, definition.gate, context.companyId);
}

/** The user's claims for the company, read fresh as the user (not through
 *  the permission cache, which can hold a revoked permission for an hour).
 *  Throws when the read fails, so a job step retries or fails instead of
 *  telling the user they lost access. */
async function readClaims({
  companyId,
  userId
}: TableJobContext): Promise<TableJobClaims> {
  try {
    return await readClaimsFresh(
      await getUserScopedClient(userId),
      userId,
      companyId
    );
  } catch (error) {
    logger.error("Failed to read the claims of a table job's user", {
      companyId,
      userId,
      error
    });
    throw error;
  }
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
  if (result.error || !page.forExport) {
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
      rows: await exportListRows(definition, result.rows, {
        client,
        companyId
      }),
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
  /** The list the run acts on (`LIST_KEY_PARAM`), null when the event has
   *  none (a run started before the key rode along). */
  listKey: string | null;
};

/**
 * The params key the start path writes the run's list key under, so `run`
 * knows it: the job hands `runBulkAction` the action, not the list. Set by
 * `startBulkRun` only, over any value the route sent.
 */
const LIST_KEY_PARAM = "listKey";

/**
 * A bulk action with a background path (spec "Which bulk actions get the
 * background path"): who may run it on which lists, the params its route
 * sends (checked when the job starts and again when it runs), and what it
 * does to one chunk of ids (at most 100). `run` throws only when nothing ran;
 * `carry` is what the previous chunk of the same run returned.
 */
type BulkActionDefinition<TParams> = BulkActionMeta & {
  params: z.ZodType<TParams>;
  run(
    ids: string[],
    params: TParams,
    context: BulkActionRunContext,
    carry?: TableBulkActionCarry
  ): Promise<TableBulkActionResult>;
};

function defineBulkAction<TParams>(definition: BulkActionDefinition<TParams>) {
  return definition;
}

const noParams = z.object({});

/** The supplier → PO map a Jobs or Batches Release chunk carries to the
 *  next one. */
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

/** A Delete chunk's counts. The delete is refused only when it could delete
 *  none of the ids (another status, another company), so a refusal other
 *  than a failure skips the chunk. */
function deleteCounts<T>(
  ids: string[],
  result: { data: T | null; error: CarbonError | null },
  deleted: (data: T) => number
): TableBulkActionResult {
  if (result.error || !result.data) {
    return result.error?.category === "internal"
      ? {
          done: 0,
          skipped: 0,
          failed: ids.length,
          problems: [result.error.message],
          problemCount: 1
        }
      : { done: 0, skipped: ids.length, failed: 0 };
  }
  const done = deleted(result.data);
  return { done, skipped: ids.length - done, failed: 0 };
}

function userClientFactory(userId: string) {
  return refreshingClientFactory(() => getUserScopedClient(userId));
}

/**
 * What a bulk action asks before it starts: the gate of the service function
 * it runs, read as that function reads it (`readGate`). The job runs the
 * function as the system, which skips its check, so this is the check on that
 * path. A function whose gate needs its input has no such gate.
 */
function gateOf(fn: { permission: unknown }): Gate {
  const rule = readGate(fn.permission);
  if (
    typeof rule !== "object" ||
    rule === null ||
    "row" in rule ||
    "by" in rule ||
    "anyOf" in rule
  ) {
    throw new Error("A bulk action's service function has no gate of its own");
  }
  return rule as Gate;
}

const ITEM_LISTS = [
  partsList,
  materialsList,
  toolsList,
  consumablesList,
  servicesList
];

/**
 * Each bulk action runs the same service functions as its action route, so
 * the per-row checks are the same on both paths.
 */
const BULK_ACTIONS = {
  "items.update": defineBulkAction({
    label: "Update items",
    lists: ITEM_LISTS.map((list) => list.key),
    gate: itemsBulkUpdateGate,
    params: itemBulkUpdateValidator,
    run: async (ids, change, context) => {
      const list = context.listKey
        ? getListDefinition(context.listKey)
        : undefined;
      const type = list ? itemListType(list) : null;
      if (!type)
        throw new Error("The items list of the bulk action is unknown");
      // Only the list's own type: the per-row rule the system context skips.
      const client = await context.getClient();
      const items = await client
        .from("item")
        .select("id")
        .in("id", ids)
        .eq("companyId", context.companyId)
        .eq("type", type);
      if (items.error) throw new Error("Failed to read the items");
      const ofType = items.data.map((item) => item.id);
      if (ofType.length === 0) {
        return { done: 0, skipped: ids.length, failed: 0 };
      }
      const result = await updateItems(await jobServiceContext(context), {
        ids: ofType,
        change
      });
      if (result.error) throw new Error(result.error.message);
      return {
        done: result.data.done,
        skipped: result.data.skipped + (ids.length - ofType.length),
        failed: 0
      };
    }
  }),
  "jobs.release": defineBulkAction({
    label: "Release jobs",
    lists: [jobsList.key],
    gate: gateOf(releaseJobs),
    maxRows: ALL_MATCHING_RELEASE_LIMIT,
    // Each job runs the requirements recalculation and MRP.
    idsPerStep: 25,
    params: noParams,
    run: async (ids, _params, context, carry) => {
      const result = await releaseJobs(await jobServiceContext(context), {
        jobIds: ids,
        // A PO an earlier chunk created is this run's own, not a Draft to
        // choose from: the jobs after it go on the same PO.
        carriedPurchaseOrders: carriedPurchaseOrders(carry)
      });
      if (result.error) throw new Error(result.error.message);
      const { released, warnings, failed, skipped } = result.data;
      return {
        done: released.length,
        skipped: skipped.length,
        failed: failed.length,
        // Released jobs with something left to fix (a PO that failed) are
        // named too: the in-request release shows them, and so must the
        // notification.
        ...problemLines(failed, warnings),
        carry: {
          purchaseOrdersBySupplierId: result.data.purchaseOrdersBySupplierId
        }
      };
    }
  }),
  "jobs.delete": defineBulkAction({
    label: "Delete jobs",
    lists: [jobsList.key],
    gate: gateOf(deleteJobs),
    params: noParams,
    run: async (ids, _params, context) =>
      deleteCounts(
        ids,
        await deleteJobs(await jobServiceContext(context), { ids }),
        (data) => data.ids.length
      )
  }),
  "purchase-orders.delete": defineBulkAction({
    label: "Delete purchase orders",
    lists: [purchaseOrdersList.key],
    gate: gateOf(deletePurchaseOrders),
    params: noParams,
    run: async (ids, _params, context) =>
      deleteCounts(
        ids,
        await deletePurchaseOrders(await jobServiceContext(context), {
          purchaseOrderIds: ids
        }),
        (data) => data.purchaseOrderIds.length
      )
  }),
  "batches.release": defineBulkAction({
    label: "Release batches",
    lists: [operationBatchesList.key],
    gate: gateOf(releaseBatches),
    maxRows: ALL_MATCHING_RELEASE_LIMIT,
    // Each batch releases its member jobs, each with its own MRP run.
    idsPerStep: 10,
    params: noParams,
    run: async (ids, _params, context, carry) => {
      const result = await releaseBatches(await jobServiceContext(context), {
        batchIds: ids,
        carriedPurchaseOrders: carriedPurchaseOrders(carry)
      });
      if (result.error) throw new Error(result.error.message);
      const { released, failed, skipped } = result.data;
      return {
        done: released.length,
        skipped: skipped.length,
        failed: failed.length,
        ...problemLines(failed),
        carry: {
          purchaseOrdersBySupplierId: result.data.purchaseOrdersBySupplierId
        }
      };
    }
  }),
  "batches.dissolve": defineBulkAction({
    label: "Dissolve batches",
    lists: [operationBatchesList.key],
    gate: gateOf(dissolveBatches),
    idsPerStep: 100,
    params: noParams,
    run: async (ids, _params, context) => {
      const result = await dissolveBatches(await jobServiceContext(context), {
        batchIds: ids
      });
      if (result.error) throw new Error(result.error.message);
      const { dissolved, failed, skipped } = result.data;
      return {
        done: dissolved,
        skipped,
        failed: failed.length,
        ...problemLines(failed)
      };
    }
  }),
  "users.deactivate": defineBulkAction({
    label: "Deactivate users",
    lists: [employeeAccountsList.key],
    gate: gateOf(deactivateUsers),
    params: z.object({ ip: z.string().optional() }),
    run: async (ids, { ip }, { companyId, userId }) => {
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
          ip
        });
      }
      // Done = queued: the user-admin job deactivates each user.
      return { done: allowed.length, skipped, failed: 0 };
    }
  }),
  "users.invite": defineBulkAction({
    label: "Send invites",
    lists: [employeeAccountsList.key],
    gate: gateOf(resendInvites),
    params: z.object({ location: z.string(), ip: z.string() }),
    run: async (ids, { location, ip }, { companyId, userId }) => {
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
          location,
          ip
        });
      }
      return { done: allowed.length, skipped, failed: 0 };
    }
  }),
  "users.permissions": defineBulkAction({
    label: "Edit permissions",
    lists: [employeeAccountsList.key],
    gate: gateOf(bulkUpdatePermissions),
    // The route requires it with `requireFeature`; the job checks it again,
    // in case the plan changed while the run waited.
    feature: "PERMISSIONS",
    params: z.object({
      grants: permissionsValidator.shape.grants,
      addOnly: z.boolean(),
      ip: z.string().optional()
    }),
    run: async (ids, { grants, addOnly, ip }, { companyId, userId }) => {
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
          grants,
          addOnly,
          ip
        });
      }
      return { done: allowed.length, skipped, failed: 0 };
    }
  })
};

export type TableBulkActionKey = keyof typeof BULK_ACTIONS;

type BulkActionParams<K extends TableBulkActionKey> = z.input<
  (typeof BULK_ACTIONS)[K]["params"]
>;

function getBulkAction(key: string): BulkActionDefinition<unknown> | undefined {
  const actions: Record<string, BulkActionDefinition<unknown>> = BULK_ACTIONS;
  return Object.hasOwn(actions, key) ? actions[key] : undefined;
}

/**
 * The context the production service functions run in for a bulk-action job:
 * the system, on behalf of the requesting user. The job checked the user's
 * permissions before it ran (`canRunBulkAction`); the service role's client
 * never expires mid-run, as a five-minute user token would.
 */
async function jobServiceContext({ companyId, userId }: TableJobContext) {
  const company = await getCarbonServiceRole()
    .from("company")
    .select("companyGroupId")
    .eq("id", companyId)
    .single();
  if (company.error || !company.data?.companyGroupId) {
    logger.error("Failed to read the company of a table job", {
      companyId,
      error: company.error
    });
    throw new Error("Failed to read the company of a table job");
  }
  return systemContext({
    companyId,
    companyGroupId: company.data.companyGroupId,
    onBehalfOf: userId
  });
}

async function canRunBulkAction(
  listKey: string,
  action: TableBulkAction,
  context: TableJobContext
): Promise<boolean> {
  const bulkAction = getBulkAction(action.key);
  const list = getListDefinition(listKey);
  const gate = bulkAction && list ? bulkActionGate(bulkAction, list) : null;
  if (!bulkAction || !list || !gate) {
    return false;
  }
  const claims = await readClaims(context);
  if (
    !holdsListGate(claims, list.gate, context.companyId) ||
    !holdsListGate(claims, gate, context.companyId)
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
  const bulkAction = getBulkAction(action.key);
  if (!bulkAction) throw new Error(`Unknown bulk action "${action.key}"`);
  const params = bulkAction.params.safeParse(action.params);
  if (!params.success) {
    throw new Error(
      `The params of the bulk action "${action.key}" are not valid`
    );
  }
  const listKey = action.params[LIST_KEY_PARAM];
  return bulkAction.run(
    ids,
    params.data,
    {
      ...context,
      getClient: userClientFactory(context.userId),
      listKey:
        typeof listKey === "string" && bulkAction.lists.includes(listKey)
          ? listKey
          : null
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
    // Above 1,000 rows a list reads the planner's estimate; the row limit
    // needs the real count.
    { limit: 1, cursor: null, exactCount: true }
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

/** Why a table job did not start, with the HTTP status the export route
 *  answers it with. */
export type TableJobStartRefusal = {
  status: 409 | 500 | 503;
  message: string;
  refusal: TableJobRefusal;
};

/**
 * The one start path of the table jobs (an export, a bulk action): takes the
 * company's lock for the job's kind, then sends its event. Another job of the
 * kind holding the lock refuses (409), so do all slots taken (503): a queue
 * many companies fill would make every user wait. With Redis down the job
 * starts anyway: Inngest's per-company concurrency still runs one at a time.
 * A failed send gives the lock back (500). Null when the job started.
 */
export async function startTableJob(
  kind: "export" | "bulk",
  {
    companyId,
    jobId,
    log
  }: { companyId: string; jobId: string; log: Record<string, unknown> },
  send: () => Promise<unknown>
): Promise<TableJobStartRefusal | null> {
  const lock = await takeTableJobLock(kind, companyId, jobId);
  if (lock.status === "busy") {
    return {
      status: 409,
      message: tableJobBusyMessage(kind, lock.retryAfterSeconds),
      refusal: tableJobBusyRefusal(kind, lock.retryAfterSeconds)
    };
  }
  if (lock.status === "full") {
    logger.warn("Refused a table job: every table-job slot is taken", {
      kind,
      companyId,
      ...log
    });
    return {
      status: 503,
      message: TABLE_JOBS_FULL_MESSAGE,
      refusal: { code: "full" }
    };
  }
  if (lock.status === "unavailable") {
    logger.warn("Starting a table job without the Redis lock", {
      kind,
      companyId,
      ...log
    });
  }
  try {
    await send();
  } catch (error) {
    logger.error("Failed to start a table job", {
      kind,
      companyId,
      ...log,
      error
    });
    await releaseTableJobLock(kind, companyId, jobId);
    return {
      status: 500,
      message:
        kind === "export"
          ? "The export could not start"
          : "The bulk action could not start",
      refusal: { code: "not-started" }
    };
  }
  return null;
}

/**
 * The background path of a bulk action route. When the request names every
 * matching row (`allMatching`, a form field or a JSON body value), or more
 * selected `ids` than one request may act on (the action's `idsPerStep`, so a
 * request ends before the load balancer's 600 s), it checks the action's own
 * permission, starts the job and answers what the route returns. Null when
 * the route acts on the selection itself.
 */
export async function startBackgroundBulkAction<K extends TableBulkActionKey>(
  request: Request,
  actionKey: K,
  selection: { allMatching?: unknown; ids?: string[] },
  params: BulkActionParams<K>
) {
  const action: BulkActionDefinition<unknown> = BULK_ACTIONS[actionKey];
  const allMatching = parseAllMatching(selection.allMatching);
  const ids = selection.ids ?? [];
  const tooManyIds =
    action.idsPerStep !== undefined && ids.length > action.idsPerStep;
  if (!allMatching && !tooManyIds) return null;

  // Selected rows come from the action's one list; the job reads no list
  // pages for them.
  const run = allMatching ?? { listKey: action.lists[0]!, search: "", ids };
  const list = getListDefinition(run.listKey);
  const gate = list ? bulkActionGate(action, list) : null;
  if (!gate) {
    return bulkStartFormResponse({
      success: false,
      message: "This action cannot run on this list",
      refusal: { code: "not-supported" }
    });
  }
  const { companyId, userId } = await authorize(request, gate);
  return bulkStartFormResponse(
    await startBulkRun({ companyId, userId, actionKey, params, ...run })
  );
}

async function startBulkRun({
  companyId,
  userId,
  actionKey,
  params,
  listKey,
  search,
  ids
}: {
  companyId: string;
  userId: string;
  actionKey: TableBulkActionKey;
  params: unknown;
  listKey: string;
  search: string;
  ids?: string[];
}): Promise<BulkActionStart> {
  const bulkAction: BulkActionDefinition<unknown> = BULK_ACTIONS[actionKey];
  if (!bulkAction.lists.includes(listKey) || !getListDefinition(listKey)) {
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

  const parsedParams = bulkAction.params.safeParse(params);
  if (!parsedParams.success) {
    logger.error("A bulk action was requested with invalid params", {
      companyId,
      actionKey
    });
    return {
      success: false,
      message: "The bulk action is not valid",
      refusal: { code: "not-started" }
    };
  }

  const context = { companyId, userId };
  let allowed: boolean;
  try {
    allowed = await canRunBulkAction(
      listKey,
      {
        key: actionKey,
        params: parsedParams.data as TableBulkAction["params"]
      },
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
  const refused = await startTableJob(
    "bulk",
    { companyId, jobId: bulkActionId, log: { actionKey } },
    () =>
      trigger("table-bulk-action", {
        companyId,
        userId,
        bulkActionId,
        actionKey,
        actionLabel: bulkAction.label,
        params: {
          ...(parsedParams.data as TableBulkAction["params"]),
          [LIST_KEY_PARAM]: listKey
        },
        listKey,
        search,
        ...(bulkAction.maxRows !== undefined
          ? { maxRows: bulkAction.maxRows }
          : {}),
        ...(bulkAction.idsPerStep !== undefined
          ? { idsPerStep: bulkAction.idsPerStep }
          : {}),
        ...(ids ? { ids } : {})
      })
  );
  if (refused) {
    return {
      success: false,
      message: refused.message,
      refusal: refused.refusal
    };
  }
  return { success: true, background: true };
}
