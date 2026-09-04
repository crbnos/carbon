import * as R from "remeda";
import type { z } from "zod";
import { stringToPathArray } from "./utils";
import { createValidator } from "./validation/createValidator";
import type { FieldErrors, Validator } from "./validation/types";

// Flatten a ZodError's issues, recursing into union issues (`invalid_union`
// carries `errors: $ZodIssue[][]`) so a nested field error surfaces at its own
// path. A union issue with no sub-errors is kept as-is so a message survives.
const getIssuesForError = (err: z.ZodError): z.core.$ZodIssue[] => {
  const collect = (issues: readonly z.core.$ZodIssue[]): z.core.$ZodIssue[] =>
    issues.flatMap((issue) =>
      issue.code === "invalid_union" && issue.errors.length > 0
        ? collect(issue.errors.flat())
        : [issue]
    );
  return collect(err.issues);
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
