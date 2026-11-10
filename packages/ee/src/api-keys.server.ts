// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import type { GrantInput } from "@carbon/database/access-write";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { newIds } from "@carbon/database/rows";
import { SINGLE_TENANT } from "@carbon/env";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEntitlement } from "./entitlements.server";
import { type AccessWriteError, writeAccessGrants } from "./permissions.server";

/**
 * Commercial (Business) API-key AUTHORING — creating, editing, and deleting a
 * company's public-API keys, gated to the Business plan via the `API_KEYS`
 * feature. The runtime VERIFICATION path (`@carbon/auth`
 * `api-key.server.ts` / the `api+/v1+` authenticator) is a separate concern and
 * is NOT gated here — an already-issued key keeps authenticating regardless of
 * plan.
 *
 * The key is generated and hashed in the open route action (server-only:
 * `hashApiKey` from `@carbon/auth/auth.server` + `nanoid`); this file only
 * receives the already-computed `keyHash`/`keyPreview` and stores them, so no
 * crypto crosses the package boundary.
 *
 * The entitlement LOCK lives INSIDE this commercial function (see
 * `entitlements.server`) so it cannot be stripped from open-licensed app code.
 */

/**
 * A key's requests per minute is the platform's to set on Carbon Cloud, where
 * companies share the servers. A single-tenant deployment (BYOC, self-hosted)
 * runs on its owner's servers, so its admins set it. The window is always the
 * platform's.
 */
function ownRateLimit(rateLimit: number | undefined) {
  return SINGLE_TENANT && rateLimit ? { rateLimit } : {};
}

/**
 * Create a key (`keyHash` and `keyPreview` given) or update one (`id` given),
 * and set its grants, in one transaction (`writeAccessGrants`). The key
 * itself never changes on an update. Returns the key's id.
 */
export async function saveApiKey(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  {
    companyId,
    key,
    grants,
    actorId,
    ip
  }: {
    companyId: string;
    key: { name: string; expiresAt?: string; rateLimit?: number } & (
      | { id: string }
      | { keyHash: string; keyPreview: string }
    );
    grants: readonly GrantInput[];
    actorId: string;
    ip?: string;
  }
): Promise<{ id: string | null; error: AccessWriteError | null }> {
  const fields = {
    name: key.name,
    expiresAt: key.expiresAt || null,
    ...ownRateLimit(key.rateLimit)
  };
  const id = "id" in key ? key.id : (await newIds(db, "api", 1))[0]!;
  const written = await writeAccessGrants(client, db, {
    companyId,
    subject: { apiKeyId: id },
    change: { set: grants },
    actorId,
    ip,
    subjectRow: (tx) =>
      "id" in key
        ? tx
            .updateTable("apiKey")
            .set({ ...fields, updatedBy: actorId })
            .where("id", "=", id)
            .where("companyId", "=", companyId)
            .execute()
        : tx
            .insertInto("apiKey")
            .values({
              ...fields,
              id,
              companyId,
              keyHash: key.keyHash,
              keyPreview: key.keyPreview,
              createdBy: actorId
            })
            .execute()
  });
  return written.error
    ? { id: null, error: written.error }
    : { id, error: null };
}

export async function deleteApiKey(
  client: SupabaseClient<Database>,
  id: string
) {
  // The input carries no companyId — read it from the row so the entitlement
  // check (the lock) can run before the delete.
  const existing = await client
    .from("apiKey")
    .select("companyId")
    .eq("id", id)
    .single();

  if (existing.error || !existing.data) {
    return {
      data: null,
      error: existing.error || { message: "API key not found" }
    };
  }

  await requireEntitlement(client, existing.data.companyId, "API_KEYS");
  return client.from("apiKey").delete().eq("id", id);
}
