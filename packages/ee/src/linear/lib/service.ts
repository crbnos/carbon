// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncedEntities } from "../../issue-sync/entities";
import type { SyncedEntityType } from "../../issue-sync/types";
import { LinearIssueSchema } from "./types";

export async function getLinearIntegration(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return await client
    .from("companyIntegration")
    .select("*")
    .eq("companyId", companyId)
    .eq("id", "linear")
    .limit(1);
}

export const getCompanyEmployees = async (
  client: SupabaseClient<Database>,
  companyId: string,
  emails: string[]
) => {
  const users = await client
    .from("userToCompany")
    .select("userId,user!inner(email)")
    .eq("companyId", companyId)
    .eq("role", "employee")
    // Trackers keep the case a user typed; match it and its lower case.
    .in("user.email", [
      ...new Set(emails.flatMap((email) => [email, email.toLowerCase()]))
    ]);

  return users.data ?? [];
};

export async function unlinkActionFromLinearIssue(
  client: SupabaseClient<Database>,
  companyId: string,
  input: {
    entityType: SyncedEntityType;
    actionId: string;
    assignee?: string | null;
  }
) {
  const entity = syncedEntities[input.entityType];

  // Delete the Linear mapping using service role to bypass RLS
  const serviceRole = getCarbonServiceRole();
  await serviceRole
    .from("externalIntegrationMapping")
    .delete()
    .eq("companyId", companyId)
    .eq("entityType", input.entityType)
    .eq("entityId", input.actionId)
    .eq("integration", "linear");

  // Return the parent id for the action task
  return client
    .from(entity.table)
    .select(entity.parentColumn)
    .eq("companyId", companyId)
    .eq("id", input.actionId);
}

export const getLinearIssueFromExternalId = async (
  client: SupabaseClient<Database>,
  companyId: string,
  actionId: string,
  entityType: SyncedEntityType
) => {
  const { data: mapping } = await client
    .from("externalIntegrationMapping")
    .select("metadata")
    .eq("entityType", entityType)
    .eq("entityId", actionId)
    .eq("integration", "linear")
    .eq("companyId", companyId)
    .maybeSingle();

  if (!mapping) return null;

  const { data } = LinearIssueSchema.safeParse(mapping.metadata);

  if (!data) return null;

  return data;
};
