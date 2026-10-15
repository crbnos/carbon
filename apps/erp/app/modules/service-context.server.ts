// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { redis } from "@carbon/kv";
import { getDatabaseClient } from "~/services/database.server";
import { createServiceContext, type ServiceContext } from "./service-fn.server";

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
  return createServiceContext({
    // For a key, requirePermissions reports the key's creator as `userId`.
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
            permissions: auth.permissions
          },
    company: { id: auth.companyId, groupId: auth.companyGroupId },
    caller: auth.client,
    system: getCarbonServiceRole,
    pg: getDatabaseClient,
    kv: () => redis
  });
}
