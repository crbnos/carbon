// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getPermissionCacheKey } from "@carbon/auth";
import { bustApiKeyCache } from "@carbon/auth/auth.server";
import type { KyselyDatabase } from "@carbon/database/client";
import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { chunkArray } from "@carbon/utils";
import type { Kysely } from "kysely";

const log = getLogger("jobs", "backup-access-cache");

const DEL_CHUNK = 500;

/**
 * Drop the cached claims of every member of the company and the cached record
 * of every API key it owns. A restore or an import writes the rows those caches
 * were built from with triggers off, so without this the app would keep
 * answering from the old access while RLS answers from the new rows.
 * Best-effort: a cache failure never fails the restore (entries expire anyway).
 */
export async function clearCompanyAccessCaches(
  db: Kysely<KyselyDatabase>,
  companyId: string
): Promise<void> {
  try {
    const [members, keys] = await Promise.all([
      db
        .selectFrom("userToCompany")
        .select("userId")
        .where("companyId", "=", companyId)
        .execute(),
      db
        .selectFrom("apiKey")
        .select("keyHash")
        .where("companyId", "=", companyId)
        .execute()
    ]);
    for (const batch of chunkArray(members, DEL_CHUNK)) {
      await redis.del(...batch.map((m) => getPermissionCacheKey(m.userId)));
    }
    await Promise.all(keys.map((k) => bustApiKeyCache(k.keyHash)));
  } catch (error) {
    log.error("Failed to clear the company's access caches", {
      companyId,
      error
    });
  }
}
