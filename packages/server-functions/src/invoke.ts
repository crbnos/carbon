// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Types only at module scope: browser-bundled `*.service.ts` files import this
// statically, and everything it runs is loaded on first use.
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreateInput, CreateResultFor } from "./create";
import type { ServerFnResult } from "./define-server-fn";
import type { ServerFnError } from "./errors";
import type { ServerFnContext } from "./server-fn-context";

const registry = {
  "assign-serial-numbers": () => import("./assign-serial-numbers"),
  "batch-operations": () => import("./batch-operations"),
  "close-job": () => import("./close-job"),
  convert: () => import("./convert"),
  "correct-stock-movement": () => import("./correct-stock-movement"),
  create: () => import("./create"),
  "finalize-purchasing-rfq": () => import("./finalize-purchasing-rfq"),
  "finalize-supplier-quote": () => import("./finalize-supplier-quote"),
  "get-method": () => import("./get-method"),
  "import-csv": () => import("./import-csv"),
  issue: () => import("./issue"),
  "post-charge": () => import("./post-charge"),
  "post-inventory-adjustment": () => import("./post-inventory-adjustment"),
  "post-inventory-count": () => import("./post-inventory-count"),
  "post-maintenance-event": () => import("./post-maintenance-event"),
  "post-memo": () => import("./post-memo"),
  "post-nonconformance": () => import("./post-nonconformance"),
  "post-payment": () => import("./post-payment"),
  "post-picking": () => import("./post-picking"),
  "post-production-event": () => import("./post-production-event"),
  "post-purchase-invoice": () => import("./post-purchase-invoice"),
  "post-receipt": () => import("./post-receipt"),
  "post-reimbursement": () => import("./post-reimbursement"),
  "post-sales-invoice": () => import("./post-sales-invoice"),
  "post-shipment": () => import("./post-shipment"),
  "post-stock-transfer": () => import("./post-stock-transfer"),
  recalculate: () => import("./recalculate"),
  reschedule: () => import("./reschedule"),
  "seed-company": () => import("./seed-company"),
  sync: () => import("./sync"),
  "trigger-rework": () => import("./trigger-rework"),
  "update-purchased-prices": () => import("./update-purchased-prices")
} as const;

export type ServerFnName = keyof typeof registry;
export const serverFnNames = Object.keys(registry) as ServerFnName[];
type Fn<N extends ServerFnName> = Awaited<
  ReturnType<(typeof registry)[N]>
>["default"];
export type ServerFnInput<N extends ServerFnName> = Parameters<Fn<N>>[1];
type Result<N extends ServerFnName> = Awaited<ReturnType<Fn<N>>>;
type Data<R> = R extends { data: infer D; error: null } ? D : never;

type Fields = {
  db: Kysely<KyselyDatabase>;
  companyId: string;
  /** Recorded on every write (`createdBy`, `updatedBy`). */
  userId: string;
};

class Invoker {
  constructor(private readonly context: () => Promise<ServerFnContext>) {}

  /** Runs the named server function. Never throws: `{ data, error }`. */
  invoke<I extends CreateInput>(
    name: "create",
    input: I
  ): Promise<ServerFnResult<CreateResultFor<I["type"]>>>;
  invoke<N extends ServerFnName>(
    name: N,
    input: ServerFnInput<N>
  ): Promise<Result<N>>;
  async invoke(name: ServerFnName, input: unknown): Promise<unknown> {
    try {
      const ctx = await this.context();
      const fn = (await registry[name]()).default as unknown as (
        ctx: ServerFnContext,
        input: unknown
      ) => Promise<unknown>;
      return await fn(ctx, input);
    } catch (err) {
      const { toServerFnError } = await import("./errors");
      return { data: null, error: toServerFnError(name, err) };
    }
  }

  /** The same, throwing the `ServerFnError` — for a job step, where a throw retries. */
  invokeOrThrow<I extends CreateInput>(
    name: "create",
    input: I
  ): Promise<CreateResultFor<I["type"]>>;
  invokeOrThrow<N extends ServerFnName>(
    name: N,
    input: ServerFnInput<N>
  ): Promise<Data<Result<N>>>;
  async invokeOrThrow(name: ServerFnName, input: unknown): Promise<unknown> {
    const result = (await this.invoke(name, input as never)) as {
      data: unknown;
      error: ServerFnError | null;
    };
    if (result.error) throw result.error;
    return result.data;
  }
}

export type { Invoker as ServerFnInvoker };

export const serverFns = {
  /** A server-side caller with no permission check: a job, a syncer, a route
   *  that has already authorized the request. */
  system(fields: Fields): Invoker {
    return new Invoker(async () => {
      const { ServerFnContext } = await import("./server-fn-context");
      return ServerFnContext.system(fields);
    });
  },
  /** The caller behind `client`: an API key, the signed-in user (checked
   *  against the function's permissions), or the service role (the system). */
  as(caller: Fields & { client: SupabaseClient<Database> }): Invoker {
    const { client, ...fields } = caller;
    return new Invoker(async () => {
      const { ServerFnContext } = await import("./server-fn-context");
      return ServerFnContext.fromClient(client, fields);
    });
  }
};
