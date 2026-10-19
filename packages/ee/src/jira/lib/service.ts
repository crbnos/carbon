// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { persistIntegrationSecrets } from "../../integrations/secrets";
import { syncedEntities } from "../../issue-sync/entities";
import type { SyncedEntityType } from "../../issue-sync/types";
import type { JiraCredentials, JiraIssue, JiraIssueMapping } from "./types";
import { JiraIssueMappingSchema } from "./types";

/**
 * Get the Jira integration for a company.
 */
export async function getJiraIntegration(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return await client
    .from("companyIntegration")
    .select("*")
    .eq("companyId", companyId)
    .eq("id", "jira")
    .limit(1);
}

/**
 * Update Jira credentials in the integration metadata.
 */
export async function updateJiraCredentials(
  client: SupabaseClient<Database>,
  companyId: string,
  credentials: JiraCredentials
) {
  const { data: current } = await getJiraIntegration(client, companyId);
  const integration = current?.[0];

  if (!integration) {
    throw new Error("Jira integration not found");
  }

  const metadata = integration.metadata as Record<string, any>;

  // Secret material (accessToken/refreshToken) is split out to Supabase Vault;
  // only the non-secret config is written back to the metadata column. Requires
  // the service-role client (the caller passes one).
  return await persistIntegrationSecrets(client, companyId, "jira", {
    ...metadata,
    credentials
  });
}

/**
 * Convert a Jira issue to the mapping format for storage.
 */
export function issueToMapping(
  issue: JiraIssue,
  siteUrl: string
): JiraIssueMapping {
  return {
    id: issue.id,
    key: issue.key,
    summary: issue.fields.summary,
    url: `${siteUrl}/browse/${issue.key}`,
    status: {
      name: issue.fields.status.name,
      category: issue.fields.status.statusCategory.key
    },
    assignee: issue.fields.assignee
      ? {
          emailAddress: issue.fields.assignee.emailAddress,
          displayName: issue.fields.assignee.displayName
        }
      : null
  };
}

/**
 * Unlink an action task from a Jira issue.
 */
export async function unlinkActionFromJiraIssue(
  client: SupabaseClient<Database>,
  companyId: string,
  input: {
    entityType: SyncedEntityType;
    actionId: string;
    assignee?: string | null;
  }
) {
  const entity = syncedEntities[input.entityType];

  // Delete the Jira mapping using service role to bypass RLS
  const serviceRole = getCarbonServiceRole();
  await serviceRole
    .from("externalIntegrationMapping")
    .delete()
    .eq("companyId", companyId)
    .eq("entityType", input.entityType)
    .eq("entityId", input.actionId)
    .eq("integration", "jira");

  // Return the parent id for the action task
  return client
    .from(entity.table)
    .select(entity.parentColumn)
    .eq("companyId", companyId)
    .eq("id", input.actionId);
}

/**
 * Get Jira issue metadata from the external integration mapping.
 */
export const getJiraIssueFromExternalId = async (
  client: SupabaseClient<Database>,
  companyId: string,
  actionId: string,
  entityType: SyncedEntityType
): Promise<JiraIssueMapping | null> => {
  const { data: mapping } = await client
    .from("externalIntegrationMapping")
    .select("metadata")
    .eq("entityType", entityType)
    .eq("entityId", actionId)
    .eq("integration", "jira")
    .eq("companyId", companyId)
    .maybeSingle();

  if (!mapping) return null;

  const { data } = JiraIssueMappingSchema.safeParse(mapping.metadata);

  if (!data) return null;

  return data;
};

/**
 * Get employees that match email addresses.
 */
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
    .in("user.email", emails);

  return users.data ?? [];
};

/**
 * Update the cached Jira issue metadata in the mapping.
 */
export async function updateJiraIssueMapping(
  client: SupabaseClient<Database>,
  companyId: string,
  actionId: string,
  mapping: JiraIssueMapping,
  entityType: SyncedEntityType
) {
  return await client
    .from("externalIntegrationMapping")
    .update({ metadata: mapping as any })
    .eq("entityType", entityType)
    .eq("entityId", actionId)
    .eq("integration", "jira")
    .eq("companyId", companyId);
}
