import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import type z from "zod";
import type { ActionTaskEntityType } from "../../lib/actionTaskEntity";
import { actionTaskEntities } from "../../lib/actionTaskEntity";
import { markdownToTiptap } from "./richtext";
import { LinearIssueSchema } from "./types";
import { mapLinearStatusToCarbonStatus } from "./utils";

const logger = getLogger("ee", "linear");

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

export async function linkActionToLinearIssue(
  client: SupabaseClient<Database>,
  companyId: string,
  input: {
    entityType: ActionTaskEntityType;
    actionId: string;
    issue: z.infer<typeof LinearIssueSchema>;
    assignee?: string | null;
    syncNotes?: boolean;
  }
) {
  const entity = actionTaskEntities[input.entityType];
  const { data, success } = LinearIssueSchema.safeParse(input.issue);

  if (!success) return null;

  // Convert Linear description (markdown) to Tiptap format for notes
  let notes: any = undefined;
  if (input.syncNotes && data.description) {
    try {
      notes = markdownToTiptap(data.description);
    } catch (e) {
      logger.error("Failed to convert Linear description to Tiptap", {
        error: e
      });
    }
  }

  const updateData: Record<string, any> = {
    assignee: input.assignee,
    status: mapLinearStatusToCarbonStatus(data.state.type!),
    dueDate: data.dueDate
  };

  // Only update notes if we successfully converted the description
  if (notes !== undefined) {
    updateData.notes = notes;
  }

  // Update the task fields
  const result = await client
    .from(entity.table)
    .update(updateData)
    .eq("companyId", companyId)
    .eq("id", input.actionId)
    .select(entity.parentColumn);

  // Upsert the Linear mapping in externalIntegrationMapping
  // Use service role to bypass RLS (no DELETE policy for authenticated users)
  const serviceRoleForLink = getCarbonServiceRole();
  await serviceRoleForLink
    .from("externalIntegrationMapping")
    .delete()
    .eq("companyId", companyId)
    .eq("entityType", input.entityType)
    .eq("entityId", input.actionId)
    .eq("integration", "linear");

  await client.from("externalIntegrationMapping").insert({
    entityType: input.entityType,
    entityId: input.actionId,
    integration: "linear",
    externalId: data.id,
    metadata: data as any,
    companyId
  });

  return result;
}

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

export async function unlinkActionFromLinearIssue(
  client: SupabaseClient<Database>,
  companyId: string,
  input: {
    entityType: ActionTaskEntityType;
    actionId: string;
    assignee?: string | null;
  }
) {
  const entity = actionTaskEntities[input.entityType];

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
  entityType: ActionTaskEntityType
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
