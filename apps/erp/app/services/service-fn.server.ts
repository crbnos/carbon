// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import type { Permissions } from "@carbon/server-functions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const logger = getLogger("erp", "service-fn");

/** Every way a service function refuses, and the HTTP status it maps to. */
export const ERROR_STATUS = {
  validation: 400,
  unauthenticated: 401,
  entitlement: 402,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  rule: 422,
  rateLimited: 429,
  internal: 500,
  unavailable: 503
} as const;

export type ErrorCategory = keyof typeof ERROR_STATUS;

/**
 * The one error a service function returns. `message` is written for the
 * user; `cause` is the underlying failure and is logged, never shown.
 */
export class CarbonError<
  C extends ErrorCategory = ErrorCategory
> extends Error {
  readonly category: C;
  readonly cause?: unknown;

  constructor(category: C, message: string, cause?: unknown) {
    super(message);
    this.name = "CarbonError";
    this.category = category;
    this.cause = cause;
  }

  get status(): (typeof ERROR_STATUS)[C] {
    return ERROR_STATUS[this.category];
  }
}

export type Result<T, E extends CarbonError = CarbonError> =
  | { data: T; error: null }
  | { data: null; error: E };

/** Who made the call. Stated by the entry point that authenticated it. */
export type Actor =
  | { type: "user"; userId: string }
  | { type: "apiKey"; createdBy: string }
  | { type: "system"; onBehalfOf: string };

type Kv = typeof redis;

export type ServiceContext = {
  actor: Actor;
  company: { id: string; groupId: string };
  /** Runs as the caller: row-level security applies. */
  asCaller: { supabase: SupabaseClient<Database> };
  /** Bypasses row-level security: every query scopes by `company.id` itself. */
  asSystem: {
    supabase: SupabaseClient<Database>;
    pg: Kysely<KyselyDatabase>;
  };
  kv: Kv;
  /** The user id audit columns record: the user, a key's creator, or the user a job acts for. */
  auditUserId: string;
  error<C extends ErrorCategory>(
    category: C,
    message: string,
    cause?: unknown
  ): CarbonError<C>;
  /**
   * Runs `fn` in one transaction on `asSystem.pg`. A returned `CarbonError`
   * rolls back, as a throw does. Called inside a transaction, it joins it.
   */
  transaction<R>(
    fn: (tx: TransactionContext) => Promise<R>
  ): Promise<Result<Exclude<R, CarbonError>, Extract<R, CarbonError>>>;
};

/** The caller's client is its own connection and takes no part in a transaction. */
export type TransactionContext = Omit<ServiceContext, "asCaller">;

type Handles = {
  actor: Actor;
  company: { id: string; groupId: string };
  caller: SupabaseClient<Database>;
  system: () => SupabaseClient<Database>;
  pg: () => Kysely<KyselyDatabase>;
  kv: () => Kv;
};

class Rollback {
  constructor(readonly error: CarbonError) {}
}

export function createServiceContext(handles: Handles): ServiceContext {
  const { actor } = handles;
  const ctx: ServiceContext = {
    actor,
    company: handles.company,
    asCaller: { supabase: handles.caller },
    asSystem: {
      get supabase() {
        return handles.system();
      },
      get pg() {
        return handles.pg();
      }
    },
    get kv() {
      return handles.kv();
    },
    auditUserId:
      actor.type === "user"
        ? actor.userId
        : actor.type === "apiKey"
          ? actor.createdBy
          : actor.onBehalfOf,
    error: (category, message, cause) =>
      new CarbonError(category, message, cause),
    async transaction(fn) {
      type Out = Awaited<ReturnType<typeof fn>>;
      const settle = (out: Out) =>
        (out instanceof CarbonError
          ? { data: null, error: out }
          : { data: out, error: null }) as Result<
          Exclude<Out, CarbonError>,
          Extract<Out, CarbonError>
        >;

      const pg = handles.pg();
      if (pg.isTransaction) return settle(await fn(ctx));

      try {
        return settle(
          await pg.transaction().execute(async (trx) => {
            const out = await fn(
              createServiceContext({ ...handles, pg: () => trx })
            );
            if (out instanceof CarbonError) throw new Rollback(out);
            return out;
          })
        );
      } catch (err) {
        if (err instanceof Rollback) return settle(err.error as Out);
        throw err;
      }
    }
  };
  return ctx;
}

type Outcome<R> = Result<
  Exclude<R, CarbonError>,
  Extract<R, CarbonError> | CarbonError<"internal" | "validation">
>;

export type ServiceFn<I extends z.ZodType, R> = {
  (ctx: ServiceContext, input: z.input<I>): Promise<Outcome<R>>;
  input: I;
  permission: Permissions;
};

/**
 * Define an operation once: its input, who may run it, and what it does.
 *
 * `run` returns its value, or `ctx.error(...)` to refuse. Callers always get
 * `{ data, error }` and never an exception: anything `run` throws comes back
 * as an `internal` error with the detail logged and withheld.
 */
export function defineServiceFn<I extends z.ZodType, R>(definition: {
  input: I;
  permission: Permissions;
  run(ctx: ServiceContext, input: z.output<I>): Promise<R>;
}): ServiceFn<I, R> {
  const schema = z.compile(definition.input);

  const call = async (
    ctx: ServiceContext,
    input: z.input<I>
  ): Promise<Outcome<R>> => {
    const fail = (error: CarbonError) => ({ data: null, error }) as Outcome<R>;

    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return fail(new CarbonError("validation", z.prettifyError(parsed.error)));
    }

    try {
      const out = await definition.run(ctx, parsed.data);
      if (!(out instanceof CarbonError)) {
        return { data: out, error: null } as Outcome<R>;
      }
      if (out.category === "internal") {
        logger.error("Service function failed: {message}: {error}", {
          message: out.message,
          companyId: ctx.company.id,
          input,
          error: out.cause
        });
      }
      return fail(out);
    } catch (err) {
      logger.error("Service function threw: {error}", {
        companyId: ctx.company.id,
        input,
        error: err
      });
      return fail(new CarbonError("internal", "Something went wrong", err));
    }
  };

  return Object.assign(call, {
    input: definition.input,
    permission: definition.permission
  });
}
