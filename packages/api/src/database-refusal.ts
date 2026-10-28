// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What a database refusal means for the caller. Postgres refuses a write the
// caller can fix (a duplicate id, a reference to nothing, a missing or badly
// formed value) with a SQLSTATE; this names the category and says which field,
// so an API caller is not left with a bare 500. Values are never repeated: only
// column, table and constraint names, which are the API's own field names.

import type { ErrorCategory } from "./service-fn.server";

export type DatabaseRefusal = { category: ErrorCategory; message: string };

type Fields = {
  code: string;
  message: string;
  details: string;
  column?: string;
  table?: string;
  constraint?: string;
};

function fieldsOf(error: unknown): Fields | null {
  if (error === null || typeof error !== "object") return null;
  const e = error as Record<string, unknown>;
  if (typeof e.code !== "string" || e.code === "") return null;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    code: e.code,
    message: text(e.message),
    // PostgREST names it `details`; node-postgres `detail`.
    details: text(e.details) || text(e.detail),
    column: text(e.column) || undefined,
    table: text(e.table) || undefined,
    constraint: text(e.constraint) || undefined
  };
}

const IDENTITY_COLUMNS = new Set(["companyId", "companyGroupId"]);

/** The columns of `Key (a, b)=(…)` in a constraint's detail, identity columns left out. */
function keyColumns(details: string): string[] {
  const match = /Key \(([^)]+)\)=/.exec(details);
  if (!match) return [];
  return match[1]!
    .split(",")
    .map((column) => column.trim().replace(/^"|"$/g, ""))
    .filter((column) => !IDENTITY_COLUMNS.has(column));
}

function quoted(pattern: RegExp, text: string): string | undefined {
  return pattern.exec(text)?.[1];
}

function list(columns: string[]): string {
  return columns.map((column) => `"${column}"`).join(", ");
}

function uniqueViolation(f: Fields): string {
  const columns = keyColumns(f.details);
  return columns.length
    ? `A record with this ${list(columns)} already exists.`
    : "A record with these values already exists.";
}

function foreignKeyViolation(f: Fields): string {
  const referencedBy = quoted(
    /still referenced from table "([^"]+)"/,
    f.details
  );
  if (referencedBy) {
    return `It is still used by a "${referencedBy}" record; remove that first.`;
  }
  const columns = keyColumns(f.details);
  const target = quoted(/not present in table "([^"]+)"/, f.details);
  if (columns.length) {
    return target
      ? `${list(columns)} does not match an existing "${target}".`
      : `${list(columns)} does not match an existing record.`;
  }
  return "A referenced record does not exist.";
}

function notNullViolation(f: Fields): string {
  const column = f.column ?? quoted(/column "([^"]+)"/, f.message);
  return column ? `"${column}" is required.` : "A required field was missing.";
}

function checkViolation(f: Fields): string {
  const constraint =
    f.constraint ?? quoted(/check constraint "([^"]+)"/, f.message);
  return constraint
    ? `The values break the rule "${constraint}".`
    : "The values break a rule on this record.";
}

// SQLSTATE → category and message. Class 22 (data exception) is the caller's
// value: Postgres' own message names the type and is safe to show.
const REFUSALS: Record<string, (f: Fields) => DatabaseRefusal> = {
  "23505": (f) => ({ category: "conflict", message: uniqueViolation(f) }),
  "23503": (f) => ({ category: "conflict", message: foreignKeyViolation(f) }),
  "23502": (f) => ({ category: "validation", message: notNullViolation(f) }),
  "23514": (f) => ({ category: "validation", message: checkViolation(f) }),
  "22P02": (f) => ({ category: "validation", message: dataMessage(f) }),
  "22001": (f) => ({ category: "validation", message: dataMessage(f) }),
  "22003": (f) => ({ category: "validation", message: dataMessage(f) }),
  "22007": (f) => ({ category: "validation", message: dataMessage(f) }),
  "22008": (f) => ({ category: "validation", message: dataMessage(f) }),
  "42501": () => ({
    category: "forbidden",
    message: "You do not have permission to do this"
  }),
  PGRST116: () => ({
    category: "notFound",
    message: "No matching record was found."
  })
};

function dataMessage(f: Fields): string {
  return f.message ? `${capitalize(f.message)}.` : "A value is not valid.";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1).replace(/\.$/, "");
}

/**
 * The refusal a database error stands for, or null when it is not one the
 * caller can fix (a connection failure, a bug in our SQL). Looks one `cause`
 * deep, for an error that wraps the driver's.
 */
export function databaseRefusal(error: unknown): DatabaseRefusal | null {
  for (const candidate of [error, (error as { cause?: unknown })?.cause]) {
    const fields = fieldsOf(candidate);
    const refusal = fields && REFUSALS[fields.code];
    if (refusal) return refusal(fields);
  }
  return null;
}
