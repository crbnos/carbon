// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { redis } from "@carbon/kv";
import type { ModulePermissions } from "@carbon/server-functions/permissions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDatabaseClient } from "~/services/database.server";
import { createServiceContext, type ServiceContext } from "./service-fn.server";

/** An authenticated caller, as every entry point states it. */
export type Caller = {
  kind: "user" | "apiKey";
  /** The user, or for a key its creator. */
  userId: string;
  /** The user's claims, or the key's scopes, per module. */
  permissions: ModulePermissions;
  companyId: string;
  companyGroupId: string;
  client: SupabaseClient<Database>;
};

/** The context a service function runs with for this caller. */
export function contextFor(caller: Caller): ServiceContext {
  return createServiceContext({
    actor:
      caller.kind === "apiKey"
        ? {
            type: "apiKey",
            createdBy: caller.userId,
            scopes: caller.permissions
          }
        : {
            type: "user",
            userId: caller.userId,
            permissions: caller.permissions
          },
    company: { id: caller.companyId, groupId: caller.companyGroupId },
    caller: caller.client,
    system: getCarbonServiceRole,
    pg: getDatabaseClient,
    kv: () => redis
  });
}

type Auth = Pick<
  Awaited<ReturnType<typeof requirePermissions>>,
  | "client"
  | "companyId"
  | "companyGroupId"
  | "userId"
  | "caller"
  | "permissions"
>;

/** The context for a request, built from what `requirePermissions` returned. */
export function serviceContext(auth: Auth): ServiceContext {
  return contextFor({
    // For a key, requirePermissions reports the key's creator as `userId`.
    kind: auth.caller === "apiKey" ? "apiKey" : "user",
    userId: auth.userId,
    permissions: auth.permissions,
    companyId: auth.companyId,
    companyGroupId: auth.companyGroupId,
    client: auth.client
  });
}
