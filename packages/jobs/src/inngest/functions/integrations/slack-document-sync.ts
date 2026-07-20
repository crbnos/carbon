import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import {
  type DocumentType,
  formatAssignmentUpdate,
  formatDocumentCreated,
  formatStatusUpdate,
  formatTaskUpdate,
  type IssueAssignmentUpdate,
  type IssueStatusUpdate,
  type IssueTaskUpdate,
  type NonConformanceData
} from "@carbon/ee/slack/messages";
import { VERCEL_URL } from "@carbon/env";
import { getLogger } from "@carbon/logger";
import { WebClient } from "@slack/web-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inngest } from "../../client";

const log = getLogger("jobs", "slack-document-sync");

export const slackDocumentCreatedFunction = inngest.createFunction(
  { id: "slack-document-created", retries: 1 },
  { event: "carbon/slack-document-created" },
  async ({ event, step, logger }) => {
    const { documentType, documentId, companyId, channelId, threadTs } =
      event.data as {
        documentType: DocumentType;
        documentId: string;
        companyId: string;
        channelId: string;
        threadTs: string;
      };

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
        blocks: formatDocumentCreated(documentData, baseUrl)
      });

      return { success: true };
    } catch (error) {
      logger.error(`Error posting ${documentType} to Slack`, { error });
      throw error;
    }
  }
);

export const slackDocumentStatusUpdateFunction = inngest.createFunction(
  { id: "slack-document-status-update", retries: 1 },
  { event: "carbon/slack-document-status-update" },
  async ({ event, step, logger }) => {
    const {
      documentType,
      documentId,
      companyId,
      previousStatus,
      newStatus,
      updatedBy,
      reason
    } = event.data as {
      documentType: DocumentType;
      documentId: string;
      companyId: string;
      previousStatus: string;
      newStatus: string;
      updatedBy: string;
      reason?: string;
    };

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
        reason
      };

      await postToSlackThread({
        token: slackToken,
        channelId: thread.channelId,
        threadTs: thread.threadTs,
        blocks: formatStatusUpdate(
          documentType,
          documentData.readableId,
          statusUpdate
        )
      });

      return { success: true };
    } catch (error) {
      logger.error(`Error posting ${documentType} status update to Slack`, {
        error
      });
      throw error;
    }
  }
);

export const slackDocumentTaskUpdateFunction = inngest.createFunction(
  { id: "slack-document-task-update", retries: 1 },
  { event: "carbon/slack-document-task-update" },
  async ({ event, step, logger }) => {
    const {
      documentType,
      documentId,
      companyId,
      taskType,
      taskName,
      status,
      assignee,
      completedAt
    } = event.data as {
      documentType: DocumentType;
      documentId: string;
      companyId: string;
      taskType: "investigation" | "action" | "approval";
      taskName: string;
      status: string;
      assignee?: string | null;
      completedAt?: string;
    };

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
        completedAt
      };

      await postToSlackThread({
        token: slackToken,
        channelId: thread.channelId,
        threadTs: thread.threadTs,
        blocks: formatTaskUpdate(
          documentType,
          documentData.readableId,
          taskUpdate
        )
      });

      return { success: true };
    } catch (error) {
      logger.error(`Error posting ${documentType} task update to Slack`, {
        error
      });
      throw error;
    }
  }
);

export const slackDocumentAssignmentUpdateFunction = inngest.createFunction(
  { id: "slack-document-assignment-update", retries: 1 },
  { event: "carbon/slack-document-assignment-update" },
  async ({ event, step, logger }) => {
    const {
      documentType,
      documentId,
      companyId,
      previousAssignee,
      newAssignee,
      updatedBy
    } = event.data as {
      documentType: DocumentType;
      documentId: string;
      companyId: string;
      previousAssignee?: string;
      newAssignee: string;
      updatedBy: string;
    };

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
        updatedBy
      };

      await postToSlackThread({
        token: slackToken,
        channelId: thread.channelId,
        threadTs: thread.threadTs,
        blocks: formatAssignmentUpdate(
          documentType,
          documentData.readableId,
          assignmentUpdate
        )
      });

      return { success: true };
    } catch (error) {
      logger.error(`Error posting ${documentType} assignment update to Slack`, {
        error
      });
      throw error;
    }
  }
);

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
        createdAt: data.createdAt
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
        createdAt: data.createdAt
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
        createdAt: data.createdAt
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
        createdAt: data.createdAt
      };
    }

    case "purchaseOrder":
    case "invoice":
    case "receipt":
    case "shipment":
    default:
      log.warning(`Document type ${documentType} not yet implemented`);
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
    text: text || "Update from Carbon"
  });
}
