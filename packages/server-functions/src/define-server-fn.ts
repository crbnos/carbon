// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { failSpan, inSpan } from "@carbon/logger/span";
import type { z } from "zod";
import { type ServerFnError, toServerFnError } from "./errors";
import {
  authorize,
  type Permissions,
  type ServerFnContext
} from "./server-fn-context";

export type ServerFnResult<R> =
  | { data: R; error: null }
  | { data: null; error: ServerFnError };

export type ServerFn<S extends z.ZodType, R> = {
  (ctx: ServerFnContext, input: z.input<S>): Promise<ServerFnResult<R>>;
  readonly serverFnName: string;
  readonly permissions: PermissionRule<z.output<S>>;
};

/** One permission per value of a string field. Data, so the API manifest can read it. */
type KeyedRule<I> = {
  [K in keyof I & string]: I[K] extends string
    ? { by: K; rules: Record<I[K], Permissions> }
    : never;
}[keyof I & string];

export type PermissionRule<I> = Permissions | KeyedRule<I>;

function resolvePermissions<I>(rule: PermissionRule<I>, input: I): Permissions {
  if (typeof rule === "object" && "by" in rule) {
    const value = (input as Record<string, unknown>)[rule.by];
    const rules = rule.rules as Record<string, Permissions | undefined>;
    // Fail closed: a value with no rule is never allowed through.
    return (typeof value === "string" && rules[value]) || "system";
  }
  return rule as Permissions;
}

type ServerFnDefinition<S extends z.ZodType, R> = {
  name: string;
  input: S;
  permissions: PermissionRule<z.output<S>>;
  defaultStatus?: number;
  run: (ctx: ServerFnContext, input: z.output<S>) => Promise<R>;
};

/** Validates, authorizes, runs, and returns `{ data, error }` — never throws. */
export function defineServerFn<S extends z.ZodType, R>({
  name,
  input: schema,
  permissions,
  defaultStatus = 500,
  run
}: ServerFnDefinition<S, R>): ServerFn<S, R> {
  // One span per call, named as the edge function's was (`function <name>`),
  // so a trace says which function the SQL under it belongs to.
  const call = (
    ctx: ServerFnContext,
    input: z.input<S>
  ): Promise<ServerFnResult<R>> =>
    inSpan(
      `function ${name}`,
      { "carbon.function": name, "carbon.function.actor": ctx.actor },
      async (span) => {
        try {
          const parsed = schema.parse(input);
          await authorize(ctx, resolvePermissions(permissions, parsed));
          return { data: await run(ctx, parsed), error: null };
        } catch (err) {
          const error = toServerFnError(name, err, defaultStatus);
          span.setAttribute("carbon.function.status", error.status);
          // A refusal the caller caused is not a failed span.
          if (error.status >= 500) failSpan(span, error.message);
          return { data: null, error };
        }
      }
    );

  return Object.assign(call, {
    serverFnName: name,
    permissions
  });
}
