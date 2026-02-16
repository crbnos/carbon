import { getCarbonServiceRole } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adfToTiptap } from "./richtext";
import type { JiraCredentials, JiraIssue, JiraIssueMapping } from "./types";
import { JiraIssueMappingSchema } from "./types";
import { mapJiraStatusToCarbonStatus } from "./utils";

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

  return await client
    .from("companyIntegration")
    .update({
      metadata: {
        ...metadata,
        credentials
      }
    })
    .eq("companyId", companyId)
    .eq("id", "jira");
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
 * Link an action task to a Jira issue.
 */
export async function linkActionToJiraIssue(
  client: SupabaseClient<Database>,
  companyId: string,
  input: {
    actionId: string;
    issue: JiraIssue;
    siteUrl: string;
    assignee?: string | null;
    syncNotes?: boolean;
  }
) {
  const mapping = issueToMapping(input.issue, input.siteUrl);

  // Convert Jira description (ADF) to Tiptap format for notes
  let notes: any = undefined;
  if (input.syncNotes && input.issue.fields.description) {
    try {
      notes = adfToTiptap(input.issue.fields.description);
    } catch (e) {
      console.error("Failed to convert Jira description to Tiptap:", e);
    }
  }

  const updateData: Record<string, any> = {
    assignee: input.assignee,
    status: mapJiraStatusToCarbonStatus(
      input.issue.fields.status.statusCategory.key
    ),
    dueDate: input.issue.fields.duedate
  };

  // Only update notes if we successfully converted the description
  if (notes !== undefined) {
    updateData.notes = notes;
  }

  // Update the task fields
  const result = await client
    .from("nonConformanceActionTask")
    .update(updateData)
    .eq("companyId", companyId)
    .eq("id", input.actionId)
    .select("nonConformanceId");

  // Delete any existing Jira mapping for this action
  await client
    .from("externalIntegrationMapping")
    .delete()
    .eq("entityType", "nonConformanceActionTask")
    .eq("entityId", input.actionId)
    .eq("integration", "jira");

  // Create the new mapping
  await client.from("externalIntegrationMapping").insert({
    entityType: "nonConformanceActionTask",
    entityId: input.actionId,
    integration: "jira",
    externalId: input.issue.id,
    metadata: mapping as any,
    companyId
  });

  return result;
}

/**
 * Unlink an action task from a Jira issue.
 */
export async function unlinkActionFromJiraIssue(
  client: SupabaseClient<Database>,
  companyId: string,
  input: {
    actionId: string;
    assignee?: string | null;
  }
) {
  // Delete the Jira mapping using service role to bypass RLS
  const serviceRole = getCarbonServiceRole();
  await serviceRole
    .from("externalIntegrationMapping")
    .delete()
    .eq("entityType", "nonConformanceActionTask")
    .eq("entityId", input.actionId)
    .eq("integration", "jira");

  // Return the nonConformanceId for the action task
  return client
    .from("nonConformanceActionTask")
    .select("nonConformanceId")
    .eq("companyId", companyId)
    .eq("id", input.actionId);
}

/**
 * Get Jira issue metadata from the external integration mapping.
 */
export const getJiraIssueFromExternalId = async (
  client: SupabaseClient<Database>,
  companyId: string,
  actionId: string
): Promise<JiraIssueMapping | null> => {
  const { data: mapping } = await client
    .from("externalIntegrationMapping")
    .select("metadata")
    .eq("entityType", "nonConformanceActionTask")
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
    .select("userId,user(email)")
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
  mapping: JiraIssueMapping
) {
  return await client
    .from("externalIntegrationMapping")
    .update({ metadata: mapping as any })
    .eq("entityType", "nonConformanceActionTask")
    .eq("entityId", actionId)
    .eq("integration", "jira")
    .eq("companyId", companyId);
}
