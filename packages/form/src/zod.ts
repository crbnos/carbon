import * as R from "remeda";
import type { z } from "zod";
import { stringToPathArray } from "./utils";
import { createValidator } from "./validation/createValidator";
import type { FieldErrors, Validator } from "./validation/types";

// Minimal issue shape we depend on — decoupled from zod's internal issue type,
// which changed between v3 and v4 (`path` is now `PropertyKey[]`, and a union
// issue carries `errors: Issue[][]` in v4 instead of `unionErrors: ZodError[]`).
type MinimalIssue = { path: PropertyKey[]; message: string; code?: string };

// Flatten a ZodError's issues, recursing into union issues (both v4 `errors`
// and v3 `unionErrors` shapes) so a nested field error surfaces at its own path.
const getIssuesForError = (err: z.ZodError): MinimalIssue[] => {
  const collect = (issues: readonly MinimalIssue[]): MinimalIssue[] =>
    issues.flatMap((issue) => {
      const u = issue as MinimalIssue & {
        errors?: MinimalIssue[][];
        unionErrors?: { issues: MinimalIssue[] }[];
      };
      if (u.code === "invalid_union") {
        if (Array.isArray(u.errors)) return collect(u.errors.flat());
        if (Array.isArray(u.unionErrors))
          return collect(u.unionErrors.flatMap((e) => e.issues));
      }
      return [issue];
    });
  return collect(err.issues as unknown as MinimalIssue[]);
};

function pathToString(array: PropertyKey[]): string {
  return array.reduce<string>(function (string: string, itemRaw: PropertyKey) {
    const item = String(itemRaw);
    const prefix = string === "" ? "" : ".";
    return string + (isNaN(Number(item)) ? prefix + item : "[" + item + "]");
  }, "");
}

/**
 * Create a validator using a `zod` schema.
 */
export function validator<Schema extends z.ZodType>(
  zodSchema: Schema,
  parseParams?: Parameters<Schema["safeParseAsync"]>[1]
): Validator<z.output<Schema>> {
  return createValidator({
    validate: async (value) => {
      const result = await zodSchema.safeParseAsync(value, parseParams);
      if (result.success) return { data: result.data, error: undefined };

      const fieldErrors: FieldErrors = {};
      getIssuesForError(result.error).forEach((issue) => {
        const path = pathToString(issue.path);
        if (!fieldErrors[path]) fieldErrors[path] = issue.message;
      });
      return { error: fieldErrors, data: undefined };
    },
    validateField: async (data, field) => {
      const result = await zodSchema.safeParseAsync(data, parseParams);
      if (result.success) return { error: undefined };
      return {
        error: getIssuesForError(result.error).find((issue) =>
          R.equals(issue.path, stringToPathArray(field))
        )?.message
      };
    }
  });
}
