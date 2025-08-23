import { getCarbonServiceRole, VERCEL_URL } from "@carbon/auth";
import type { Database } from "@carbon/database";
import {
  type DocumentType,
  type IssueAssignmentUpdate,
  type IssueStatusUpdate,
  type IssueTaskUpdate,
  type NonConformanceData,
  formatAssignmentUpdate,
  formatDocumentCreated,
  formatStatusUpdate,
  formatTaskUpdate,
} from "@carbon/ee/slack/messages";
import { WebClient } from "@slack/web-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { task } from "@trigger.dev/sdk/v3";

export const slackDocumentCreated = task({
  id: "slack-document-created",
  run: async (payload: {
    documentType: DocumentType;
    documentId: string;
    companyId: string;
    channelId: string;
    threadTs: string;
  }) => {
    const { documentType, documentId, companyId, channelId, threadTs } =
      payload;

    try {
      const serviceRole = await getCarbonServiceRole();

      const documentData = await getDocumentData(
        serviceRole,
        documentType,
        documentId,
        companyId
      );

      if (!documentData) {
        throw new Error(`${documentType} ${documentId} not found`);
      }

      const { data: integration } = await serviceRole
        .from("companyIntegration")
        .select("metadata")
        .eq("id", "slack")
        .eq("companyId", companyId)
        .single();

      if (!integration?.metadata) {
        throw new Error("Slack integration not found");
      }

      const slackToken = (integration.metadata as any)?.access_token as string;
      const baseUrl = VERCEL_URL || "http://localhost:3000";

      await postToSlackThread({
        token: slackToken,
        channelId,
        threadTs,
        blocks: formatDocumentCreated(documentData, baseUrl),
      });

      return { success: true };
    } catch (error) {
      console.error(`Error posting ${documentType} to Slack:`, error);
      throw error;
    }
  },
});

export const slackDocumentStatusUpdate = task({
  id: "slack-document-status-update",
  run: async (payload: {
    documentType: DocumentType;
    documentId: string;
    companyId: string;
    previousStatus: string;
    newStatus: string;
    updatedBy: string;
    reason?: string;
  }) => {
    const {
      documentType,
      documentId,
      companyId,
      previousStatus,
      newStatus,
      updatedBy,
      reason,
    } = payload;

    try {
      const serviceRole = await getCarbonServiceRole();

      const { data: thread } = await serviceRole
        .from("slackDocumentThread")
        .select("channelId, threadTs")
        .eq("documentType", documentType)
        .eq("documentId", documentId)
        .eq("companyId", companyId)
        .single();

      if (!thread) {
        return { success: true, message: "No Slack thread found" };
      }

      const { data: integration } = await serviceRole
        .from("companyIntegration")
        .select("metadata")
        .eq("id", "slack")
        .eq("companyId", companyId)
        .single();

      if (!integration?.metadata) {
        throw new Error("Slack integration not found");
      }

      const slackToken = (integration.metadata as any).access_token as string;

      const documentData = await getDocumentData(
        serviceRole,
        documentType,
        documentId,
        companyId
      );

      if (!documentData) {
        throw new Error(`${documentType} ${documentId} not found`);
      }

      const statusUpdate: IssueStatusUpdate = {
        previousStatus,
        newStatus,
        updatedBy,
        reason,
      };

      await postToSlackThread({
        token: slackToken,
        channelId: thread.channelId,
        threadTs: thread.threadTs,
        blocks: formatStatusUpdate(
          documentType,
          documentData.readableId,
          statusUpdate
        ),
      });

      return { success: true };
    } catch (error) {
      console.error(
        `Error posting ${documentType} status update to Slack:`,
        error
      );
      throw error;
    }
  },
});

export const slackDocumentTaskUpdate = task({
  id: "slack-document-task-update",
  run: async (payload: {
    documentType: DocumentType;
    documentId: string;
    companyId: string;
    taskType: "investigation" | "action" | "approval";
    taskName: string;
    status: string;
    assignee?: string | null;
    completedAt?: string;
  }) => {
    const {
      documentType,
      documentId,
      companyId,
      taskType,
      taskName,
      status,
      assignee,
      completedAt,
    } = payload;

    try {
      const serviceRole = await getCarbonServiceRole();

      const { data: thread } = await serviceRole
        .from("slackDocumentThread")
        .select("channelId, threadTs")
        .eq("documentType", documentType)
        .eq("documentId", documentId)
        .eq("companyId", companyId)
        .single();

      if (!thread) {
        return { success: true, message: "No Slack thread found" };
      }

      const { data: integration } = await serviceRole
        .from("companyIntegration")
        .select("metadata")
        .eq("id", "slack")
        .eq("companyId", companyId)
        .single();

      if (!integration?.metadata) {
        throw new Error("Slack integration not found");
      }

      const slackToken = (integration.metadata as any).access_token as string;

      const documentData = await getDocumentData(
        serviceRole,
        documentType,
        documentId,
        companyId
      );

      if (!documentData) {
        throw new Error(`${documentType} ${documentId} not found`);
      }

      const taskUpdate: IssueTaskUpdate = {
        taskType,
        taskName,
        status,
        assignee,
        completedAt,
      };

      await postToSlackThread({
        token: slackToken,
        channelId: thread.channelId,
        threadTs: thread.threadTs,
        blocks: formatTaskUpdate(
          documentType,
          documentData.readableId,
          taskUpdate
        ),
      });

      return { success: true };
    } catch (error) {
      console.error(
        `Error posting ${documentType} task update to Slack:`,
        error
      );
      throw error;
    }
  },
});

export const slackDocumentAssignmentUpdate = task({
  id: "slack-document-assignment-update",
  run: async (payload: {
    documentType: DocumentType;
    documentId: string;
    companyId: string;
    previousAssignee?: string;
    newAssignee: string;
    updatedBy: string;
  }) => {
    const {
      documentType,
      documentId,
      companyId,
      previousAssignee,
      newAssignee,
      updatedBy,
    } = payload;

    try {
      const serviceRole = await getCarbonServiceRole();

      const { data: thread } = await serviceRole
        .from("slackDocumentThread")
        .select("channelId, threadTs")
        .eq("documentType", documentType)
        .eq("documentId", documentId)
        .eq("companyId", companyId)
        .single();

      if (!thread) {
        return { success: true, message: "No Slack thread found" };
      }

      const { data: integration } = await serviceRole
        .from("companyIntegration")
        .select("metadata")
        .eq("id", "slack")
        .eq("companyId", companyId)
        .single();

      if (!integration?.metadata) {
        throw new Error("Slack integration not found");
      }

      const slackToken = (integration.metadata as any).access_token as string;

      const documentData = await getDocumentData(
        serviceRole,
        documentType,
        documentId,
        companyId
      );

      if (!documentData) {
        throw new Error(`${documentType} ${documentId} not found`);
      }

      const assignmentUpdate: IssueAssignmentUpdate = {
        previousAssignee,
        newAssignee,
        updatedBy,
      };

      await postToSlackThread({
        token: slackToken,
        channelId: thread.channelId,
        threadTs: thread.threadTs,
        blocks: formatAssignmentUpdate(
          documentType,
          documentData.readableId,
          assignmentUpdate
        ),
      });

      return { success: true };
    } catch (error) {
      console.error(
        `Error posting ${documentType} assignment update to Slack:`,
        error
      );
      throw error;
    }
  },
});

async function getDocumentData(
  serviceRole: SupabaseClient<Database>,
  documentType: DocumentType,
  documentId: string,
  companyId: string
): Promise<any | null> {
  switch (documentType) {
    case "nonConformance": {
      const { data } = await serviceRole
        .from("nonConformance")
        .select("*")
        .eq("id", documentId)
        .eq("companyId", companyId)
        .single();

      if (!data) return null;

      return {
        documentType: "nonConformance",
        id: data.id,
        readableId: data.nonConformanceId,
        nonConformanceId: data.nonConformanceId,
        title: data.name,
        description: data.description,
        status: data.status,
        createdBy: data.createdBy,
        createdAt: data.createdAt,
      } as NonConformanceData;
    }

    case "quote": {
      const { data } = await serviceRole
        .from("quote")
        .select("id, quoteId, customerReference, status, createdBy, createdAt")
        .eq("id", documentId)
        .eq("companyId", companyId)
        .single();

      if (!data) return null;

      return {
        documentType: "quote",
        id: data.id,
        readableId: data.quoteId,
        title: data.customerReference,
        description: data.customerReference,
        status: data.status,
        createdBy: data.createdBy,
        createdAt: data.createdAt,
      };
    }

    case "salesOrder": {
      const { data } = await serviceRole
        .from("salesOrder")
        .select(
          "id, salesOrderId, customerReference, status, createdBy, createdAt"
        )
        .eq("id", documentId)
        .eq("companyId", companyId)
        .single();

      if (!data) return null;

      return {
        documentType: "salesOrder",
        id: data.id,
        readableId: data.salesOrderId,
        title: data.customerReference,
        description: data.customerReference,
        status: data.status,
        createdBy: data.createdBy,
        createdAt: data.createdAt,
      };
    }

    case "job": {
      const { data } = await serviceRole
        .from("job")
        .select("id, jobId, status, createdBy, createdAt")
        .eq("id", documentId)
        .eq("companyId", companyId)
        .single();

      if (!data) return null;

      return {
        documentType: "job",
        id: data.id,
        readableId: data.jobId,
        title: data.jobId,
        description: data.jobId,
        status: data.status,
        createdBy: data.createdBy,
        createdAt: data.createdAt,
      };
    }

    case "purchaseOrder":
    case "invoice":
    case "receipt":
    case "shipment":
    default:
      console.warn(`Document type ${documentType} not yet implemented`);
      return null;
  }
}

async function postToSlackThread(params: {
  token: string;
  channelId: string;
  threadTs: string;
  blocks: any[];
  text?: string;
}) {
  const { token, channelId, threadTs, blocks, text } = params;

  const client = new WebClient(token);

  return await client.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    blocks,
    text: text || "Update from Carbon",
  });
}

export const slackNcrCreated = slackDocumentCreated;
export const slackNcrStatusUpdate = slackDocumentStatusUpdate;
export const slackNcrTaskUpdate = slackDocumentTaskUpdate;
export const slackNcrAssignmentUpdate = slackDocumentAssignmentUpdate;
