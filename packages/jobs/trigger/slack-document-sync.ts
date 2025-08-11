import { getCarbonServiceRole, VERCEL_URL } from "@carbon/auth";
import { WebClient } from "@slack/web-api";
import { task } from "@trigger.dev/sdk/v3";

// Type definitions
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
  assignedTo?: string;
  completedBy?: string;
  completedAt?: string;
  notes?: string;
}

interface AssignmentUpdate {
  previousAssignee?: string;
  newAssignee: string;
  updatedBy: string;
}

/**
 * Post initial document creation message to Slack
 */
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

      // Get the document details based on type
      const documentData = await getDocumentData(
        serviceRole,
        documentType,
        documentId,
        companyId
      );

      if (!documentData) {
        throw new Error(`${documentType} ${documentId} not found`);
      }

      // Get the Slack integration
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

      // Post detailed information to the thread
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

/**
 * Post status update to Slack thread
 */
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

      // Get the Slack thread for this document
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

      // Get the Slack integration
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

      // Get the document identifier for display
      const documentIdentifier = await getDocumentIdentifier(
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

      // Post status update to the thread
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

/**
 * Post task update to Slack thread (mainly for non-conformances)
 */
export const slackDocumentTaskUpdate = task({
  id: "slack-document-task-update",
  run: async (payload: {
    documentType: DocumentType;
    documentId: string;
    companyId: string;
    taskType: "investigation" | "action" | "approval";
    taskName: string;
    status: string;
    assignedTo?: string;
    completedBy?: string;
    completedAt?: string;
    notes?: string;
  }) => {
    const {
      documentType,
      documentId,
      companyId,
      taskType,
      taskName,
      status,
      assignedTo,
      completedBy,
      completedAt,
      notes,
    } = payload;

    try {
      const serviceRole = await getCarbonServiceRole();

      // Get the Slack thread for this document
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

      // Get the Slack integration
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

      // Get the document identifier for display
      const documentIdentifier = await getDocumentIdentifier(
        serviceRole,
        documentType,
        documentId,
        companyId
      );

      const taskUpdate: TaskUpdate = {
        taskType,
        taskName,
        status,
        assignedTo,
        completedBy,
        completedAt,
        notes,
      };

      // Post task update to the thread
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

/**
 * Post assignment update to Slack thread
 */
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

      // Get the Slack thread for this document
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

      // Get the Slack integration
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

      // Get the document identifier for display
      const documentIdentifier = await getDocumentIdentifier(
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

      // Post assignment update to the thread
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

/**
 * Helper function to get document data based on type
 */
async function getDocumentData(
  serviceRole: any,
  documentType: DocumentType,
  documentId: string,
  companyId: string
): Promise<DocumentData | null> {
  switch (documentType) {
    case "nonConformance": {
      const { data } = await serviceRole
        .from("nonConformance")
        .select(
          `
          *,
          type:typeId(name),
          workflow:workflowId(name)
        `
        )
        .eq("id", documentId)
        .eq("companyId", companyId)
        .single();

      if (!data) return null;

      // Get investigation and action tasks
      const [investigations, actions] = await Promise.all([
        serviceRole
          .from("nonConformanceInvestigationTask")
          .select("investigationType")
          .eq("nonConformanceId", documentId)
          .eq("companyId", companyId),
        serviceRole
          .from("nonConformanceActionTask")
          .select("actionType")
          .eq("nonConformanceId", documentId)
          .eq("companyId", companyId),
      ]);

      return {
        documentType: "nonConformance",
        id: data.id,
        nonConformanceId: data.nonConformanceId,
        title: data.title,
        description: data.description,
        status: data.status,
        severity: data.severity,
        typeId: data.typeId,
        typeName: data.type?.name,
        workflowName: data.workflow?.name,
        createdBy: data.createdBy,
        createdAt: data.createdAt,
        investigationTypes:
          investigations.data?.map((i) => i.investigationType) || [],
        requiredActions: actions.data?.map((a) => a.actionType) || [],
      } as NonConformanceData;
    }

    // Add other document types here in the future
    case "quote":
    case "salesOrder":
    case "job":
    default:
      console.warn(`Document type ${documentType} not yet implemented`);
      return null;
  }
}

/**
 * Helper function to get document identifier for display
 */
async function getDocumentIdentifier(
  serviceRole: any,
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

    // Add other document types here
    default:
      return documentId;
  }
}

/**
 * Helper function to post messages to a Slack thread
 */
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

/**
 * Format document creation message for Slack
 */
function formatDocumentCreated(
  data: DocumentData,
  baseUrl: string
): any[] {
  const blocks: any[] = [];
  
  if (data.documentType === "nonConformance") {
    const ncData = data as NonConformanceData;
    
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Non-Conformance Created: ${ncData.nonConformanceId}*\n${ncData.title || "No title"}`,
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
          text: `*Investigation Types:*\n${ncData.investigationTypes.join(", ")}`,
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

/**
 * Format status update message for Slack
 */
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
      text: `${emoji} *Status Updated*\n${documentIdentifier}`,
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
        text: `Updated by ${update.updatedBy} at <!date^${Math.floor(Date.now() / 1000)}^{date_short_pretty} {time}|${new Date().toISOString()}>`,
      },
    ],
  });
  
  return blocks;
}

/**
 * Format task update message for Slack
 */
function formatTaskUpdate(
  documentType: DocumentType,
  documentIdentifier: string,
  update: TaskUpdate
): any[] {
  const blocks: any[] = [];
  
  const emoji = getTaskStatusEmoji(update.status);
  const taskTypeLabel = 
    update.taskType === "investigation" ? "Investigation" :
    update.taskType === "action" ? "Action" :
    "Approval";
  
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
  
  if (update.assignedTo) {
    fields.push({
      type: "mrkdwn",
      text: `*Assigned To:*\n${update.assignedTo}`,
    });
  }
  
  if (update.completedBy) {
    fields.push({
      type: "mrkdwn",
      text: `*Completed By:*\n${update.completedBy}`,
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

/**
 * Format assignment update message for Slack
 */
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
        text: `Updated by ${update.updatedBy} at <!date^${Math.floor(Date.now() / 1000)}^{date_short_pretty} {time}|${new Date().toISOString()}>`,
      },
    ],
  });
  
  return blocks;
}

/**
 * Get emoji for status
 */
function getStatusEmoji(status: string): string {
  const statusLower = status.toLowerCase();
  
  if (statusLower.includes("closed") || statusLower.includes("complete")) {
    return "✅";
  } else if (statusLower.includes("progress") || statusLower.includes("review")) {
    return "🔄";
  } else if (statusLower.includes("pending") || statusLower.includes("open")) {
    return "📋";
  } else if (statusLower.includes("rejected") || statusLower.includes("cancelled")) {
    return "❌";
  }
  
  return "📌";
}

/**
 * Get emoji for task status
 */
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

// Backward compatibility exports
export const slackNcrCreated = slackDocumentCreated;
export const slackNcrStatusUpdate = slackDocumentStatusUpdate;
export const slackNcrTaskUpdate = slackDocumentTaskUpdate;
export const slackNcrAssignmentUpdate = slackDocumentAssignmentUpdate;
