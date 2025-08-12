import { getCarbonServiceRole, VERCEL_URL } from "@carbon/auth";
import type { Database } from "@carbon/database";
import { WebClient } from "@slack/web-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { task } from "@trigger.dev/sdk/v3";

type DocumentType =
  | "nonConformance"
  | "quote"
  | "salesOrder"
  | "job"
  | "purchaseOrder"
  | "invoice"
  | "receipt"
  | "shipment";

interface DocumentData {
  documentType: DocumentType;
  id: string;
  title?: string;
  description?: string;
  status?: string;
  createdBy?: string;
  createdAt?: string;
}

interface NonConformanceData extends DocumentData {
  documentType: "nonConformance";
  nonConformanceId: string;
  severity?: string;
  typeId?: string;
  typeName?: string;
  workflowName?: string;
  investigationTypes?: string[];
  requiredActions?: string[];
}

interface StatusUpdate {
  previousStatus: string;
  newStatus: string;
  updatedBy: string;
  reason?: string;
}

interface TaskUpdate {
  taskType: "investigation" | "action" | "approval";
  taskName: string;
  status: string;
  assignee?: string | null;
  readableId?: string;
  completedBy?: string;
  completedAt?: string;
  notes?: string;
}

interface AssignmentUpdate {
  previousAssignee?: string;
  newAssignee: string;
  updatedBy: string;
}

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

      const documentIdentifier = await getDocumentReadableId(
        serviceRole,
        documentType,
        documentId,
        companyId
      );

      const statusUpdate: StatusUpdate = {
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
          documentIdentifier,
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

      const documentIdentifier = await getDocumentReadableId(
        serviceRole,
        documentType,
        documentId,
        companyId
      );

      const taskUpdate: TaskUpdate = {
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
        blocks: formatTaskUpdate(documentType, documentIdentifier, taskUpdate),
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

      const documentIdentifier = await getDocumentReadableId(
        serviceRole,
        documentType,
        documentId,
        companyId
      );

      const assignmentUpdate: AssignmentUpdate = {
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
          documentIdentifier,
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
): Promise<DocumentData | null> {
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
        nonConformanceId: data.nonConformanceId,
        title: data.name,
        description: data.description,
        status: data.status,
        createdBy: data.createdBy,
        createdAt: data.createdAt,
      } as NonConformanceData;
    }

    case "quote":
    case "salesOrder":
    case "job":
    default:
      console.warn(`Document type ${documentType} not yet implemented`);
      return null;
  }
}

async function getDocumentReadableId(
  serviceRole: SupabaseClient<Database>,
  documentType: DocumentType,
  documentId: string,
  companyId: string
): Promise<string> {
  switch (documentType) {
    case "nonConformance": {
      const { data } = await serviceRole
        .from("nonConformance")
        .select("nonConformanceId")
        .eq("id", documentId)
        .single();
      return data?.nonConformanceId || documentId;
    }

    default:
      return documentId;
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

function formatDocumentCreated(data: DocumentData, baseUrl: string): any[] {
  const blocks: any[] = [];

  if (data.documentType === "nonConformance") {
    const ncData = data as NonConformanceData;

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Non-Conformance Created: ${ncData.nonConformanceId}*\n${
          ncData.title || "No title"
        }`,
      },
    });

    if (ncData.description) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Description:*\n${ncData.description}`,
        },
      });
    }

    const fields: any[] = [];

    if (ncData.status) {
      fields.push({
        type: "mrkdwn",
        text: `*Status:*\n${ncData.status}`,
      });
    }

    if (ncData.severity) {
      fields.push({
        type: "mrkdwn",
        text: `*Severity:*\n${ncData.severity}`,
      });
    }

    if (ncData.typeName) {
      fields.push({
        type: "mrkdwn",
        text: `*Type:*\n${ncData.typeName}`,
      });
    }

    if (ncData.workflowName) {
      fields.push({
        type: "mrkdwn",
        text: `*Workflow:*\n${ncData.workflowName}`,
      });
    }

    if (fields.length > 0) {
      blocks.push({
        type: "section",
        fields,
      });
    }

    if (ncData.investigationTypes && ncData.investigationTypes.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Investigation Types:*\n${ncData.investigationTypes.join(
            ", "
          )}`,
        },
      });
    }

    if (ncData.requiredActions && ncData.requiredActions.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Required Actions:*\n${ncData.requiredActions.join(", ")}`,
        },
      });
    }

    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "View in Carbon",
          },
          url: `${baseUrl}/x/issue/${ncData.id}`,
          action_id: "view_nonconformance",
        },
      ],
    });
  }

  blocks.push({
    type: "divider",
  });

  return blocks;
}

function formatStatusUpdate(
  documentType: DocumentType,
  documentIdentifier: string,
  update: StatusUpdate
): any[] {
  const blocks: any[] = [];

  const emoji = getStatusEmoji(update.newStatus);

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `${emoji} *Issue Status Updated*\n${documentIdentifier}`,
    },
  });

  blocks.push({
    type: "section",
    fields: [
      {
        type: "mrkdwn",
        text: `*From:*\n${update.previousStatus}`,
      },
      {
        type: "mrkdwn",
        text: `*To:*\n${update.newStatus}`,
      },
    ],
  });

  if (update.reason) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Reason:*\n${update.reason}`,
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Updated by <@${update.updatedBy}> at <!date^${Math.floor(
          Date.now() / 1000
        )}^{date_short_pretty} {time}|${new Date().toISOString()}>`,
      },
    ],
  });

  return blocks;
}

function formatTaskUpdate(
  documentType: DocumentType,
  documentIdentifier: string,
  update: TaskUpdate
): any[] {
  const blocks: any[] = [];

  const emoji = getTaskStatusEmoji(update.status);
  const taskTypeLabel =
    update.taskType === "investigation"
      ? "Investigation"
      : update.taskType === "action"
      ? "Action"
      : "Approval";

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `${emoji} *${taskTypeLabel} Task Updated*\n${documentIdentifier}`,
    },
  });

  const fields: any[] = [
    {
      type: "mrkdwn",
      text: `*Task:*\n${update.taskName}`,
    },
    {
      type: "mrkdwn",
      text: `*Status:*\n${update.status}`,
    },
  ];

  if (update.assignee) {
    fields.push({
      type: "mrkdwn",
      text: `*Assigned To:*\n<@${update.assignee}>`,
    });
  }

  if (update.completedBy) {
    fields.push({
      type: "mrkdwn",
      text: `*Completed By:*\n<@${update.completedBy}>`,
    });
  }

  blocks.push({
    type: "section",
    fields,
  });

  if (update.notes) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Notes:*\n${update.notes}`,
      },
    });
  }

  if (update.completedAt) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Completed at ${update.completedAt}`,
        },
      ],
    });
  }

  return blocks;
}

function formatAssignmentUpdate(
  documentType: DocumentType,
  documentIdentifier: string,
  update: AssignmentUpdate
): any[] {
  const blocks: any[] = [];

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `👤 *Assignment Updated*\n${documentIdentifier}`,
    },
  });

  const fields: any[] = [];

  if (update.previousAssignee) {
    fields.push({
      type: "mrkdwn",
      text: `*Previous Assignee:*\n${update.previousAssignee}`,
    });
  }

  fields.push({
    type: "mrkdwn",
    text: `*New Assignee:*\n${update.newAssignee}`,
  });

  blocks.push({
    type: "section",
    fields,
  });

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Updated by <@${update.updatedBy}> at <!date^${Math.floor(
          Date.now() / 1000
        )}^{date_short_pretty} {time}|${new Date().toISOString()}>`,
      },
    ],
  });

  return blocks;
}

function getStatusEmoji(status: string): string {
  const statusLower = status.toLowerCase();

  if (statusLower.includes("closed") || statusLower.includes("complete")) {
    return "✅";
  } else if (
    statusLower.includes("progress") ||
    statusLower.includes("review")
  ) {
    return "🚀";
  } else if (statusLower.includes("pending") || statusLower.includes("open")) {
    return "📋";
  } else if (
    statusLower.includes("rejected") ||
    statusLower.includes("cancelled")
  ) {
    return "❌";
  }

  return "📌";
}

function getTaskStatusEmoji(status: string): string {
  const statusLower = status.toLowerCase();

  if (statusLower.includes("completed")) {
    return "✅";
  } else if (statusLower.includes("progress")) {
    return "⏳";
  } else if (statusLower.includes("skipped")) {
    return "⏭️";
  } else if (statusLower.includes("pending")) {
    return "⏸️";
  }

  return "📝";
}

export const slackNcrCreated = slackDocumentCreated;
export const slackNcrStatusUpdate = slackDocumentStatusUpdate;
export const slackNcrTaskUpdate = slackDocumentTaskUpdate;
export const slackNcrAssignmentUpdate = slackDocumentAssignmentUpdate;
