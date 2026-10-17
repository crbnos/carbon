// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  hasPermissions,
  type ModulePermissions,
  type PermissionRule,
  type Permissions,
  resolvePermissions
} from "./permissions";

const logger = getLogger("api", "service-fn");

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
    // A refusal is an expected outcome that is returned, not thrown: nobody
    // reads its stack, and capturing one is most of what creating it costs.
    const limit = Error.stackTraceLimit;
    if (category !== "internal") Error.stackTraceLimit = 0;
    super(message);
    Error.stackTraceLimit = limit;
    this.category = category;
    this.cause = cause;
  }

  get status(): (typeof ERROR_STATUS)[C] {
    return ERROR_STATUS[this.category];
  }
}
CarbonError.prototype.name = "CarbonError";

export type Result<T, E extends CarbonError = CarbonError> =
  | { data: T; error: null }
  | { data: null; error: E };

/**
 * Who made the call, and what they hold. Stated by the entry point that
 * authenticated it; the gate checks every entry call against it.
 */
export type Actor =
  | { type: "user"; userId: string; permissions: ModulePermissions }
  | { type: "apiKey"; createdBy: string; scopes: ModulePermissions }
  | { type: "system"; onBehalfOf: string };

type Kv = typeof redis;

export type ServiceContext = {
  actor: Actor;
  company: { id: string; groupId: string };
  /**
   * Runs as the caller: row-level security applies. Not part of a
   * transaction: inside `ctx.transaction` reading it throws.
   */
  asCaller: { supabase: SupabaseClient<Database> };
  /** Bypasses row-level security: every query scopes by `company.id` itself. */
  asSystem: {
    supabase: SupabaseClient<Database>;
    pg: Kysely<KyselyDatabase>;
  };
  kv: Kv;
  /** The user id audit columns record: the user, a key's creator, or the user a job acts for. */
  auditUserId: string;
  /**
   * Whether the actor also holds `required`: for a permission that depends on
   * the data, which the entry gate cannot know. The system actor holds all.
   */
  can(required: Permissions): boolean;
  error<C extends ErrorCategory>(
    category: C,
    message: string,
    cause?: unknown
  ): CarbonError<C>;
  /**
   * Runs `fn` in one transaction on `asSystem.pg`. A returned refusal (a
   * `CarbonError`, or a service function's `{ data, error }` with one) rolls
   * back, as a throw does, and is returned as the error. Called inside a
   * transaction, it joins it: the refusal is returned and the outer
   * transaction rolls back when its own body returns it.
   */
  transaction<R>(fn: (tx: ServiceContext) => Promise<R>): Promise<Settled<R>>;
};

/** The refusal a transaction's body can return: bare, or a service function's error. */
type Refusal<R> =
  | Extract<R, CarbonError>
  | (R extends { data: unknown; error: infer E }
      ? Extract<E, CarbonError>
      : never);

/** A transaction's result: the body's value, or the refusal that rolled it back. */
export type Settled<R> = Result<
  Exclude<R, CarbonError | { data: unknown; error: CarbonError }>,
  Refusal<R>
>;

type Handles = {
  actor: Actor;
  company: { id: string; groupId: string };
  caller: SupabaseClient<Database>;
  system: () => SupabaseClient<Database>;
  pg: () => Kysely<KyselyDatabase>;
  kv: () => Kv;
};

class Rollback {
  readonly error: CarbonError;
  constructor(error: CarbonError) {
    this.error = error;
  }
}

function auditUserIdOf(actor: Actor): string {
  if (actor.type === "user") return actor.userId;
  if (actor.type === "apiKey") return actor.createdBy;
  return actor.onBehalfOf;
}

function refusalIn(out: unknown): CarbonError | null {
  if (out instanceof CarbonError) return out;
  if (out !== null && typeof out === "object" && "data" in out) {
    const { error } = out as { error?: unknown };
    if (error instanceof CarbonError) return error;
  }
  return null;
}

function settle<R>(out: R): Settled<R> {
  const error = refusalIn(out);
  return (
    error ? { data: null, error } : { data: out, error: null }
  ) as Settled<R>;
}

// Classes, not object literals with getters: a context is built for every
// request, and this way it costs a few field writes, with the accessors and
// methods shared on the prototype instead of allocated per context.
class CallerHandles {
  private readonly client: SupabaseClient<Database>;
  private readonly inTransaction: boolean;

  constructor(client: SupabaseClient<Database>, inTransaction: boolean) {
    this.client = client;
    this.inTransaction = inTransaction;
  }

  get supabase() {
    if (this.inTransaction) {
      throw new Error(
        "The caller's client is not part of the transaction: use asSystem.pg"
      );
    }
    return this.client;
  }
}

class SystemHandles {
  private readonly handles: Handles;

  constructor(handles: Handles) {
    this.handles = handles;
  }

  get supabase() {
    return this.handles.system();
  }

  get pg() {
    return this.handles.pg();
  }
}

class Context implements ServiceContext {
  readonly actor: Actor;
  readonly company: { id: string; groupId: string };
  readonly asCaller: CallerHandles;
  readonly asSystem: SystemHandles;
  readonly auditUserId: string;
  /**
   * Set on the context a service function's `run` receives. A call made from
   * inside a service function was authorized by that function's gate (a
   * system-only function is still checked).
   */
  readonly nested: boolean;
  private readonly handles: Handles;
  private readonly inTransaction: boolean;

  constructor(handles: Handles, nested: boolean, inTransaction: boolean) {
    this.actor = handles.actor;
    this.company = handles.company;
    this.asCaller = new CallerHandles(handles.caller, inTransaction);
    this.asSystem = new SystemHandles(handles);
    this.auditUserId = auditUserIdOf(handles.actor);
    this.nested = nested;
    this.handles = handles;
    this.inTransaction = inTransaction;
  }

  get kv() {
    return this.handles.kv();
  }

  can(required: Permissions): boolean {
    return allows(this.actor, this.company.id, required);
  }

  inside(): Context {
    return this.nested
      ? this
      : new Context(this.handles, true, this.inTransaction);
  }

  error<C extends ErrorCategory>(
    category: C,
    message: string,
    cause?: unknown
  ): CarbonError<C> {
    return new CarbonError(category, message, cause);
  }

  async transaction<R>(
    fn: (tx: ServiceContext) => Promise<R>
  ): Promise<Settled<R>> {
    const pg = this.handles.pg();
    if (pg.isTransaction) {
      return settle(
        await fn(
          this.inTransaction
            ? this
            : new Context(this.handles, this.nested, true)
        )
      );
    }

    try {
      return settle(
        await pg.transaction().execute(async (trx) => {
          const tx = new Context(
            { ...this.handles, pg: () => trx },
            this.nested,
            true
          );
          const out = await fn(tx);
          const refusal = refusalIn(out);
          if (refusal) throw new Rollback(refusal);
          return out;
        })
      );
    } catch (err) {
      if (err instanceof Rollback) {
        return { data: null, error: err.error } as Settled<R>;
      }
      throw err;
    }
  }
}

export function createServiceContext(handles: Handles): ServiceContext {
  return new Context(handles, false, false);
}

function allows(
  actor: Actor,
  companyId: string,
  required: Permissions
): boolean {
  if (actor.type === "system") return true;
  if (required === "system") return false;
  return hasPermissions(
    actor.type === "user" ? actor.permissions : actor.scopes,
    companyId,
    required
  );
}

/** What a failure log says of the input: its keys. Values can be files, notes, emails. */
function keysOf(input: unknown): string[] | string {
  return input !== null && typeof input === "object"
    ? Object.keys(input)
    : typeof input;
}

function failed<R>(error: CarbonError) {
  return { data: null, error } as Outcome<R>;
}

type Outcome<R> = Result<
  Exclude<R, CarbonError>,
  Extract<R, CarbonError> | CarbonError<"internal" | "validation" | "forbidden">
>;

export type ServiceFn<I extends z.ZodType, R> = {
  (ctx: ServiceContext, input: z.input<I>): Promise<Outcome<R>>;
  input: I;
  permission: PermissionRule<z.output<I>>;
};

/**
 * Define an operation once: its input, who may run it, and what it does.
 *
 * `run` returns its value, or `ctx.error(...)` to refuse. Callers always get
 * `{ data, error }` and never an exception: anything `run` throws comes back
 * as an `internal` error with the detail logged and withheld.
 *
 * Every entry call is checked against `permission` for its actor. A call made
 * from inside another service function's `run` is not checked again, except
 * that a system-only function still admits only the system actor.
 */
export function defineServiceFn<I extends z.ZodType, R>(definition: {
  input: I;
  permission: PermissionRule<z.output<I>>;
  run(ctx: ServiceContext, input: z.output<I>): Promise<R>;
}): ServiceFn<I, R> {
  // Compiled on the first call, not at import: a module of service functions
  // would otherwise pay for every schema at startup, used or not.
  let schema: I | undefined;

  const call = async (
    ctx: ServiceContext,
    input: z.input<I>
  ): Promise<Outcome<R>> => {
    schema ??= z.compile(definition.input);
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return failed(
        new CarbonError("validation", z.prettifyError(parsed.error))
      );
    }

    let required: Permissions;
    try {
      required = resolvePermissions(definition.permission, parsed.data);
    } catch (err) {
      // A keyed rule with no entry for the value: bad input, not a 403.
      return failed(
        new CarbonError(
          "validation",
          err instanceof Error ? err.message : "Invalid input"
        )
      );
    }
    // A nested call was authorized by the outer function's gate, but no gate
    // admits anyone but the system to a system-only function.
    const admitted =
      ctx instanceof Context && ctx.nested
        ? required !== "system" || ctx.actor.type === "system"
        : allows(ctx.actor, ctx.company.id, required);
    if (!admitted) {
      logger.warn("Service function refused: {actor}", {
        actor: ctx.actor.type,
        companyId: ctx.company.id,
        required
      });
      return failed(
        new CarbonError("forbidden", "You do not have permission to do this")
      );
    }

    try {
      const out = await definition.run(
        ctx instanceof Context ? ctx.inside() : ctx,
        parsed.data
      );
      if (!(out instanceof CarbonError)) {
        return { data: out, error: null } as Outcome<R>;
      }
      if (out.category === "internal") {
        logger.error("Service function failed: {message}: {error}", {
          message: out.message,
          companyId: ctx.company.id,
          inputKeys: keysOf(input),
          error: out.cause
        });
      }
      return failed(out);
    } catch (err) {
      logger.error("Service function threw: {error}", {
        companyId: ctx.company.id,
        inputKeys: keysOf(input),
        error: err
      });
      return failed(new CarbonError("internal", "Something went wrong", err));
    }
  };

  return Object.assign(call, {
    input: definition.input,
    permission: definition.permission
  });
}

/** A `CarbonError` as it crosses to the client: its fields, never its cause. */
export type SerializedError<E> =
  E extends CarbonError<infer C>
    ? { category: C; message: string; status: (typeof ERROR_STATUS)[C] }
    : never;

/** A service function's result as a route sends it. */
export type RouteResult<R> = [R] extends [Result<infer T, infer E>]
  ? { data: T; error: null } | { data: null; error: SerializedError<E> }
  : never;

/**
 * The result as a route returns it. React Router replaces an `Error` instance
 * with a bare `Error` (a generic message in production), so the error goes out
 * as a plain object.
 */
export function toResult<T, E extends CarbonError>(
  result: Result<T, E>
): RouteResult<Result<T, E>> {
  if (result.error === null) return result as RouteResult<Result<T, E>>;
  const { category, message, status } = result.error;
  return {
    data: null,
    error: { category, message, status }
  } as RouteResult<Result<T, E>>;
}
