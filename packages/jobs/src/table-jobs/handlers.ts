// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { NonRetriableError } from "inngest";

/**
 * The ERP side of the table jobs (background export and background bulk
 * actions). The list queries live in the ERP's list registry
 * (`apps/erp/app/utils/list-registry`), which packages/jobs cannot import, so
 * the ERP app hands them over at boot, like `setWorkflowDispatch`.
 */

export type TableJobContext = {
  companyId: string;
  userId: string;
};

export type TableJobPage = {
  rows: Record<string, unknown>[];
  /** The cursor of the next page, or null on the last page. */
  nextCursor: string | null;
  error?: unknown;
};

export interface TableJobHandlers {
  /**
   * Whether the user can still read the list: an employee of the company with
   * the list's permission. Read fresh, so a permission revoked after the
   * request is honored.
   */
  canReadList(listKey: string, context: TableJobContext): Promise<boolean>;
  /**
   * One page of the list for its URL search, read as the user. `cursor` is
   * the previous page's `nextCursor` (null for the first page). `limit` must
   * stay below PostgREST's `max_rows` (1,000): the query asks for one row
   * more than `limit` to know whether another page exists. `forExport` asks
   * for the rows as the CSV export writes them: with the values the list's
   * loader adds per page (the ERP's `exportRows`).
   */
  fetchListPage(
    listKey: string,
    context: TableJobContext,
    search: string,
    page: { cursor: string | null; limit: number; forExport?: boolean }
  ): Promise<TableJobPage>;
  /** The list's unique id column (`id` unless the list says otherwise). */
  listIdColumn(listKey: string): string;
  /**
   * Whether the user can still run the bulk action on the list: the list's
   * view permission, the action's own permission and any plan feature the
   * action needs, read fresh.
   */
  canRunBulkAction(
    listKey: string,
    action: TableBulkAction,
    context: TableJobContext
  ): Promise<boolean>;
  /**
   * Runs the action on one chunk of ids (at most 100), as the user. The
   * action applies its own per-row checks: a row it may not act on counts as
   * `skipped`, never as an error. `carry` is the value the previous chunk of
   * the same run returned (Jobs Release: the PO each supplier went on).
   */
  runBulkAction(
    action: TableBulkAction,
    ids: string[],
    context: TableJobContext,
    carry?: TableBulkActionCarry
  ): Promise<TableBulkActionResult>;
}

export type TableBulkAction = {
  /** A key of the ERP's bulk actions, for example "jobs.release". */
  key: string;
  /** The action's own values, for example `{ field, value }`. */
  params: Record<string, unknown>;
};

/** What a bulk action did to its rows. The ERP's action routes and the
 *  background job count the same way. */
export type TableBulkActionCounts = {
  done: number;
  skipped: number;
  failed: number;
  /** A line per row that failed, or that is done with something left to fix
   *  ("J000123: …"). At most `MAX_BULK_PROBLEMS`; `problemCount` counts all. */
  problems?: string[];
  problemCount?: number;
};

/** JSON an action hands from one chunk of a run to the next. It goes through
 *  the step results, so it must stay small. */
export type TableBulkActionCarry = Record<string, unknown>;

export type TableBulkActionResult = TableBulkActionCounts & {
  carry?: TableBulkActionCarry;
};

let handlers: TableJobHandlers | undefined;

/** The ERP app supplies this at boot; packages/jobs cannot import ~/ itself. */
export function setTableJobHandlers(next: TableJobHandlers): void {
  handlers = next;
}

export function getTableJobHandlers(): TableJobHandlers | undefined {
  return handlers;
}

/** The handlers, or a non-retriable failure naming the job (`what`). */
export function requireTableJobHandlers(what: string): TableJobHandlers {
  const current = getTableJobHandlers();
  if (!current) {
    // The ERP wires them on the first request to api+/inngest.ts, which is
    // also how this run arrived; reaching here means another host served it.
    throw new NonRetriableError(`${what} is not available in this environment`);
  }
  return current;
}

export type TableJobKind = "export" | "bulk";

/**
 * The per-company Redis lock of a table job. The ERP route takes it
 * (`takeTableJobLock`, value = the job's id) before it sends the event; the
 * job deletes it when it ends. Inngest's concurrency key queues a second run,
 * it never refuses one, so the lock is what answers "already running".
 */
export function tableJobLockKey(kind: TableJobKind, companyId: string): string {
  return `table-job:${kind}:${companyId}`;
}

/**
 * Seconds a lock (and its slot) lives if its job never deletes it: a crashed
 * process, or a run Inngest lost or cancelled (`onFailure` does not run then,
 * and the cancel event does not name the job). Each step sets it back to this
 * (`extendTableJobLock`), and a step ends within the load balancer's 600 s.
 */
export const TABLE_JOB_LOCK_TTL_SECONDS = 15 * 60;

/**
 * The running table jobs of every company: a sorted set of job ids, scored by
 * when each one's slot expires. A job takes a slot with its company lock.
 */
export const TABLE_JOB_SLOTS_KEY = "table-job:running";

/**
 * The most table jobs (exports and bulk actions together) that run at once
 * across all companies. They share CPU with web requests in the ERP
 * containers, so a request past this is refused, never queued: a queue that
 * many companies fill would make every user wait.
 * TODO(scale): move the table jobs to a dedicated worker service, then raise this.
 */
export const MAX_RUNNING_TABLE_JOBS = 4;
