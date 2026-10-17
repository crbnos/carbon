// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ModulePermissions } from "@carbon/api/permissions";
import {
  createServiceContext,
  type ServiceContext
} from "@carbon/api/service-fn.server";
import type { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { redis } from "@carbon/kv";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDatabaseClient } from "~/services/database.server";

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

/**
 * The context for work no signed-in caller makes: a public share link, a job.
 * It runs as the system, so every query scopes by `companyId` itself, and
 * audit columns record `onBehalfOf`.
 */
export function systemContext({
  companyId,
  companyGroupId,
  onBehalfOf
}: {
  companyId: string;
  companyGroupId: string;
  onBehalfOf: string;
}): ServiceContext {
  return createServiceContext({
    actor: { type: "system", onBehalfOf },
    company: { id: companyId, groupId: companyGroupId },
    caller: getCarbonServiceRole(),
    system: getCarbonServiceRole,
    pg: getDatabaseClient,
    kv: () => redis
  });
}

/**
 * The context a public share link acts in. The link is the only credential,
 * so it runs as the system, in the record's company, on behalf of the
 * record's creator. Null when the company cannot be read.
 */
export async function shareLinkContext(record: {
  companyId: string;
  createdBy: string;
}): Promise<ServiceContext | null> {
  const company = await getCarbonServiceRole()
    .from("company")
    .select("companyGroupId")
    .eq("id", record.companyId)
    .single();
  if (!company.data?.companyGroupId) return null;
  return systemContext({
    companyId: record.companyId,
    companyGroupId: company.data.companyGroupId,
    onBehalfOf: record.createdBy
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
