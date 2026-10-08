// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { redis } from "@carbon/kv";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDatabaseClient } from "~/services/database.server";
import { createServiceContext, type ServiceContext } from "./service-fn.server";

/**
 * The context a route hands to a service function, built from what
 * `requirePermissions` returned for this request.
 */
export function serviceContext(
  request: Request,
  auth: {
    client: SupabaseClient<Database>;
    companyId: string;
    companyGroupId: string;
    userId: string;
  }
): ServiceContext {
  return createServiceContext({
    // requirePermissions takes the key branch on this header, and reports the
    // key's creator as `userId`.
    actor: request.headers.has("carbon-key")
      ? { type: "apiKey", createdBy: auth.userId }
      : { type: "user", userId: auth.userId },
    company: { id: auth.companyId, groupId: auth.companyGroupId },
    caller: auth.client,
    system: getCarbonServiceRole,
    pg: getDatabaseClient,
    kv: () => redis
  });
}
