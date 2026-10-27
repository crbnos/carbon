// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { Feature } from "@carbon/ee/plan";
import { RoundingMode, round } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import type { ListPermission } from "./list-registry/index.server";

/**
 * Pure parts of the table jobs (background export and bulk actions), shared by
 * the server handlers (`table-jobs.server.ts`), the action routes and the
 * export download route. No I/O here.
 */

export type TableJobClaims = {
  role: string | null;
  permissions: Record<
    string,
    { view: string[]; create: string[]; update: string[]; delete: string[] }
  >;
};

const PERMISSION_ACTIONS = ["view", "create", "update", "delete"] as const;

/**
 * The check `requirePermissions` does for a list's permission, on claims read
 * for one company. A table job also requires the employee role: the loaders
 * refuse portal accounts, and the job must never do more than the loader.
 */
export function hasListPermission(
  claims: TableJobClaims,
  permission: ListPermission,
  companyId: string
): boolean {
  if (claims.role !== "employee") return false;
  if (permission.role && claims.role !== permission.role) return false;
  return PERMISSION_ACTIONS.every((action) => {
    const required = permission[action];
    if (required === undefined) return true;
    const modules = Array.isArray(required) ? required : [required];
    return modules.every(
      (module) =>
        claims.permissions[module]?.[action]?.includes(companyId) ?? false
    );
  });
}

/** The answer when another job of the company holds the lock: the job kind
 *  and, when Redis knows it, how long until the lock expires at the latest. */
export function tableJobBusyMessage(
  kind: "export" | "bulk",
  retryAfterSeconds: number
): string {
  const running =
    kind === "export"
      ? "An export is already running for your company."
      : "A bulk action is already running for your company.";
  if (retryAfterSeconds <= 0) return running;
  const minutes = round(retryAfterSeconds / 60, 0, RoundingMode.Up);
  return `${running} Try again when it ends, at the latest in ${minutes} ${
    minutes === 1 ? "minute" : "minutes"
  }.`;
}

/** The answer when every table-job slot across companies is taken
 *  (`MAX_RUNNING_TABLE_JOBS`): the request is refused, never queued. */
export const TABLE_JOBS_FULL_MESSAGE =
  "Too many exports and bulk actions are running right now. Try again in a few minutes.";

const LIST_KEY = /^[a-z0-9-]{1,64}$/;
const EXPORT_TOKEN = /^[A-Za-z0-9_-]{10,64}$/;

/**
 * A new export id, `{listKey}.{random}`. The list key rides in the id so the
 * download route can check the list's permission again without a second
 * store; changing it in a link names a file that does not exist.
 */
export function newTableExportId(listKey: string): string {
  return `${listKey}.${nanoid()}`;
}

/** The list key of an export id, or null when the id is not one. */
export function parseTableExportId(
  exportId: string
): { listKey: string } | null {
  const [listKey, token, ...rest] = exportId.split(".");
  if (rest.length > 0 || !listKey || !token) return null;
  if (!LIST_KEY.test(listKey) || !EXPORT_TOKEN.test(token)) return null;
  return { listKey };
}

/**
 * The client a bulk action writes with: the request's client on the action
 * route, or a factory in the background job, which signs a new user token
 * when the last is about to expire (they live five minutes). A long action
 * asks for the client again before each row it acts on.
 */
export type UserClientSource =
  | SupabaseClient<Database>
  | (() => Promise<SupabaseClient<Database>>);

export function resolveUserClient(
  source: UserClientSource
): Promise<SupabaseClient<Database>> {
  return typeof source === "function" ? source() : Promise.resolve(source);
}

/** A user token lives five minutes; sign a new one after four, so a call made
 *  just before the switch still has a minute to run. */
export const USER_CLIENT_MAX_AGE_MS = 4 * 60 * 1000;

/**
 * A factory that hands out the same client until it is `maxAgeMs` old, then
 * signs a new one. `now` is the wall clock in milliseconds (an instant, not a
 * date, so `Date.now` is right here).
 */
export function refreshingClientFactory<T>(
  sign: () => Promise<T>,
  maxAgeMs = USER_CLIENT_MAX_AGE_MS,
  now: () => number = Date.now
): () => Promise<T> {
  let current: { client: Promise<T>; signedAt: number } | null = null;
  return () => {
    const at = now();
    if (!current || at - current.signedAt >= maxAgeMs) {
      current = { client: sign(), signedAt: at };
    }
    return current.client;
  };
}

/**
 * Splits the requested ids into the ones the action may act on and the rest.
 * `rows` is what the database returned for the ids (scoped to the company);
 * an id with no row (another company's, or deleted) counts as skipped, like
 * a row whose status the action does not accept.
 */
export function splitIdsByStatus<TStatus>(
  ids: string[],
  rows: { id: string; status: TStatus }[],
  isAllowed: (status: TStatus) => boolean
): { allowed: string[]; skipped: number } {
  const statusById = new Map(rows.map((row) => [row.id, row.status] as const));
  const allowed = ids.filter(
    (id) => statusById.has(id) && isAllowed(statusById.get(id) as TStatus)
  );
  return { allowed, skipped: ids.length - allowed.length };
}

/** A bulk action route's "every matching row" request: the list and its URL
 *  search, as the Table's `AllMatchingSelection` holds them. */
export type AllMatchingRequest = { listKey: string; search: string };

/**
 * Why a table job (an export or a bulk action) did not start. The browser
 * words it in the user's language (`useTableJobRefusalMessage`); `message`
 * next to it is the English text for logs and older callers.
 */
export type TableJobRefusal =
  | { code: "busy"; kind: "export" | "bulk"; minutes: number }
  | { code: "full" }
  | { code: "row-limit"; maxRows: number }
  | { code: "not-supported" }
  | { code: "no-permission" }
  | { code: "not-started" };

/** The busy refusal: minutes until the lock expires at the latest, 0 when
 *  Redis does not know. */
export function tableJobBusyRefusal(
  kind: "export" | "bulk",
  retryAfterSeconds: number
): TableJobRefusal {
  return {
    code: "busy",
    kind,
    minutes:
      retryAfterSeconds > 0
        ? round(retryAfterSeconds / 60, 0, RoundingMode.Up)
        : 0
  };
}

/**
 * What a bulk action route answers for an "every matching row" request: the
 * background job started, or why it did not. Every route answers the same
 * shape, so one client helper (`useBulkStartToast`) reads them all.
 */
export type BulkActionStart =
  | { success: true; background: true }
  | { success: false; message: string; refusal: TableJobRefusal };

/**
 * A form-posted route's answer for a bulk start: the `BulkActionStart` fields
 * plus the route's usual `{ data, error }`, so code typed by the route's
 * answer reads `error` on every variant.
 */
export function bulkStartFormResponse(start: BulkActionStart) {
  return start.success
    ? { ...start, data: null, error: null }
    : { ...start, data: null, error: { message: start.message } };
}

/**
 * The most rows Jobs Release and Batches Release act on in the background.
 * Each released job runs the requirements recalculation and MRP, so a bigger
 * run would hold the company's queue for hours.
 */
export const ALL_MATCHING_RELEASE_LIMIT = 2_000;

export type BulkActionMeta = {
  /** The action's English name for the notification ("Release jobs"). */
  label: string;
  /** The list keys whose rows the action may act on. */
  lists: readonly string[];
  /** The action route's permission check (the job adds the employee role). */
  permission: ListPermission;
  /** The plan feature the action route requires, checked again by the job. */
  feature?: Feature;
  /** The most matching rows the action runs on (default 100,000). */
  maxRows?: number;
  /** Ids per job step (default 1,000). Lower for an action that does a lot
   *  per row, so one step stays well below the load balancer's 600 s. */
  idsPerStep?: number;
};

const rowCount = new Intl.NumberFormat("en-US");

/**
 * Why the action may not start on `matchingRows` rows (the list header's
 * count: exact up to 1,000, an estimate above), or null. The job also stops
 * at the limit, so an estimate that was low still runs on the first rows only.
 */
export function rowLimitRefusal(
  action: Pick<BulkActionMeta, "label" | "maxRows">,
  matchingRows: number
): string | null {
  if (action.maxRows === undefined || matchingRows <= action.maxRows) {
    return null;
  }
  const limit = rowCount.format(action.maxRows);
  return `${action.label} runs on at most ${limit} rows. Filter the list to ${limit} rows or fewer.`;
}

/**
 * Reads `allMatching` from a bulk action request: an object (JSON body) or
 * its JSON text (a form field). Answers null when it is missing or not valid.
 */
export function parseAllMatching(value: unknown): AllMatchingRequest | null {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const { listKey, search } = parsed as Record<string, unknown>;
  if (typeof listKey !== "string" || listKey.length === 0) return null;
  if (typeof search !== "string" || search.length > 10_000) return null;
  return { listKey, search };
}
