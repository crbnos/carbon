// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
  serviceRole ??= Promise.all([import("@carbon/auth"), import("@carbon/env")])
    .then(([{ getCarbonClient }, { SUPABASE_SERVICE_ROLE_KEY }]) =>
      getCarbonClient(SUPABASE_SERVICE_ROLE_KEY!)
    )
    .catch((err) => {
      // A failed first build must not poison every later call.
      serviceRole = undefined;
      throw err;
    });
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

/** The `sub` of a `Bearer` JWT, unverified: the token is on a client this
 *  process built from its own session, not on request input. */
function bearerSubject(authorization: string | undefined): string | undefined {
  const payload = authorization?.replace(/^Bearer\s+/i, "").split(".")[1];
  if (!payload) return undefined;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
  } catch {
    return undefined;
  }
}

/**
 * Who a server function runs for. `system` is a server-side caller with no
 * signed-in user behind it (an Inngest job, an accounting syncer, a route that
 * holds the service role) and skips permission checks; `user` is checked
 * against the user's claims, `apiKey` against the key's own scopes (never its
 * creator's permissions). Never derive it from request input.
 */
export type Actor = "system" | "user" | "apiKey";

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
  /** The raw `carbon-key`, when `actor` is `apiKey`. */
  readonly apiKey: string | undefined;

  private constructor(fields: ContextFields, actor: Actor, apiKey?: string) {
    this.db = fields.db;
    this.companyId = fields.companyId;
    this.userId = fields.userId;
    this.actor = actor;
    this.apiKey = apiKey;
  }

  static system(fields: ContextFields): ServerFnContext {
    return new ServerFnContext(fields, "system");
  }

  static user(fields: ContextFields): ServerFnContext {
    return new ServerFnContext(fields, "user");
  }

  /**
   * For code that received its caller's Supabase client: a `carbon-key` header
   * makes the caller that API key, the service-role key the system, and a
   * user's token that user — who must be `fields.userId`, since permissions
   * are read for it. Never replace this with a flag the caller passes: /api/v1
   * fills unknown parameters from the body.
   */
  static async fromClient(
    client: SupabaseClient<Database>,
    fields: ContextFields
  ): Promise<ServerFnContext> {
    const headers =
      (client as unknown as { headers?: Record<string, string> }).headers ?? {};
    const apiKey = headers["carbon-key"];
    if (apiKey) return new ServerFnContext(fields, "apiKey", apiKey);
    if (await isServiceRoleClient(client)) {
      return new ServerFnContext(fields, "system");
    }
    if (bearerSubject(headers.Authorization) !== fields.userId) {
      throw new ForbiddenError("userId does not match the signed-in user");
    }
    return new ServerFnContext(fields, "user");
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
 * `get_claims` over the context's own database; an API key needs its scopes.
 */
export async function authorize(
  ctx: ServerFnContext,
  required: Permissions
): Promise<void> {
  if (ctx.isSystem) return;
  if (required === "system") {
    throw new ForbiddenError("Only server-side callers may run this");
  }
  if (ctx.actor === "apiKey") return authorizeApiKey(ctx, required);
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

/** A key of this company, unexpired, whose scopes (`<module>_<action>` →
 *  company ids, shaped like claims) cover `required`. Rate limiting stays with
 *  the route that authenticated the key. */
async function authorizeApiKey(
  ctx: ServerFnContext,
  required: RequiredPermissions
): Promise<void> {
  const key = await ctx.db
    .selectFrom("apiKey")
    .select("scopes")
    .where(
      "keyHash",
      "=",
      sql<string>`encode(sha256(convert_to(${ctx.apiKey}, 'UTF8')), 'hex')`
    )
    .where("companyId", "=", ctx.companyId)
    .where((eb) =>
      eb.or([
        eb("expiresAt", "is", null),
        eb("expiresAt", ">", sql<string>`now()`)
      ])
    )
    .executeTakeFirst();
  if (!key) throw new ForbiddenError("Invalid API key");
  if (Object.keys(required).length === 0) return;
  const scopes = permissionsFromClaims(
    (key.scopes ?? {}) as Record<string, unknown>
  );
  if (!hasPermissions(scopes, ctx.companyId, required)) {
    throw new ForbiddenError("API key lacks required permissions");
  }
}
