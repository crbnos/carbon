// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Why a write failed, as data: a code and the names it needs. The server
// reads it from the error; the browser renders it, translated, as the toast's
// second line. `raw` carries text that cannot be translated (a trigger's
// RAISE, an exception's message). Values are never repeated: only column,
// table and constraint names, which are the API's own field names.

export type FailureReasonCode =
  | "duplicate"
  | "stillUsed"
  | "noMatch"
  | "required"
  | "breaksRule"
  | "badValue"
  | "forbidden"
  | "notFound"
  | "notApplied"
  | "raw";

export type FailureReason = {
  code: FailureReasonCode;
  values: Record<string, string>;
};

/** The code `requireAffected` gives a write that changed no row. */
export const NOT_APPLIED_CODE = "CARBON_NOT_APPLIED";
export const NOT_APPLIED_TEXT =
  "You don't have permission to change this record, or it no longer exists.";

const RAW_TEXT_LIMIT = 300;
// A RAISE in our own SQL: its message was written for the person.
const RAISE_CODES = new Set(["P0001", "55000"]);
// Codes a RAISE also uses (ERRCODE = check_violation, …) with its own text.
const AUTHORABLE_CODES = new Set(["23514", "23503", "42501"]);
const POSTGRES_WORDING = /violates|permission denied/i;

type Fields = {
  code: string;
  message: string;
  details: string;
  column?: string;
  table?: string;
  constraint?: string;
};

/** The SQLSTATE and text of a PostgREST or node-postgres error, else null. */
function databaseFields(error: unknown): Fields | null {
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

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1).replace(/\.$/, "");
}

function reason(
  code: FailureReasonCode,
  values: Record<string, string | undefined> = {}
): FailureReason {
  const defined: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value) defined[key] = value;
  }
  return { code, values: defined };
}

function foreignKeyReason(f: Fields): FailureReason {
  const referencedBy = quoted(
    /still referenced from table "([^"]+)"/,
    f.details
  );
  if (referencedBy) return reason("stillUsed", { table: referencedBy });
  const columns = keyColumns(f.details);
  return reason("noMatch", {
    columns: columns.length ? list(columns) : undefined,
    target: columns.length
      ? quoted(/not present in table "([^"]+)"/, f.details)
      : undefined
  });
}

function dataReason(f: Fields): FailureReason {
  return reason("badValue", {
    text: f.message ? capitalize(f.message) : undefined
  });
}

// SQLSTATE → reason. Class 22 (data exception) is the caller's value:
// Postgres' own message names the type and is safe to show.
const REASONS: Record<string, (f: Fields) => FailureReason> = {
  "23505": (f) => {
    const columns = keyColumns(f.details);
    return reason("duplicate", {
      columns: columns.length ? list(columns) : undefined
    });
  },
  "23503": foreignKeyReason,
  "23502": (f) =>
    reason("required", {
      column: f.column ?? quoted(/column "([^"]+)"/, f.message)
    }),
  "23514": (f) =>
    reason("breaksRule", {
      constraint:
        f.constraint ?? quoted(/check constraint "([^"]+)"/, f.message)
    }),
  "22P02": dataReason,
  "22001": dataReason,
  "22003": dataReason,
  "22007": dataReason,
  "22008": dataReason,
  "42501": () => reason("forbidden"),
  PGRST116: () => reason("notFound")
};

function candidates(error: unknown): unknown[] {
  return [error, (error as { cause?: unknown } | null | undefined)?.cause];
}

/**
 * The reason a database refusal the caller can fix stands for, or null when
 * it is not one (a connection failure, a bug in our SQL). Looks one `cause`
 * deep, for an error that wraps the driver's.
 */
export function databaseReason(error: unknown): FailureReason | null {
  for (const candidate of candidates(error)) {
    const fields = databaseFields(candidate);
    if (!fields) continue;
    // A trigger that raised a constraint code wrote its text for the person,
    // and says more than the stock sentence for that code.
    if (
      AUTHORABLE_CODES.has(fields.code) &&
      fields.message &&
      !POSTGRES_WORDING.test(fields.message)
    ) {
      return raw(fields.message);
    }
    const mapped = REASONS[fields.code];
    if (mapped) return mapped(fields);
  }
  return null;
}

/** The English text of a reason. The database codes read as `databaseRefusal` always has. */
export function reasonText({ code, values }: FailureReason): string {
  switch (code) {
    case "duplicate":
      return values.columns
        ? `A record with this ${values.columns} already exists.`
        : "A record with these values already exists.";
    case "stillUsed":
      return `It is still used by a "${values.table}" record; remove that first.`;
    case "noMatch":
      if (values.columns && values.target) {
        return `${values.columns} does not match an existing "${values.target}".`;
      }
      return values.columns
        ? `${values.columns} does not match an existing record.`
        : "A referenced record does not exist.";
    case "required":
      return values.column
        ? `"${values.column}" is required.`
        : "A required field was missing.";
    case "breaksRule":
      return values.constraint
        ? `The values break the rule "${values.constraint}".`
        : "The values break a rule on this record.";
    case "badValue":
      return values.text ? `${values.text}.` : "A value is not valid.";
    case "forbidden":
      return "You do not have permission to do this";
    case "notFound":
      return "No matching record was found.";
    case "notApplied":
      return NOT_APPLIED_TEXT;
    case "raw":
      return values.text ?? "";
    default: {
      const unknown: never = code;
      return unknown;
    }
  }
}

function raw(text: string): FailureReason {
  return reason("raw", {
    text:
      text.length > RAW_TEXT_LIMIT
        ? `${text.slice(0, RAW_TEXT_LIMIT - 1)}…`
        : text
  });
}

export function isFailureReason(value: unknown): value is FailureReason {
  const r = value as { code?: unknown; values?: unknown } | null | undefined;
  return (
    typeof r?.code === "string" &&
    typeof r.values === "object" &&
    r.values !== null
  );
}

export type ZodLikeError = {
  name: "ZodError";
  issues: Array<{ path?: unknown[]; message?: unknown }>;
};

export function isZodError(err: unknown): err is ZodLikeError {
  const e = err as { name?: unknown; issues?: unknown } | null;
  return e?.name === "ZodError" && Array.isArray(e.issues);
}

/** A zod error as one line: the first 5 issues, each with its path. */
export function summarizeZodIssues({ issues }: ZodLikeError): string {
  const shown = issues.slice(0, 5).map(({ path, message }) => {
    const text = typeof message === "string" ? message : "invalid";
    return Array.isArray(path) && path.length > 0
      ? `${path.join(".")}: ${text}`
      : text;
  });
  const more = issues.length - shown.length;
  return `Invalid input — ${shown.join("; ")}${more > 0 ? `; +${more} more` : ""}`;
}

/** A RAISE in our SQL, with its authored text. */
function authoredReason(error: unknown): FailureReason | null {
  for (const candidate of candidates(error)) {
    const f = databaseFields(candidate);
    if (f?.message && RAISE_CODES.has(f.code)) return raw(f.message);
  }
  return null;
}

/**
 * Why a call failed, from whatever its caller holds: a Supabase or Postgres
 * error, a thrown `Error`, a zod error, a string, or a failed result that
 * already carries its reason. Null when there is nothing to say (no cause, or
 * a value that is not an error).
 */
export function describeCause(cause: unknown): FailureReason | null {
  if (cause === null || cause === undefined) return null;
  if (typeof cause === "string") return cause ? raw(cause) : null;
  if (typeof cause !== "object") return null;

  const e = cause as Record<string, unknown>;
  if (isFailureReason(e.reason)) return e.reason;
  // A service function's error as it reached the browser: no reason, so its
  // message (a rule or validation refusal written for the person) is the why.
  if (typeof e.category === "string" && typeof e.message === "string") {
    return e.message ? raw(e.message) : null;
  }
  if (e.code === NOT_APPLIED_CODE) return reason("notApplied");

  const authored = authoredReason(cause);
  if (authored) return authored;
  const known = databaseReason(cause);
  if (known) return known;

  if (isZodError(cause)) return raw(summarizeZodIssues(cause));
  // A plain `{ message }` is the error a building block wrote by hand.
  if (
    typeof e.message === "string" &&
    e.message !== "" &&
    (cause instanceof Error ||
      typeof e.code === "string" ||
      Object.getPrototypeOf(cause) === Object.prototype)
  ) {
    return raw(e.message);
  }
  return null;
}
