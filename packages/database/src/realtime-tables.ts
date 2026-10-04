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

export type RealtimeTable = TablesWith<"broadcast_table_changes">;

type Tables = Database["public"]["Tables"];

type ScopedTo<T extends RealtimeTable> = T extends keyof Tables
  ? {
      table: T;
      /** `id`, or a `<name>Id` column: the only columns a broadcast names. */
      column: Extract<keyof Tables[T]["Row"], "id" | `${string}Id`>;
      /** The route param that holds the value. */
      param: string;
    }
  : never;

/**
 * A `handle.realtime` entry: a whole table, or only the rows that belong to the
 * record the route shows (`{ table: "jobOperation", column: "jobId", param: "jobId" }`).
 */
export type RouteRealtimeTable =
  | RealtimeTable
  | { [T in RealtimeTable]: ScopedTo<T> }[RealtimeTable];
