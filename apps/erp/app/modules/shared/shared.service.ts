import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { getPurchaseOrderStatus, supportedModelTypes } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AuthContextHolder, getAuthClient, mcpTool } from "~/services/mcp";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  approvalDocumentType,
  documentTypes,
  PriceBreak,
  SupplierPriceMap
} from "./shared.models";
import type {
  ApprovalFilters,
  ApprovalRequestForApproveCheck,
  ApprovalRequestForCancelCheck,
  ApprovalRequestForViewCheck,
  ApprovalRule,
  CreateApprovalRequestInput,
  UpsertApprovalRuleInput
} from "./types";
export const approveRequest = mcpTool(
  {
    classification: "WRITE"
  },
  async function approveRequest(
    db: Kysely<KyselyDatabase>,
    id: string,
    notes?: string
  ) {
    const { userId } = AuthContextHolder.get();
    // Pre-flight check: verify approval request exists and is pending
    const approvalRequest = await db
      .selectFrom("approvalRequest")
      .select(["id", "status", "documentType", "documentId", "companyId"])
      .where("id", "=", id)
      .executeTakeFirst();

    if (!approvalRequest) {
      return { error: { message: "Approval request not found" }, data: null };
    }

    if (approvalRequest.status !== "Pending") {
      return {
        error: { message: "Approval request is not pending" },
        data: null
      };
    }

    const { documentType, documentId } = approvalRequest;
    const now = new Date().toISOString();

    try {
      const result = await db.transaction().execute(async (trx) => {
        // 1. Update approval request to "Approved"
        const updatedApproval = await trx
          .updateTable("approvalRequest")
          .set({
            status: "Approved",
            decisionBy: userId,
            decisionAt: now,
            decisionNotes: notes || null,
            updatedBy: userId,
            updatedAt: now
          })
          .where("id", "=", id)
          .returning(["id", "documentType", "documentId"])
          .executeTakeFirstOrThrow();

        // 2. Update document status based on type
        if (documentType === "purchaseOrder") {
          // Fetch PO lines to calculate new status
          const lines = await trx
            .selectFrom("purchaseOrderLine")
            .select([
              "purchaseOrderLineType",
              "invoicedComplete",
              "receivedComplete"
            ])
            .where("purchaseOrderId", "=", documentId)
            .execute();

          const { status: calculatedStatus } = getPurchaseOrderStatus(lines);

          // Update PO status (only if currently "Needs Approval")
          const poUpdate = await trx
            .updateTable("purchaseOrder")
            .set({
              status: calculatedStatus,
              updatedBy: userId,
              updatedAt: now
            })
            .where("id", "=", documentId)
            .where("status", "=", "Needs Approval")
            .returning(["id"])
            .executeTakeFirst();

          if (!poUpdate) {
            throw new Error(
              "Failed to update purchase order status - it may no longer be in 'Needs Approval' state"
            );
          }
        } else if (documentType === "qualityDocument") {
          const qdUpdate = await trx
            .updateTable("qualityDocument")
            .set({
              status: "Active",
              updatedBy: userId,
              updatedAt: now
            })
            .where("id", "=", documentId)
            .returning(["id"])
            .executeTakeFirst();

          if (!qdUpdate) {
            throw new Error("Failed to update quality document status");
          }
        } else if (documentType === "supplier") {
          const supplierUpdate = await trx
            .updateTable("supplier")
            .set({
              supplierStatus: "Active",
              updatedBy: userId,
              updatedAt: now
            })
            .where("id", "=", documentId)
            .returning(["id"])
            .executeTakeFirst();

          if (!supplierUpdate) {
            throw new Error("Failed to update supplier status");
          }
        }

        return updatedApproval;
      });

      return { data: result, error: null };
    } catch (error) {
      // Transaction automatically rolled back on error
      return {
        error: {
          message:
            error instanceof Error
              ? error.message
              : "Failed to process approval"
        },
        data: null
      };
    }
  }
);

export const canApproveRequest = mcpTool(
  {
    classification: "WRITE"
  },
  async function canApproveRequest(
    approvalRequest: ApprovalRequestForApproveCheck
  ): Promise<boolean> {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId } = AuthContextHolder.get();
    const rules = await getApprovalRulesForApprover(
      approvalRequest.documentType
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

      // Check if user ID is directly in approverGroupIds (for individual approvers)
      if (approverGroupIds.includes(userId)) {
        return true;
      }

      // Check if user belongs to any of the approver groups
      return approverGroupIds.some((groupId) => userGroupIds.includes(groupId));
    });
  }
);

/**
 * Checks if a user can approve a request based on the specific rule matching the amount.
 * This is the original approval check logic - user must be on the rule that matches the amount.
 * Used for "Assigned to Me" lists.
 */
export const canApproveRequestInWindow = mcpTool(
  {
    classification: "WRITE"
  },
  async function canApproveRequestInWindow(
    approvalRequest: ApprovalRequestForApproveCheck
  ): Promise<boolean> {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId } = AuthContextHolder.get();
    const rule = await getApprovalRuleByAmount(
      approvalRequest.documentType,
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

    // Check if user ID is directly in approverGroupIds (for individual approvers)
    if (approverGroupIds.includes(userId)) {
      return true;
    }

    // Check if user belongs to any of the approver groups
    const userGroups = await client.rpc("groups_for_user", { uid: userId });
    const userGroupIds = userGroups.data || [];
    return approverGroupIds.some((groupId) => userGroupIds.includes(groupId));
  }
);

export function canCancelRequest(
  approvalRequest: ApprovalRequestForCancelCheck,
  userId: string
): boolean {
  return (
    approvalRequest.requestedBy === userId &&
    approvalRequest.status === "Pending"
  );
}

export const cancelApprovalRequest = mcpTool(
  {
    classification: "WRITE"
  },
  async function cancelApprovalRequest(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId } = AuthContextHolder.get();
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
);

export const canViewApprovalRequest = mcpTool(
  {
    classification: "WRITE"
  },
  async function canViewApprovalRequest(
    approvalRequest: ApprovalRequestForViewCheck
  ): Promise<boolean> {
    const { companyId, userId } = AuthContextHolder.get();
    if (approvalRequest.requestedBy === userId) {
      return true;
    }

    return canApproveRequest({
      amount: approvalRequest.amount,
      documentType: approvalRequest.documentType,
      companyId: companyId
    });
  }
);

export const createApprovalRequest = mcpTool(
  {
    classification: "WRITE"
  },
  async function createApprovalRequest(
    request: CreateApprovalRequestInput & { amount?: number }
  ) {
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("approvalRequest")
      .insert([
        {
          documentType: request.documentType,
          documentId: request.documentId,
          requestedBy: request.requestedBy,
          amount: request.amount ?? null,
          companyId: companyId,
          createdBy: userId
        }
      ])
      .select("id")
      .single();
  }
);

export const deleteApprovalRule = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteApprovalRule(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("approvalRule")
      .delete()
      .eq("id", id)
      .eq("companyId", companyId);
  }
);

export const deleteNote = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteNote(noteId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("note").update({ active: false }).eq("id", noteId);
  }
);

export const deleteSavedView = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteSavedView(viewId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("tableView").delete().eq("id", viewId);
  }
);

export const generateEmbedding = mcpTool(
  {
    classification: "WRITE"
  },
  async function generateEmbedding(text: string): Promise<number[]> {
    const client = getAuthClient<SupabaseClient<Database>>();
    const response = await client.functions.invoke("embedding", {
      body: { text }
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
);

export const getApprovalById = mcpTool(
  {
    classification: "READ"
  },
  async function getApprovalById(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const getApprovalRequestsByDocument = mcpTool(
  {
    classification: "READ"
  },
  async function getApprovalRequestsByDocument(
    documentType: (typeof approvalDocumentType)[number],
    documentId: string
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("approvalRequests")
      .select("*")
      .eq("documentType", documentType)
      .eq("documentId", documentId)
      .order("requestedAt", { ascending: false });
  }
);

export const getApprovalRuleByAmount = mcpTool(
  {
    classification: "READ"
  },
  async function getApprovalRuleByAmount(
    documentType: (typeof approvalDocumentType)[number],
    amount?: number
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getApproverUserIdsForRule = mcpTool(
  {
    classification: "READ"
  },
  async function getApproverUserIdsForRule(
    rule: Pick<ApprovalRule, "approverGroupIds" | "defaultApproverId">
  ): Promise<string[]> {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const getApprovalRuleById = mcpTool(
  {
    classification: "READ"
  },
  async function getApprovalRuleById(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("approvalRule")
      .select("*")
      .eq("id", id)
      .eq("companyId", companyId)
      .single();
  }
);

export const getApprovalRules = mcpTool(
  {
    classification: "READ"
  },
  async function getApprovalRules() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client.from("approvalRule").select("*").eq("companyId", companyId);
  }
);

export const getApprovalRulesForApprover = mcpTool(
  {
    classification: "READ"
  },
  async function getApprovalRulesForApprover(
    documentType: (typeof approvalDocumentType)[number]
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("approvalRule")
      .select("*")
      .eq("documentType", documentType)
      .eq("companyId", companyId)
      .eq("enabled", true)
      .order("lowerBoundAmount", { ascending: false });
  }
);

export const getApprovalsForUser = mcpTool(
  {
    classification: "READ"
  },
  async function getApprovalsForUser(
    args?: GenericQueryFilters & ApprovalFilters
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId, companyId } = AuthContextHolder.get();
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

    const canApprovePromises = pendingWithReadableFields.map(
      async (approval) => {
        const { companyId } = AuthContextHolder.get();
        const canApprove = await canApproveRequest({
          amount: approval.amount,
          documentType: approval.documentType,
          companyId: companyId
        });
        return canApprove ? approval : null;
      }
    );

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
);

export const getBase64ImageFromSupabase = mcpTool(
  {
    classification: "READ"
  },
  async function getBase64ImageFromSupabase(path: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const getCountries = mcpTool(
  {
    classification: "READ"
  },
  async function getCountries() {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("country").select("*").order("name");
  }
);

export const getLatestApprovalRequestForDocument = mcpTool(
  {
    classification: "READ"
  },
  async function getLatestApprovalRequestForDocument(
    documentType: (typeof approvalDocumentType)[number],
    documentId: string
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const baseRequest = await client
      .from("approvalRequest")
      .select("*")
      .eq("documentType", documentType)
      .eq("documentId", documentId)
      .eq("status", "Pending")
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
);

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

export const getModelByItemId = mcpTool(
  {
    classification: "READ"
  },
  async function getModelByItemId(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const getNotes = mcpTool(
  {
    classification: "READ"
  },
  async function getNotes(documentId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("note")
      .select("id, note, createdAt, user(id, fullName, avatarUrl)")
      .eq("documentId", documentId)
      .eq("active", true)
      .order("createdAt");
  }
);

export const getPendingApprovalsForApprover = mcpTool(
  {
    classification: "READ"
  },
  async function getPendingApprovalsForApprover() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
    const canApprovePromises = pendingWithReadableFields.map(
      async (approval) => {
        const { companyId } = AuthContextHolder.get();
        const canApprove = await canApproveRequestInWindow({
          amount: approval.amount,
          documentType: approval.documentType,
          companyId: companyId
        });
        return canApprove ? approval : null;
      }
    );

    const approvableByUser = (await Promise.all(canApprovePromises)).filter(
      (approval): approval is NonNullable<typeof approval> => approval !== null
    );

    return {
      data: approvableByUser,
      error: null
    };
  }
);

export const getPeriods = mcpTool(
  {
    classification: "READ",
    argOrder: ["args"]
  },
  async function getPeriods({
    startDate,
    endDate
  }: {
    startDate: string;
    endDate: string;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const endWithTime = endDate.includes("T") ? endDate : `${endDate}T23:59:59`;
    return client
      .from("period")
      .select("*")
      .gte("startDate", startDate)
      .lte("endDate", endWithTime);
  }
);

export const getSavedViews = mcpTool(
  {
    classification: "READ"
  },
  async function getSavedViews() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId, companyId } = AuthContextHolder.get();
    return client
      .from("tableView")
      .select("*")
      .eq("createdBy", userId)
      .eq("companyId", companyId)
      .order("name");
  }
);

export const getTagsList = mcpTool(
  {
    classification: "READ"
  },
  async function getTagsList(table?: string | null) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    let query = client.from("tag").select("name").eq("companyId", companyId);

    if (table) {
      query = query.eq("table", table);
    }

    return query.order("name");
  }
);

export const hasPendingApproval = mcpTool(
  {
    classification: "WRITE"
  },
  async function hasPendingApproval(
    documentType: (typeof approvalDocumentType)[number],
    documentId: string
  ): Promise<boolean> {
    const client = getAuthClient<SupabaseClient<Database>>();
    const result = await client
      .from("approvalRequest")
      .select("id")
      .eq("documentType", documentType)
      .eq("documentId", documentId)
      .eq("status", "Pending")
      .limit(1);

    return (result.data?.length ?? 0) > 0;
  }
);

export const importCsv = mcpTool(
  {
    classification: "WRITE",
    schema: z.object({
      args: z.object({
        table: z.string(),
        filePath: z.string(),
        columnMappings: z.any(),
        enumMappings: z.any().optional()
      })
    })
  },
  async function importCsv(args: {
    table: string;
    filePath: string;
    columnMappings: Record<string, string>;
    enumMappings?: Record<string, string[]>;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.functions.invoke("import-csv", {
      body: args
    });
  }
);

export const insertNote = mcpTool(
  {
    classification: "WRITE"
  },
  async function insertNote(note: { note: string; documentId: string }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId, userId: createdBy } = AuthContextHolder.get();
    return client
      .from("note")
      .insert([{ ...note, companyId, createdBy }])
      .select("*")
      .single();
  }
);

export const insertTag = mcpTool(
  {
    classification: "WRITE"
  },
  async function insertTag(tag: Database["public"]["Tables"]["tag"]["Insert"]) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("tag").insert(tag).select("*").single();
  }
);

export const isApprovalRequired = mcpTool(
  {
    classification: "WRITE"
  },
  async function isApprovalRequired(
    documentType: (typeof approvalDocumentType)[number],
    amount?: number
  ): Promise<boolean> {
    const config = await getApprovalRuleByAmount(documentType, amount);

    if (!config.data) {
      return false;
    }

    return config.data.enabled;
  }
);

export const getExternalLink = mcpTool(
  {
    classification: "READ"
  },
  async function getExternalLink(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    let query = client.from("externalLink").select("*").eq("id", id).single();

    return query;
  }
);

export const upsertExternalLink = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertExternalLink(
    externalLink:
      | Database["public"]["Tables"]["externalLink"]["Insert"]
      | Database["public"]["Tables"]["externalLink"]["Update"]
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const getCustomerPortals = mcpTool(
  {
    classification: "READ"
  },
  async function getCustomerPortals(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getCustomerPortal = mcpTool(
  {
    classification: "READ"
  },
  async function getCustomerPortal(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("externalLink")
      .select("*, customer:customerId(id, name)")
      .eq("id", id)
      .eq("documentType", "Customer")
      .single();
  }
);

export const deleteCustomerPortal = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteCustomerPortal(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("externalLink").delete().eq("id", id);
  }
);

export const updateModelThumbnail = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateModelThumbnail(modelId: string, thumbnailPath: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("modelUpload")
      .update({ thumbnailPath })
      .eq("id", modelId);
  }
);

export const upsertModelUpload = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertModelUpload(
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
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("createdBy" in upload) {
      return client.from("modelUpload").insert(upload);
    }
    return client.from("modelUpload").update(upload).eq("id", upload.id);
  }
);

export const updateNote = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateNote(id: string, note: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("note").update({ note }).eq("id", id);
  }
);

export const rejectRequest = mcpTool(
  {
    classification: "WRITE"
  },
  async function rejectRequest(
    db: Kysely<KyselyDatabase>,
    id: string,
    notes?: string
  ) {
    const { userId } = AuthContextHolder.get();
    // Pre-flight check: verify approval request exists and is pending
    const approvalRequest = await db
      .selectFrom("approvalRequest")
      .select(["id", "status", "documentType", "documentId"])
      .where("id", "=", id)
      .executeTakeFirst();

    if (!approvalRequest) {
      return { error: { message: "Approval request not found" }, data: null };
    }

    if (approvalRequest.status !== "Pending") {
      return {
        error: { message: "Approval request is not pending" },
        data: null
      };
    }

    const { documentType, documentId } = approvalRequest;
    const now = new Date().toISOString();

    try {
      const result = await db.transaction().execute(async (trx) => {
        // 1. Update approval request to "Rejected"
        const updatedApproval = await trx
          .updateTable("approvalRequest")
          .set({
            status: "Rejected",
            decisionBy: userId,
            decisionAt: now,
            decisionNotes: notes || null,
            updatedBy: userId,
            updatedAt: now
          })
          .where("id", "=", id)
          .returning(["id", "documentType", "documentId"])
          .executeTakeFirstOrThrow();

        // 2. Update document status based on type
        if (documentType === "purchaseOrder") {
          const poUpdate = await trx
            .updateTable("purchaseOrder")
            .set({
              status: "Rejected",
              updatedBy: userId,
              updatedAt: now
            })
            .where("id", "=", documentId)
            .where("status", "=", "Needs Approval")
            .returning(["id"])
            .executeTakeFirst();

          if (!poUpdate) {
            throw new Error(
              "Failed to update purchase order status - it may no longer be in 'Needs Approval' state"
            );
          }
        }
        // Note: qualityDocument rejection doesn't change status (stays Draft)

        if (documentType === "supplier") {
          const supplierUpdate = await trx
            .updateTable("supplier")
            .set({
              supplierStatus: "Rejected",
              updatedBy: userId,
              updatedAt: now
            })
            .where("id", "=", documentId)
            .returning(["id"])
            .executeTakeFirst();

          if (!supplierUpdate) {
            throw new Error("Failed to update supplier status");
          }
        }

        return updatedApproval;
      });

      return { data: result, error: null };
    } catch (error) {
      // Transaction automatically rolled back on error
      return {
        error: {
          message:
            error instanceof Error
              ? error.message
              : "Failed to process rejection"
        },
        data: null
      };
    }
  }
);

export const upsertApprovalRule = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertApprovalRule(rule: UpsertApprovalRuleInput) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertSavedView = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertSavedView(view: {
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
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId, userId } = AuthContextHolder.get();
    const data = view;
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
        companyId,
        createdBy: userId,
        sortOrder: newSortOrder
      })
      .select("id")
      .single();
  }
);

export const updateSavedViewOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateSavedViewOrder(
    updates: {
      id: string;
      sortOrder: number;
      updatedBy: string;
    }[]
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const updatePromises = updates.map(({ id, sortOrder, updatedBy }) =>
      client.from("tableView").update({ sortOrder, updatedBy }).eq("id", id)
    );
    return Promise.all(updatePromises);
  }
);

/**
 * Core sync lookup: given price break tiers and a requested quantity,
 * return the unit price from the highest qualifying tier
 * (where tier.quantity <= requestedQty). Falls back to fallbackPrice.
 */
export function lookupPriceFromBreaks(
  priceBreaks: PriceBreak[],
  requestedQty: number,
  fallbackPrice: number
): number {
  const eligible = priceBreaks.filter((pb) => pb.quantity <= requestedQty);
  if (eligible.length) {
    return eligible.reduce((best, pb) =>
      pb.quantity > best.quantity ? pb : best
    ).unitPrice;
  }
  return fallbackPrice;
}

/**
 * Map-aware wrapper: look up itemId in a SupplierPriceMap, then resolve
 * via lookupPriceFromBreaks. Used by useLineCosts for BOM tree costing.
 */
export function lookupBuyPriceFromMap(
  itemId: string,
  requestedQty: number,
  priceMap: SupplierPriceMap,
  fallbackCost: number
): number {
  const entry = priceMap[itemId];
  if (!entry) return fallbackCost;
  return lookupPriceFromBreaks(
    entry.priceBreaks,
    requestedQty,
    entry.fallbackUnitPrice ?? fallbackCost
  );
}

/**
 * Resolve the best supplier unit price for a quantity, applying exchange
 * rate conversion.
 */
export function resolveSupplierPrice(
  priceBreaks: PriceBreak[],
  quantity: number,
  fallbackUnitPrice: number,
  exchangeRate: number
): number {
  if (!priceBreaks.length) return fallbackUnitPrice;
  return (
    lookupPriceFromBreaks(
      priceBreaks,
      quantity,
      fallbackUnitPrice * exchangeRate
    ) / exchangeRate
  );
}
