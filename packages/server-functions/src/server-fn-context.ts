import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Kysely, sql } from "kysely";
import { ForbiddenError } from "./errors";
import {
  hasPermissions,
  permissionsFromClaims,
  type RequiredPermissions
} from "./permissions";

let serviceRole: Promise<SupabaseClient<Database>> | undefined;

/**
 * The service-role client, built once per process. Built here rather than
 * passed in: callers include browser-bundled `*.service.ts` files, which cannot
 * import `@carbon/auth`'s `.server` factory. Lazy because `@carbon/env` throws
 * at import when a required variable is unset.
 */
function serviceRoleClient(): Promise<SupabaseClient<Database>> {
  serviceRole ??= Promise.all([
    import("@carbon/auth"),
    import("@carbon/env")
  ]).then(([{ getCarbonClient }, { SUPABASE_SERVICE_ROLE_KEY }]) =>
    getCarbonClient(SUPABASE_SERVICE_ROLE_KEY!)
  );
  return serviceRole;
}

/** Whether `client` was built with `key` (supabase-js keeps it on the instance). */
export function clientUsesKey(
  client: SupabaseClient<Database>,
  key: string | undefined
): boolean {
  return (
    !!key && (client as unknown as { supabaseKey?: string }).supabaseKey === key
  );
}

async function isServiceRoleClient(
  client: SupabaseClient<Database>
): Promise<boolean> {
  const { SUPABASE_SERVICE_ROLE_KEY } = await import("@carbon/env");
  return clientUsesKey(client, SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Who a server function runs for. `system` is a server-side caller with no
 * signed-in user behind it (an Inngest job, an accounting syncer, a route that
 * holds the service role) and skips permission checks; `user` is always
 * checked. Never derive it from request input.
 */
export type Actor = "system" | "user";

type ContextFields = {
  db: Kysely<KyselyDatabase>;
  companyId: string;
  /** Recorded on every write (`createdBy`, `updatedBy`), system or not. */
  userId: string;
};

/**
 * Everything a server function runs with. Built only through the named
 * constructors, so where the system acts is greppable: `ServerFnContext.system`.
 */
export class ServerFnContext {
  readonly db: Kysely<KyselyDatabase>;
  readonly companyId: string;
  readonly userId: string;
  readonly actor: Actor;

  private constructor(fields: ContextFields, actor: Actor) {
    this.db = fields.db;
    this.companyId = fields.companyId;
    this.userId = fields.userId;
    this.actor = actor;
  }

  static system(fields: ContextFields): ServerFnContext {
    return new ServerFnContext(fields, "system");
  }

  static user(fields: ContextFields): ServerFnContext {
    return new ServerFnContext(fields, "user");
  }

  /**
   * For code that received its caller's Supabase client: the service-role key
   * makes the caller the system, any other key a user. Never replace this with
   * a flag the caller passes: /api/v1 fills unknown parameters from the body.
   */
  static async fromClient(
    client: SupabaseClient<Database>,
    fields: ContextFields
  ): Promise<ServerFnContext> {
    return new ServerFnContext(
      fields,
      (await isServiceRoleClient(client)) ? "system" : "user"
    );
  }

  get isSystem(): boolean {
    return this.actor === "system";
  }

  /** The service-role client every server function reads and writes with. */
  supabase(): Promise<SupabaseClient<Database>> {
    return serviceRoleClient();
  }
}

/** What a server function requires of its caller. */
export type Permissions = RequiredPermissions | "system";

/**
 * Throws `ForbiddenError` unless the context may run a function requiring
 * `required`. The system passes everything; a user needs the claims, read with
 * `get_claims` over the context's own database.
 */
export async function authorize(
  ctx: ServerFnContext,
  required: Permissions
): Promise<void> {
  if (ctx.isSystem) return;
  if (required === "system") {
    throw new ForbiddenError("Only server-side callers may run this");
  }
  const { rows } = await sql<{
    claims: Record<string, unknown> | null;
  }>`SELECT get_claims(${ctx.userId}, ${ctx.companyId}) AS claims`.execute(
    ctx.db
  );
  const permissions = permissionsFromClaims(rows[0]?.claims ?? {});
  if (!hasPermissions(permissions, ctx.companyId, required)) {
    throw new ForbiddenError();
  }
}
