import * as R from "remeda";
import type { z } from "zod";
import { stringToPathArray } from "./utils";
import { createValidator } from "./validation/createValidator";
import type { FieldErrors, Validator } from "./validation/types";

const getIssuesForError = (err: z.ZodError<any>): z.ZodIssue[] => {
  return err.issues.flatMap((issue) => {
    if ("unionErrors" in issue) {
      return issue.unionErrors.flatMap((err) => getIssuesForError(err));
    } else {
      return [issue];
    }
  });
};

function pathToString(array: (string | number)[]): string {
  return array.reduce<string>(function (string: string, item: string | number) {
    const prefix = string === "" ? "" : ".";
    return string + (isNaN(Number(item)) ? prefix + item : "[" + item + "]");
  }, "");
}

/**
 * Create a validator using a `zod` schema.
 */
export function validator<T, U extends z.ZodTypeDef>(
  zodSchema: z.Schema<T, U, unknown>,
  parseParams?: Partial<z.ParseParams>
): Validator<T> {
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
        )?.message,
      };
    },
  });
}
