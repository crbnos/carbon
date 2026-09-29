import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import type { z } from "zod";
import { type ServerFnError, toServerFnError } from "./errors";
import {
  authorize,
  type Permissions,
  ServerFnContext
} from "./server-fn-context";

export type ServerFnResult<R> =
  | { data: R; error: null }
  | { data: null; error: ServerFnError };

export type ServerFn<S extends z.ZodType, R> = {
  (ctx: ServerFnContext, input: z.input<S>): Promise<ServerFnResult<R>>;
  /**
   * For app code that holds a Supabase client instead of a context: the
   * client's key decides the actor (`ServerFnContext.fromClient`), and the
   * input's `companyId` / `userId` fill in the rest.
   */
  withClient(
    client: SupabaseClient<Database>,
    db: Kysely<KyselyDatabase>,
    input: z.input<S> & { companyId: string; userId: string }
  ): Promise<ServerFnResult<R>>;
  readonly serverFnName: string;
};

/**
 * One permission per value of a string field of the input (its `type`, the
 * `table` an import targets, …). Data, not a function, so the API manifest can
 * read it.
 */
type KeyedRule<I> = {
  [K in keyof I & string]: I[K] extends string
    ? { by: K; rules: Record<I[K], Permissions> }
    : never;
}[keyof I & string];

/** What the caller must hold: one rule for every input, or one per field value. */
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
  /** Kebab-case, matching the directory; names the function in logs. */
  name: string;
  input: S;
  permissions: PermissionRule<z.output<S>>;
  /** Status for a thrown error that carries none of its own. */
  defaultStatus?: number;
  run: (ctx: ServerFnContext, input: z.output<S>) => Promise<R>;
};

/**
 * A server function: validates its input, authorizes the caller, runs, and
 * returns `{ data, error }` — never throws. Everything a caller must know is
 * in the definition, so every function has the same shape.
 */
export function defineServerFn<S extends z.ZodType, R>({
  name,
  input: schema,
  permissions,
  defaultStatus = 500,
  run
}: ServerFnDefinition<S, R>): ServerFn<S, R> {
  const call = async (
    ctx: ServerFnContext,
    input: z.input<S>
  ): Promise<ServerFnResult<R>> => {
    try {
      const parsed = schema.parse(input);
      await authorize(ctx, resolvePermissions(permissions, parsed));
      return { data: await run(ctx, parsed), error: null };
    } catch (err) {
      return { data: null, error: toServerFnError(name, err, defaultStatus) };
    }
  };

  return Object.assign(call, {
    serverFnName: name,
    withClient: async (
      client: SupabaseClient<Database>,
      db: Kysely<KyselyDatabase>,
      input: z.input<S> & { companyId: string; userId: string }
    ) =>
      call(
        await ServerFnContext.fromClient(client, {
          db,
          companyId: input.companyId,
          userId: input.userId
        }),
        input
      )
  });
}
