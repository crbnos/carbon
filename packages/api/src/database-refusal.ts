// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What a database refusal means for the caller. Postgres refuses a write the
// caller can fix (a duplicate id, a reference to nothing, a missing or badly
// formed value) with a SQLSTATE; this names the category and says which field,
// so an API caller is not left with a bare 500. Values from the database are
// never repeated: only column, table and constraint names, which are the API's
// own field names. The caller's own input may be (`withCallerValues`).

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  databaseReason,
  type FailureReason,
  type FailureReasonCode,
  reasonText
} from "@carbon/utils";
import type { ErrorCategory } from "./service-fn.server";

export type DatabaseRefusal = {
  category: ErrorCategory;
  message: string;
  reason: FailureReason;
};

// The category of each reason a database refusal can stand for. The reason
// and its English text come from `@carbon/utils`, which the browser shares.
const CATEGORIES: Partial<Record<FailureReasonCode, ErrorCategory>> = {
  duplicate: "conflict",
  stillUsed: "conflict",
  noMatch: "conflict",
  required: "validation",
  breaksRule: "validation",
  badValue: "validation",
  forbidden: "forbidden",
  notFound: "notFound"
};

// A trigger's own text (a `raw` reason) under the constraint code it raised.
const AUTHORED_CATEGORIES: Record<string, ErrorCategory> = {
  "23503": "conflict",
  "23514": "validation",
  "42501": "forbidden"
};

function authoredCategory(error: unknown): ErrorCategory | undefined {
  for (const candidate of [error, (error as { cause?: unknown })?.cause]) {
    const code = (candidate as { code?: unknown } | null | undefined)?.code;
    if (typeof code === "string" && code in AUTHORED_CATEGORIES) {
      return AUTHORED_CATEGORIES[code];
    }
  }
  return undefined;
}

/**
 * The refusal a database error stands for, or null when it is not one the
 * caller can fix (a connection failure, a bug in our SQL). Looks one `cause`
 * deep, for an error that wraps the driver's.
 */
export function databaseRefusal(error: unknown): DatabaseRefusal | null {
  const reason = databaseReason(error);
  const category =
    reason &&
    (reason.code === "raw" ? authoredCategory(error) : CATEGORIES[reason.code]);
  return reason && category
    ? { category, message: reasonText(reason), reason }
    : null;
}

const IDENTITY_COLUMNS = new Set(["companyId", "companyGroupId"]);

/** The column names a reason quotes (`"a", "b"`), identity columns left out. */
export function reasonColumns({ values }: FailureReason): string[] {
  const quoted = values.columns ?? (values.column && `"${values.column}"`);
  if (!quoted) return [];
  return [...quoted.matchAll(/"([^"]+)"/g)]
    .map((match) => match[1]!)
    .filter((column) => !IDENTITY_COLUMNS.has(column));
}

type KeyColumnUsage = {
  key_column_usage: {
    constraint_schema: string;
    constraint_name: string;
    table_name: string;
    column_name: string;
    ordinal_position: number;
  };
};

const constraintColumnsCache = new Map<string, string[]>();

async function constraintColumns(
  pg: Kysely<KyselyDatabase>,
  constraint: string,
  table: string | undefined
): Promise<string[]> {
  const key = `${table ?? ""}.${constraint}`;
  const cached = constraintColumnsCache.get(key);
  if (cached) return cached;
  let query = (
    pg.withSchema("information_schema") as unknown as Kysely<KeyColumnUsage>
  )
    .selectFrom("key_column_usage")
    .select(["column_name", "table_name"])
    .where("constraint_schema", "=", "public")
    .where("constraint_name", "=", constraint);
  if (table) query = query.where("table_name", "=", table);
  const rows = await query.orderBy("ordinal_position").execute();
  // A name two tables share is ambiguous without the table.
  if (new Set(rows.map((row) => row.table_name)).size > 1) return [];
  const columns = rows
    .map((row) => row.column_name)
    .filter((column) => !IDENTITY_COLUMNS.has(column));
  constraintColumnsCache.set(key, columns);
  return columns;
}

/**
 * Names the columns of a duplicate or a reference to nothing when Postgres
 * left them out of the detail (it does under row-level security), from the
 * constraint it named. Unchanged when that lookup is not possible.
 */
export async function withConstraintColumns(
  refusal: DatabaseRefusal,
  pg: () => Kysely<KyselyDatabase>
): Promise<DatabaseRefusal> {
  const { code, values } = refusal.reason;
  if (
    (code !== "duplicate" && code !== "noMatch") ||
    values.columns ||
    !values.constraint
  ) {
    return refusal;
  }
  try {
    const columns = await constraintColumns(
      pg(),
      values.constraint,
      values.table
    );
    if (!columns.length) return refusal;
    const reason = {
      code,
      values: {
        ...values,
        columns: columns.map((column) => `"${column}"`).join(", ")
      }
    };
    return { ...refusal, message: reasonText(reason), reason };
  } catch {
    // An aborted transaction or a test double: the refusal still stands.
    return refusal;
  }
}

const MAX_VALUE_LENGTH = 100;

function scalar(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value);
  if (!text) return undefined;
  return text.length > MAX_VALUE_LENGTH
    ? `${text.slice(0, MAX_VALUE_LENGTH - 1)}…`
    : text;
}

/**
 * Adds what the caller sent: `record`, the input's readable id (or id), and
 * `value`, its value for the one field the refusal names.
 */
export function withCallerValues(
  refusal: DatabaseRefusal,
  input: unknown
): DatabaseRefusal {
  if (input === null || typeof input !== "object") return refusal;
  const fields = input as Record<string, unknown>;
  const columns = reasonColumns(refusal.reason);
  const record = scalar(fields.readableId) ?? scalar(fields.id);
  const value =
    columns.length === 1 && refusal.reason.code !== "required"
      ? scalar(fields[columns[0]!])
      : undefined;
  if (!record && !value) return refusal;
  return {
    ...refusal,
    reason: {
      ...refusal.reason,
      values: {
        ...refusal.reason.values,
        ...(record && { record }),
        ...(value && { value })
      }
    }
  };
}
