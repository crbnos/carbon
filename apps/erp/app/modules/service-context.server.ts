// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  createServiceContext,
  type ServiceContext
} from "@carbon/api/service-fn.server";
import type { CallerAuth } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { redis } from "@carbon/kv";
import { getDatabaseClient } from "~/services/database.server";

/**
 * The context a service function runs with for a caller `authorize` resolved
 * (or the v1 API, the same way): the user with their claims and role, or the
 * API key with its grants and its creator as the audit user.
 */
export function serviceContext(auth: CallerAuth): ServiceContext {
  return createServiceContext({
    actor:
      auth.caller === "apiKey"
        ? {
            type: "apiKey",
            createdBy: auth.userId,
            scopes: auth.permissions
          }
        : {
            type: "user",
            userId: auth.userId,
            permissions: auth.permissions,
            role: auth.role
          },
    company: { id: auth.companyId, groupId: auth.companyGroupId },
    caller: auth.client,
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
