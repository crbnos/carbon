import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { markdownToTiptap } from "./richtext";
import { LinearWorkStateType, mapLinearStatusToCarbonStatus } from "./utils";

export const LinearIssueSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  url: z.string(),
  state: z.object({
    name: z.string(),
    color: z.string(),
    type: z.nativeEnum(LinearWorkStateType)
  }),
  identifier: z.string(),
  dueDate: z.string().nullish(),
  assignee: z
    .object({
      email: z.string()
    })
    .nullish()
});

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
    actionId: string;
    issue: z.infer<typeof LinearIssueSchema>;
    assignee?: string | null;
    syncNotes?: boolean;
  }
) {
  const { data, success } = LinearIssueSchema.safeParse(input.issue);

  if (!success) return null;

  // Convert Linear description (markdown) to Tiptap format for notes
  let notes: any = undefined;
  if (input.syncNotes && data.description) {
    try {
      notes = markdownToTiptap(data.description);
    } catch (e) {
      console.error("Failed to convert Linear description to Tiptap:", e);
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
    .from("nonConformanceActionTask")
    .update(updateData)
    .eq("companyId", companyId)
    .eq("id", input.actionId)
    .select("nonConformanceId");

  // Upsert the Linear mapping in externalIntegrationMapping
  await client
    .from("externalIntegrationMapping")
    .delete()
    .eq("entityType", "nonConformanceActionTask")
    .eq("entityId", input.actionId)
    .eq("integration", "linear");

  await client.from("externalIntegrationMapping").insert({
    entityType: "nonConformanceActionTask",
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
    actionId: string;
    assignee?: string | null;
  }
) {
  // Delete the Linear mapping from externalIntegrationMapping
  await client
    .from("externalIntegrationMapping")
    .delete()
    .eq("entityType", "nonConformanceActionTask")
    .eq("entityId", input.actionId)
    .eq("integration", "linear");

  // Return the nonConformanceId for the action task
  return client
    .from("nonConformanceActionTask")
    .select("nonConformanceId")
    .eq("companyId", companyId)
    .eq("id", input.actionId);
}

export const getLinearIssueFromExternalId = async (
  client: SupabaseClient<Database>,
  companyId: string,
  actionId: string
) => {
  const { data: mapping } = await client
    .from("externalIntegrationMapping")
    .select("metadata")
    .eq("entityType", "nonConformanceActionTask")
    .eq("entityId", actionId)
    .eq("integration", "linear")
    .eq("companyId", companyId)
    .maybeSingle();

  if (!mapping) return null;

  const { data } = LinearIssueSchema.safeParse(mapping.metadata);

  if (!data) return null;

  return data;
};
