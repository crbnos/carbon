import type { FunctionsError, PostgrestError } from "@supabase/supabase-js";

export type SupabaseFailure = PostgrestError | FunctionsError;

export type DatabaseFailureKind =
  | "conflict"
  | "reference"
  | "required"
  | "permission"
  | "notFound"
  | "rule"
  | "unknown";

export const DATABASE_ERROR_MESSAGES: Record<DatabaseFailureKind, string> = {
  conflict: "Database error: a record with these values already exists.",
  reference:
    "Database error: the operation would violate a reference between records.",
  required: "Database error: a required field was missing.",
  permission:
    "Database error: this credential is not permitted to perform that operation.",
  notFound: "Database error: no matching record was found.",
  rule: "Database error: the operation was rejected by a server-side rule.",
  unknown: "Database error: the operation could not be completed."
};

export function classifyDatabaseFailure(
  error: SupabaseFailure | null | undefined
): DatabaseFailureKind {
  if (!error) return "unknown";
  if (error.name === "FunctionsHttpError") return "rule";

  switch ("code" in error ? error.code : undefined) {
    case "23505":
      return "conflict";
    case "23503":
      return "reference";
    case "23502":
      return "required";
    case "42501":
      return "permission";
    case "PGRST116":
      return "notFound";
    default:
      return "unknown";
  }
}

export function publicDatabaseError(
  error: SupabaseFailure | null | undefined
): string {
  return DATABASE_ERROR_MESSAGES[classifyDatabaseFailure(error)];
}
