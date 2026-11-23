// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Params } from "react-router";
import * as R from "remeda";
import { z } from "zod";
import { validationError } from "./server";
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

type RequestOptions<P extends string> = {
  /** The one method the action accepts. Anything else is a 405. */
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  /** Route params the action needs. A missing one is a 400. */
  params?: readonly P[];
};

/** The caller sent a body that is not JSON: a 400, not a 500 from the parse. */
async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new Response("The request body is not valid JSON", { status: 400 });
  }
}

export type ValidatedRequest<T, P extends string> =
  | { data: T; params: Record<P, string>; formData: FormData | undefined }
  | { invalid: ReturnType<typeof validationError> };

/**
 * Create a validator using a `zod` schema.
 *
 * `.request(args, options)` checks an action's request in one call, before
 * anything else runs: the method, then the route params, then the body (form
 * data or JSON). Without a schema it reads no body.
 */
export function validator<Schema extends z.ZodType = z.ZodObject<{}>>(
  zodSchema?: Schema,
  parseParams?: Parameters<Schema["safeParseAsync"]>[1]
): Validator<z.output<Schema>> & {
  request<P extends string = never>(
    args: { request: Request; params: Params },
    options?: RequestOptions<P>
  ): Promise<ValidatedRequest<z.output<Schema>, P>>;
} {
  const schema = (zodSchema ?? z.object({})) as Schema;
  const validate = createValidator<z.output<Schema>>({
    validate: async (value) => {
      const result = await schema.safeParseAsync(value, parseParams);
      if (result.success) return { data: result.data, error: undefined };

      const fieldErrors: FieldErrors = {};
      getIssuesForError(result.error).forEach((issue) => {
        const path = pathToString(issue.path);
        if (!fieldErrors[path]) fieldErrors[path] = issue.message;
      });
      return { error: fieldErrors, data: undefined };
    },
    validateField: async (data, field) => {
      const result = await schema.safeParseAsync(data, parseParams);
      if (result.success) return { error: undefined };
      return {
        error: getIssuesForError(result.error).find((issue) =>
          R.equals(issue.path, stringToPathArray(field))
        )?.message
      };
    }
  });

  return {
    ...validate,
    async request<P extends string = never>(
      { request, params: routeParams }: { request: Request; params: Params },
      { method = "POST", params: names = [] }: RequestOptions<P> = {}
    ): Promise<ValidatedRequest<z.output<Schema>, P>> {
      if (request.method.toUpperCase() !== method) {
        throw new Response("Method not allowed", { status: 405 });
      }

      const params = {} as Record<P, string>;
      for (const name of names) {
        const value = routeParams[name];
        if (!value) {
          throw new Response(`Missing required request param "${name}"`, {
            status: 400
          });
        }
        params[name] = value;
      }

      if (!zodSchema) {
        return { data: {} as z.output<Schema>, params, formData: undefined };
      }

      const isJson = request.headers
        .get("content-type")
        ?.includes("application/json");
      const formData = isJson ? undefined : await request.formData();
      const result = await validate.validate(
        formData ?? (await jsonBody(request))
      );
      if (result.error) {
        return { invalid: validationError(result.error, result.submittedData) };
      }
      return { data: result.data, params, formData };
    }
  };
}
