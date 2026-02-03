import type { Database } from "@carbon/database";
import { getPurchaseOrderStatus, supportedModelTypes } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FunctionRegion } from "@supabase/supabase-js";
import { getPurchaseOrderLines } from "~/modules/purchasing";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type { approvalDocumentType, documentTypes } from "./shared.models";
import type {
  ApprovalFilters,
  ApprovalRequestForApproveCheck,
  ApprovalRequestForCancelCheck,
  ApprovalRequestForViewCheck,
  ApprovalRule,
  CreateApprovalRequestInput,
  UpsertApprovalRuleInput
} from "./types";

export async function approveRequest(
  client: SupabaseClient<Database>,
  id: string,
  userId: string,
  notes?: string
) {
  const approvalRequest = await client
    .from("approvalRequest")
    .select("id, status, documentType, documentId, companyId")
    .eq("id", id)
    .single();

  if (approvalRequest.error || !approvalRequest.data) {
    return { error: { message: "Approval request not found" }, data: null };
  }

  if (approvalRequest.data.status !== "Pending") {
    return {
      error: { message: "Approval request is not pending" },
      data: null
    };
  }

  const approvalUpdate = await client
    .from("approvalRequest")
    .update({
      status: "Approved",
      decisionBy: userId,
      decisionAt: new Date().toISOString(),
      decisionNotes: notes || null,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select("id, documentType, documentId")
    .single();

  if (approvalUpdate.error) {
    return { error: approvalUpdate.error, data: null };
  }

  if (approvalUpdate.data) {
    const { documentType, documentId } = approvalUpdate.data;

    if (documentType === "purchaseOrder") {
      const lines = await getPurchaseOrderLines(client, documentId);
      const { status: calculatedStatus } = getPurchaseOrderStatus(
        lines.data || []
      );

      const statusUpdate = await client
        .from("purchaseOrder")
        .update({
          status: calculatedStatus,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .eq("id", documentId)
        .eq("status", "Needs Approval")
        .select("id")
        .single();

      if (statusUpdate.error) {
        console.warn(
          `Failed to update PO ${documentId} status after approval:`,
          statusUpdate.error
        );
      }
    } else if (documentType === "qualityDocument") {
      await client
        .from("qualityDocument")
        .update({
          status: "Active",
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .eq("id", documentId);
    }
  }

  return approvalUpdate;
}

export async function canApproveRequest(
  client: SupabaseClient<Database>,
  approvalRequest: ApprovalRequestForApproveCheck,
  userId: string
): Promise<boolean> {
  const rules = await getApprovalRulesForApprover(
    client,
    approvalRequest.documentType,
    approvalRequest.companyId
  );

  if (!rules.data || rules.data.length === 0) {
    return false;
  }

  const userGroups = await client.rpc("groups_for_user", { uid: userId });
  const userGroupIds = userGroups.data || [];

  // Check if user can approve via any rule (higher amount approvers can approve lower amounts)
  return rules.data.some((rule) => {
    if (rule.defaultApproverId === userId) {
      return true;
    }

    const approverGroupIds = rule.approverGroupIds;
    if (!approverGroupIds || approverGroupIds.length === 0) {
      return false;
    }

    return approverGroupIds.some((groupId) => userGroupIds.includes(groupId));
  });
}

/**
 * Checks if a user can approve a request based on the specific rule matching the amount.
 * This is the original approval check logic - user must be on the rule that matches the amount.
 * Used for "Assigned to Me" lists.
 */
export async function canApproveRequestInWindow(
  client: SupabaseClient<Database>,
  approvalRequest: ApprovalRequestForApproveCheck,
  userId: string
): Promise<boolean> {
  const rule = await getApprovalRuleByAmount(
    client,
    approvalRequest.documentType,
    approvalRequest.companyId,
    approvalRequest.amount ?? undefined
  );

  if (!rule.data) {
    return false;
  }

  if (rule.data.defaultApproverId === userId) {
    return true;
  }

  const approverGroupIds = rule.data.approverGroupIds;
  if (!approverGroupIds || approverGroupIds.length === 0) {
    return false;
  }

  const userGroups = await client.rpc("groups_for_user", { uid: userId });
  const userGroupIds = userGroups.data || [];
  return approverGroupIds.some((groupId) => userGroupIds.includes(groupId));
}

export function canCancelRequest(
  approvalRequest: ApprovalRequestForCancelCheck,
  userId: string
): boolean {
  return (
    approvalRequest.requestedBy === userId &&
    approvalRequest.status === "Pending"
  );
}

export async function cancelApprovalRequest(
  client: SupabaseClient<Database>,
  id: string,
  userId: string
) {
  const existing = await client
    .from("approvalRequest")
    .select("id, status, requestedBy")
    .eq("id", id)
    .single();

  if (existing.error || !existing.data) {
    return { error: { message: "Approval request not found" }, data: null };
  }

  if (existing.data.status !== "Pending") {
    return {
      error: { message: "Approval request is not pending" },
      data: null
    };
  }

  if (existing.data.requestedBy !== userId) {
    return {
      error: { message: "Only the requester can cancel an approval request" },
      data: null
    };
  }

  return client
    .from("approvalRequest")
    .update({
      status: "Cancelled",
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select("id")
    .single();
}

export async function canViewApprovalRequest(
  client: SupabaseClient<Database>,
  approvalRequest: ApprovalRequestForViewCheck,
  userId: string
): Promise<boolean> {
  if (approvalRequest.requestedBy === userId) {
    return true;
  }

  return canApproveRequest(
    client,
    {
      amount: approvalRequest.amount,
      documentType: approvalRequest.documentType,
      companyId: approvalRequest.companyId
    },
    userId
  );
}

export async function createApprovalRequest(
  client: SupabaseClient<Database>,
  request: CreateApprovalRequestInput & { amount?: number }
) {
  return client
    .from("approvalRequest")
    .insert([
      {
        documentType: request.documentType,
        documentId: request.documentId,
        requestedBy: request.requestedBy,
        amount: request.amount ?? null,
        companyId: request.companyId,
        createdBy: request.createdBy
      }
    ])
    .select("id")
    .single();
}

export async function deleteApprovalRule(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("approvalRule")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

export async function deleteNote(
  client: SupabaseClient<Database>,
  noteId: string
) {
  return client.from("note").update({ active: false }).eq("id", noteId);
}

export async function deleteSavedView(
  client: SupabaseClient<Database>,
  viewId: string
) {
  return client.from("tableView").delete().eq("id", viewId);
}

export async function generateEmbedding(
  client: SupabaseClient<Database>,
  text: string
): Promise<number[]> {
  const response = await client.functions.invoke("embedding", {
    body: { text },
    region: FunctionRegion.UsEast1
  });

  if (response.error) {
    throw new Error(
      `Failed to generate embedding: ${
        response.error.message || "Unknown error"
      }`
    );
  }

  if (!response.data?.embedding) {
    throw new Error("No embedding returned from function");
  }

  return response.data.embedding as number[];
}

export async function getApprovalById(
  client: SupabaseClient<Database>,
  id: string
) {
  const baseRequest = await client
    .from("approvalRequest")
    .select("*")
    .eq("id", id)
    .single();

  if (baseRequest.error || !baseRequest.data) {
    return baseRequest;
  }

  const viewData = await client
    .from("approvalRequests")
    .select("documentReadableId, documentDescription")
    .eq("id", id)
    .single();

  return {
    data: {
      ...baseRequest.data,
      documentReadableId: viewData.data?.documentReadableId ?? null,
      documentDescription: viewData.data?.documentDescription ?? null
    },
    error: null
  };
}

export async function getApprovalRequestsByDocument(
  client: SupabaseClient<Database>,
  documentType: (typeof approvalDocumentType)[number],
  documentId: string
) {
  return client
    .from("approvalRequests")
    .select("*")
    .eq("documentType", documentType)
    .eq("documentId", documentId)
    .order("requestedAt", { ascending: false });
}

export async function getApprovalRuleByAmount(
  client: SupabaseClient<Database>,
  documentType: (typeof approvalDocumentType)[number],
  companyId: string,
  amount?: number
) {
  let query = client
    .from("approvalRule")
    .select("*")
    .eq("documentType", documentType)
    .eq("companyId", companyId)
    .eq("enabled", true);

  if (amount !== undefined && amount !== null) {
    query = query.lte("lowerBoundAmount", amount);
  } else {
    query = query.eq("lowerBoundAmount", 0);
  }

  return query
    .order("lowerBoundAmount", { ascending: false })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
}

export async function getApproverUserIdsForRule(
  client: SupabaseClient<Database>,
  rule: Pick<ApprovalRule, "approverGroupIds" | "defaultApproverId">
): Promise<string[]> {
  const groupIds = rule.approverGroupIds?.filter(Boolean) ?? [];
  const defaultId = rule.defaultApproverId ?? null;

  const fromGroups =
    groupIds.length > 0
      ? await client.rpc("users_for_groups", { groups: groupIds })
      : { data: [] as string[], error: null };

  if (fromGroups.error) {
    console.error(
      "getApproverUserIdsForRule: users_for_groups failed",
      fromGroups.error
    );
    return defaultId ? [defaultId] : [];
  }

  const ids = Array.isArray(fromGroups.data)
    ? (fromGroups.data as string[])
    : [];
  const combined = defaultId
    ? [...new Set([...ids, defaultId])]
    : [...new Set(ids)];
  return combined;
}

export async function getApprovalRuleById(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("approvalRule")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function getApprovalRules(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client.from("approvalRule").select("*").eq("companyId", companyId);
}

export async function getApprovalRulesForApprover(
  client: SupabaseClient<Database>,
  documentType: (typeof approvalDocumentType)[number],
  companyId: string
) {
  return client
    .from("approvalRule")
    .select("*")
    .eq("documentType", documentType)
    .eq("companyId", companyId)
    .eq("enabled", true)
    .order("lowerBoundAmount", { ascending: false });
}

export async function getApprovalsForUser(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string,
  args?: GenericQueryFilters & ApprovalFilters
) {
  let query = client
    .from("approvalRequest")
    .select("*", { count: "exact" })
    .eq("companyId", companyId)
    .eq("requestedBy", userId);

  if (args?.documentType) {
    query = query.eq("documentType", args.documentType);
  }

  if (args?.status) {
    query = query.eq("status", args.status);
  }

  if (args?.dateFrom) {
    query = query.gte("requestedAt", args.dateFrom);
  }
  if (args?.dateTo) {
    query = query.lte("requestedAt", args.dateTo);
  }

  const requestedByUserBase = await query;

  // Get readable fields from view for requestedByUser
  const requestedByUser = await Promise.all(
    (requestedByUserBase.data || []).map(async (approval) => {
      const viewData = await client
        .from("approvalRequests")
        .select("documentReadableId, documentDescription")
        .eq("id", approval.id)
        .single();

      return {
        ...approval,
        documentReadableId: viewData.data?.documentReadableId ?? null,
        documentDescription: viewData.data?.documentDescription ?? null
      };
    })
  );

  let pendingQuery = client
    .from("approvalRequest")
    .select("*")
    .eq("companyId", companyId)
    .eq("status", "Pending")
    .neq("requestedBy", userId);

  if (args?.documentType) {
    pendingQuery = pendingQuery.eq("documentType", args.documentType);
  }

  if (args?.dateFrom) {
    pendingQuery = pendingQuery.gte("requestedAt", args.dateFrom);
  }
  if (args?.dateTo) {
    pendingQuery = pendingQuery.lte("requestedAt", args.dateTo);
  }

  const allPending = await pendingQuery;

  const pendingWithReadableFields = await Promise.all(
    (allPending.data || []).map(async (approval) => {
      const viewData = await client
        .from("approvalRequests")
        .select("documentReadableId, documentDescription")
        .eq("id", approval.id)
        .single();

      return {
        ...approval,
        documentReadableId: viewData.data?.documentReadableId ?? null,
        documentDescription: viewData.data?.documentDescription ?? null
      };
    })
  );

  const canApprovePromises = pendingWithReadableFields.map(async (approval) => {
    const canApprove = await canApproveRequest(
      client,
      {
        amount: approval.amount,
        documentType: approval.documentType,
        companyId: approval.companyId
      },
      userId
    );
    return canApprove ? approval : null;
  });

  const approvableByUser = (await Promise.all(canApprovePromises)).filter(
    (approval): approval is NonNullable<typeof approval> => approval !== null
  );

  const allApprovals = [...requestedByUser, ...approvableByUser];

  let filtered = allApprovals;
  if (args?.status && args.status !== "Pending") {
    filtered = allApprovals.filter((a) => a.status === args.status);
  }

  filtered.sort((a, b) => {
    const aDate = new Date(a.requestedAt).getTime();
    const bDate = new Date(b.requestedAt).getTime();
    return bDate - aDate;
  });

  if (args?.limit) {
    const offset = args.offset || 0;
    filtered = filtered.slice(offset, offset + args.limit);
  }

  return {
    data: filtered,
    count: requestedByUserBase.count ?? allApprovals.length,
    error: null
  };
}

export async function getBase64ImageFromSupabase(
  client: SupabaseClient<Database>,
  path: string
) {
  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    return Buffer.from(buffer).toString("base64");
  }

  const { data, error } = await client.storage.from("private").download(path);
  if (error) {
    return null;
  }

  const arrayBuffer = await data.arrayBuffer();
  const base64String = arrayBufferToBase64(arrayBuffer);

  // Determine the mime type based on file extension
  const fileExtension = path.split(".").pop()?.toLowerCase();
  const mimeType =
    fileExtension === "jpg" || fileExtension === "jpeg"
      ? "image/jpeg"
      : "image/png";

  return `data:${mimeType};base64,${base64String}`;
}

export async function getCountries(client: SupabaseClient<Database>) {
  return client.from("country").select("*").order("name");
}

export async function getLatestApprovalRequestForDocument(
  client: SupabaseClient<Database>,
  documentType: (typeof approvalDocumentType)[number],
  documentId: string
) {
  const baseRequest = await client
    .from("approvalRequest")
    .select("*")
    .eq("documentType", documentType)
    .eq("documentId", documentId)
    .order("requestedAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (baseRequest.error || !baseRequest.data) {
    return baseRequest;
  }

  const viewData = await client
    .from("approvalRequests")
    .select("documentReadableId, documentDescription")
    .eq("id", baseRequest.data.id)
    .single();

  return {
    data: {
      ...baseRequest.data,
      documentReadableId: viewData.data?.documentReadableId ?? null,
      documentDescription: viewData.data?.documentDescription ?? null
    },
    error: null
  };
}

export function getDocumentType(
  fileName: string
): (typeof documentTypes)[number] {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension)) {
    return "Archive";
  }

  if (["pdf"].includes(extension)) {
    return "PDF";
  }

  if (["doc", "docx", "txt", "rtf"].includes(extension)) {
    return "Document";
  }

  if (["ppt", "pptx"].includes(extension)) {
    return "Presentation";
  }

  if (["csv", "xls", "xlsx"].includes(extension)) {
    return "Spreadsheet";
  }

  if (["txt"].includes(extension)) {
    return "Text";
  }

  if (["png", "jpg", "jpeg", "gif", "avif"].includes(extension)) {
    return "Image";
  }

  if (["mp4", "mov", "avi", "wmv", "flv", "mkv"].includes(extension)) {
    return "Video";
  }

  if (["mp3", "wav", "wma", "aac", "ogg", "flac"].includes(extension)) {
    return "Audio";
  }

  if (supportedModelTypes.includes(extension)) {
    return "Model";
  }

  return "Other";
}

export async function getModelByItemId(
  client: SupabaseClient<Database>,
  itemId: string
) {
  const item = await client
    .from("item")
    .select("id, type, modelUploadId")
    .eq("id", itemId)
    .single();

  if (!item.data || !item.data.modelUploadId) {
    return {
      itemId: item.data?.id ?? null,
      type: item.data?.type ?? null,
      modelPath: null
    };
  }

  const model = await client
    .from("modelUpload")
    .select("*")
    .eq("id", item.data.modelUploadId)
    .maybeSingle();

  if (!model.data) {
    return {
      itemId: item.data?.id ?? null,
      type: item.data?.type ?? null,
      modelSize: null
    };
  }

  return {
    itemId: item.data!.id,
    type: item.data!.type,
    ...model.data
  };
}

export async function getNotes(
  client: SupabaseClient<Database>,
  documentId: string
) {
  return client
    .from("note")
    .select("id, note, createdAt, user(id, fullName, avatarUrl)")
    .eq("documentId", documentId)
    .eq("active", true)
    .order("createdAt");
}

export async function getPendingApprovalsForApprover(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  const allPending = await client
    .from("approvalRequest")
    .select("*")
    .eq("companyId", companyId)
    .eq("status", "Pending")
    .order("requestedAt", { ascending: false });

  if (allPending.error || !allPending.data) {
    return allPending;
  }

  const pendingWithReadableFields = await Promise.all(
    allPending.data.map(async (approval) => {
      const viewData = await client
        .from("approvalRequests")
        .select("documentReadableId, documentDescription")
        .eq("id", approval.id)
        .single();

      return {
        ...approval,
        documentReadableId: viewData.data?.documentReadableId ?? null,
        documentDescription: viewData.data?.documentDescription ?? null
      };
    })
  );

  // Use canApproveRequestInWindow to only show requests within user's specific approval window
  const canApprovePromises = pendingWithReadableFields.map(async (approval) => {
    const canApprove = await canApproveRequestInWindow(
      client,
      {
        amount: approval.amount,
        documentType: approval.documentType,
        companyId: approval.companyId
      },
      userId
    );
    return canApprove ? approval : null;
  });

  const approvableByUser = (await Promise.all(canApprovePromises)).filter(
    (approval): approval is NonNullable<typeof approval> => approval !== null
  );

  return {
    data: approvableByUser,
    error: null
  };
}

export async function getPeriods(
  client: SupabaseClient<Database>,
  { startDate, endDate }: { startDate: string; endDate: string }
) {
  const endWithTime = endDate.includes("T") ? endDate : `${endDate}T23:59:59`;
  return client
    .from("period")
    .select("*")
    .gte("startDate", startDate)
    .lte("endDate", endWithTime);
}

export async function getSavedViews(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  return client
    .from("tableView")
    .select("*")
    .eq("createdBy", userId)
    .eq("companyId", companyId)
    .order("name");
}

export async function getTagsList(
  client: SupabaseClient<Database>,
  companyId: string,
  table?: string | null
) {
  let query = client.from("tag").select("name").eq("companyId", companyId);

  if (table) {
    query = query.eq("table", table);
  }

  return query.order("name");
}

export async function hasPendingApproval(
  client: SupabaseClient<Database>,
  documentType: (typeof approvalDocumentType)[number],
  documentId: string
): Promise<boolean> {
  const result = await client
    .from("approvalRequest")
    .select("id")
    .eq("documentType", documentType)
    .eq("documentId", documentId)
    .eq("status", "Pending")
    .limit(1);

  return (result.data?.length ?? 0) > 0;
}

export async function importCsv(
  client: SupabaseClient<Database>,
  args: {
    table: string;
    filePath: string;
    columnMappings: Record<string, string>;
    enumMappings?: Record<string, string[]>;
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke("import-csv", {
    body: args,
    region: FunctionRegion.UsEast1
  });
}

export async function insertNote(
  client: SupabaseClient<Database>,
  note: {
    note: string;
    documentId: string;
    companyId: string;
    createdBy: string;
  }
) {
  return client.from("note").insert([note]).select("*").single();
}

export async function insertTag(
  client: SupabaseClient<Database>,
  tag: Database["public"]["Tables"]["tag"]["Insert"]
) {
  return client.from("tag").insert(tag).select("*").single();
}

export async function isApprovalRequired(
  client: SupabaseClient<Database>,
  documentType: (typeof approvalDocumentType)[number],
  companyId: string,
  amount?: number
): Promise<boolean> {
  const config = await getApprovalRuleByAmount(
    client,
    documentType,
    companyId,
    amount
  );

  if (!config.data) {
    return false;
  }

  return config.data.enabled;
}

export async function getExternalLink(
  client: SupabaseClient<Database>,
  id: string
) {
  let query = client.from("externalLink").select("*").eq("id", id).single();

  return query;
}

export async function upsertExternalLink(
  client: SupabaseClient<Database>,
  externalLink:
    | Database["public"]["Tables"]["externalLink"]["Insert"]
    | Database["public"]["Tables"]["externalLink"]["Update"]
) {
  if ("id" in externalLink && externalLink.id) {
    return client
      .from("externalLink")
      .update(externalLink)
      .eq("id", externalLink.id)
      .select("id")
      .single();
  }
  return client
    .from("externalLink")
    .insert(
      externalLink as Database["public"]["Tables"]["externalLink"]["Insert"]
    )
    .select("id")
    .single();
}

export async function getCustomerPortals(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("externalLink")
    .select("*", { count: "exact" })
    .eq("companyId", companyId)
    .eq("documentType", "Customer");

  if (args?.search) {
    query = query.ilike("customer.name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: false }
    ]);
  }

  return query;
}

export async function getCustomerPortal(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("externalLink")
    .select("*, customer:customerId(id, name)")
    .eq("id", id)
    .eq("documentType", "Customer")
    .single();
}

export async function deleteCustomerPortal(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("externalLink").delete().eq("id", id);
}

export async function updateModelThumbnail(
  client: SupabaseClient<Database>,
  modelId: string,
  thumbnailPath: string
) {
  return client.from("modelUpload").update({ thumbnailPath }).eq("id", modelId);
}

export async function upsertModelUpload(
  client: SupabaseClient<Database>,
  upload:
    | {
        id: string;
        modelPath: string;
        companyId: string;
        createdBy: string;
      }
    | {
        id: string;
        name: string;
        size: number;
        thumbnailPath: string;
      }
) {
  if ("createdBy" in upload) {
    return client.from("modelUpload").insert(upload);
  }
  return client.from("modelUpload").update(upload).eq("id", upload.id);
}

export async function updateNote(
  client: SupabaseClient<Database>,
  id: string,
  note: string
) {
  return client.from("note").update({ note }).eq("id", id);
}

export async function rejectRequest(
  client: SupabaseClient<Database>,
  id: string,
  userId: string,
  notes?: string
) {
  const existing = await client
    .from("approvalRequest")
    .select("id, status, documentType, documentId")
    .eq("id", id)
    .single();

  if (existing.error || !existing.data) {
    return { error: { message: "Approval request not found" }, data: null };
  }

  if (existing.data.status !== "Pending") {
    return {
      error: { message: "Approval request is not pending" },
      data: null
    };
  }

  const approvalUpdate = await client
    .from("approvalRequest")
    .update({
      status: "Rejected",
      decisionBy: userId,
      decisionAt: new Date().toISOString(),
      decisionNotes: notes || null,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select("id, documentType, documentId")
    .single();

  if (approvalUpdate.error) {
    return { error: approvalUpdate.error, data: null };
  }

  if (approvalUpdate.data) {
    const { documentType, documentId } = approvalUpdate.data;

    if (documentType === "purchaseOrder") {
      await client
        .from("purchaseOrder")
        .update({
          status: "Rejected",
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .eq("id", documentId)
        .eq("status", "Needs Approval");
    } else if (documentType === "qualityDocument") {
      // Keep quality document as "Draft" when rejected
      // (No status change needed, it should remain in Draft)
    }
  }

  return approvalUpdate;
}

export async function upsertApprovalRule(
  client: SupabaseClient<Database>,
  rule: UpsertApprovalRuleInput
) {
  if ("id" in rule) {
    const existing = await client
      .from("approvalRule")
      .select("companyId")
      .eq("id", rule.id)
      .single();

    if (existing.error || !existing.data) {
      return {
        data: null,
        error: existing.error || { message: "Rule not found" }
      };
    }

    return client
      .from("approvalRule")
      .update(sanitize(rule))
      .eq("id", rule.id)
      .eq("companyId", existing.data.companyId)
      .select("id")
      .single();
  }

  return client.from("approvalRule").insert([rule]).select("id").single();
}

export async function upsertSavedView(
  client: SupabaseClient<Database>,
  view: {
    id?: string;
    name: string;
    description?: string;
    table: string;
    type: "Public" | "Private";
    filters?: string[];
    sorts?: string[];
    columnPinning?: Record<string, boolean>;
    columnVisibility?: Record<string, boolean>;
    columnOrder?: string[];
    userId: string;
    companyId: string;
  }
) {
  const { userId, ...data } = view;
  if ("id" in view && view.id) {
    return client
      .from("tableView")
      .update({
        ...data,
        updatedBy: userId
      })
      .eq("id", view.id)
      .select("id")
      .single();
  }

  const { data: maxSortOrderData, error: maxSortOrderError } = await client
    .from("tableView")
    .select("sortOrder")
    .order("sortOrder", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxSortOrderError) {
    return { data: null, error: maxSortOrderError };
  }

  const newSortOrder = maxSortOrderData ? maxSortOrderData.sortOrder + 1 : 1;

  return client
    .from("tableView")
    .insert({
      ...data,
      createdBy: userId,
      sortOrder: newSortOrder
    })
    .select("id")
    .single();
}

export async function updateSavedViewOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    sortOrder: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, sortOrder, updatedBy }) =>
    client.from("tableView").update({ sortOrder, updatedBy }).eq("id", id)
  );
  return Promise.all(updatePromises);
}
