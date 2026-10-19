// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Attachment } from "./event-system/attachments";
import { attachments } from "./event-system/attachments";
import type { Database } from "./types";

// The tables that broadcast their changes over Realtime. Derived from the
// attachments manifest, so a table is realtime exactly when a broadcast handler
// is attached to it — there is no second list to keep in step.

type Attachments = typeof attachments;

type TablesWith<Handler extends string> = {
  [T in keyof Attachments]: Attachments[T] extends {
    statement: readonly (infer Attached)[];
  }
    ? Handler extends Attached
      ? T
      : never
    : never;
}[keyof Attachments];

const tablesWith = <Handler extends string>(handler: Handler) =>
  (Object.keys(attachments) as (keyof Attachments)[]).filter((table) =>
    (attachments[table] as Attachment).statement?.includes(handler)
  ) as TablesWith<Handler>[];

/**
 * Tables on their own topic, `company:<companyId>:<table>`. A route may only
 * name one of these in `handle.realtime` (the `realtime-table-has-trigger`
 * check): a table without the trigger sends nothing, and nothing errors.
 */
export const REALTIME_TABLES = tablesWith("broadcast_table_changes");

/**
 * Tables behind the cached `api+` reference lists. They share one topic,
 * `company:<companyId>:reference`.
 */
export const REALTIME_REFERENCE_TABLES = tablesWith(
  "broadcast_reference_changes"
);

/** Tables on a per-user topic, `user:<userId>:<table>`. */
export const REALTIME_USER_TABLES = tablesWith("broadcast_user_changes");

/**
 * The names the change log (`tableChange`) records changes under: the tables
 * with `log_table_changes`, and "employee" for `log_user_changes`. A writer
 * that runs with triggers off (a restore) logs a reset for each itself.
 */
export const CHANGE_LOGGED_TABLES: string[] = [
  ...new Set<string>([...tablesWith("log_table_changes"), "employee"])
];

export type RealtimeTable = TablesWith<"broadcast_table_changes">;

type Tables = Database["public"]["Tables"];

/**
 * Columns a broadcast adds for a table whose rows reach a record through
 * another table (a production event knows its operation, not its job). The
 * `ancestors` constant in `broadcast_table_changes.sql` is the source;
 * `realtime-tables.test.ts` keeps this equal to it.
 */
export const REALTIME_ANCESTOR_COLUMNS = {
  productionEvent: ["jobId"],
  jobOperationStep: ["jobId"],
  jobOperationStepRecord: ["operationId", "jobId"],
  trackedActivity: ["jobOperationId"],
  payment: ["targetSalesInvoiceId", "targetPurchaseInvoiceId"]
} as const satisfies Partial<Record<RealtimeTable, readonly string[]>>;

type AncestorColumn<T> = T extends keyof typeof REALTIME_ANCESTOR_COLUMNS
  ? (typeof REALTIME_ANCESTOR_COLUMNS)[T][number]
  : never;

type ScopedTo<T extends RealtimeTable> = T extends keyof Tables
  ? {
      table: T;
      /** `id`, a `<name>Id` column, or an ancestor column: all a broadcast names. */
      column:
        | Extract<keyof Tables[T]["Row"], "id" | `${string}Id`>
        | AncestorColumn<T>;
      /** The route param that holds the value. */
      param: string;
    }
  : never;

/**
 * A `handle.realtime` entry:
 * - a table name: every change to it in the company (a list page);
 * - `{ table, column, param }`: only the rows of the record the route shows
 *   (`{ table: "jobOperation", column: "jobId", param: "jobId" }`);
 * - `{ table, filter }`: the filter is built from the route's params and loader
 *   data, for a record the URL does not name. Return `undefined` to follow
 *   every change, `false` to follow none (the record has no such row yet).
 */
export type RouteRealtimeTable =
  | RealtimeTable
  | { [T in RealtimeTable]: ScopedTo<T> }[RealtimeTable]
  | {
      table: RealtimeTable;
      filter: (route: {
        params: Record<string, string | undefined>;
        // biome-ignore lint/suspicious/noExplicitAny: each route knows its own loader data
        data: any;
      }) => string | undefined | false;
    };
