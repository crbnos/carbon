import type { KnownBlock } from "@slack/types";

export type DocumentType =
  | "nonConformance"
  | "quote"
  | "salesOrder"
  | "job"
  | "purchaseOrder"
  | "invoice"
  | "receipt"
  | "shipment";

export interface BaseDocumentData {
  documentType: DocumentType;
  id: string;
  readableId: string;
  title?: string;
  description?: string;
  status?: string;
  createdBy?: string;
  createdAt?: string;
}

export interface NonConformanceData extends BaseDocumentData {
  documentType: "nonConformance";
  nonConformanceId: string;
  severity?: string;
  typeId?: string;
  typeName?: string;
  workflowName?: string;
  investigationTypes?: string[];
  requiredActions?: string[];
}

export type DocumentData = NonConformanceData;

export interface IssueTaskUpdate {
  taskType: "investigation" | "action" | "approval";
  taskName: string;
  status: string;
  assignee?: string | null;
  readableId?: string;
  completedBy?: string;
  completedAt?: string;
  notes?: string;
}

export interface IssueStatusUpdate {
  previousStatus: string;
  newStatus: string;
  updatedBy: string;
  reason?: string;
}

export interface IssueAssignmentUpdate {
  previousAssignee?: string;
  newAssignee: string;
  updatedBy: string;
}

function getDocumentTypeInfo(documentType: DocumentType): {
  emoji: string;
  name: string;
  urlPath: string;
} {
  const typeMap = {
    nonConformance: {
      emoji: "⚠️",
      name: "Issue",
      urlPath: "/x/issue",
    },
  };

  return typeMap[documentType];
}

/**
 * Get document identifier for display
 */
function getDocumentIdentifier(data: DocumentData): string {
  switch (data.documentType) {
    case "nonConformance":
      return (data as NonConformanceData).nonConformanceId;

    default:
      throw new Error(`Unknown document type: ${data.documentType}`);
  }
}

/**
 * Format the initial document creation message
 */
export function formatDocumentCreated(
  data: DocumentData,
  baseUrl: string
): KnownBlock[] {
  const typeInfo = getDocumentTypeInfo(data.documentType);
  const identifier = getDocumentIdentifier(data);

  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${typeInfo.emoji} #${identifier}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${data.title || "No title"}*\n${
          data.description || "_No description provided_"
        }`,
      },
      fields: [
        {
          type: "mrkdwn",
          text: `*Status:*\n${data.status || "Unknown"}`,
        },
        {
          type: "mrkdwn",
          text: `*Type:*\n${typeInfo.name}`,
        },
      ],
    },
  ];

  // Add document-specific fields
  const specificFields = getDocumentSpecificFields(data);
  if (specificFields.length > 0) {
    blocks.push({
      type: "section",
      fields: specificFields,
    });
  }

  // Add document-specific sections
  const specificSections = getDocumentSpecificSections(data);
  blocks.push(...specificSections);

  // Add context
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Created ${data.createdBy ? `by <@${data.createdBy}>` : ""} ${
          data.createdAt
            ? `on <!date^${Math.floor(
                new Date(data.createdAt).getTime() / 1000
              )}^{date_short_pretty} at {time}|${data.createdAt}>`
            : ""
        }`.trim(),
      },
    ],
  });

  // Add action buttons
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "View in Carbon",
        },
        url: `${baseUrl}${typeInfo.urlPath}/${data.id}`,
        action_id: "view_in_carbon",
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Update Status",
        },
        value: data.id,
        action_id: `update_${data.documentType}_status`,
      },
    ],
  });

  return blocks;
}

/**
 * Get document-specific fields for the main section
 */
function getDocumentSpecificFields(data: DocumentData): any[] {
  const fields: any[] = [];

  switch (data.documentType) {
    case "nonConformance":
      const ncrData = data as NonConformanceData;
      if (ncrData.severity) {
        fields.push({
          type: "mrkdwn",
          text: `*Severity:*\n${ncrData.severity}`,
        });
      }
      if (ncrData.typeName) {
        fields.push({
          type: "mrkdwn",
          text: `*Issue Type:*\n${ncrData.typeName}`,
        });
      }
      break;
  }

  return fields;
}

/**
 * Get document-specific sections
 */
function getDocumentSpecificSections(data: DocumentData): KnownBlock[] {
  const sections: KnownBlock[] = [];

  switch (data.documentType) {
    case "nonConformance":
      const ncrData = data as NonConformanceData;
      if (
        ncrData.investigationTypes?.length ||
        ncrData.requiredActions?.length
      ) {
        let text = "";
        if (ncrData.investigationTypes?.length) {
          text += `*Investigations:*\n${ncrData.investigationTypes
            .map((t) => `• ${t}`)
            .join("\n")}\n\n`;
        }
        if (ncrData.requiredActions?.length) {
          text += `*Required Actions:*\n${ncrData.requiredActions
            .map((a) => `• ${a}`)
            .join("\n")}`;
        }

        sections.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: text.trim(),
          },
        });
      }
      break;
  }

  return sections;
}

/**
 * Format a status update message
 */
export function formatStatusUpdate(
  documentType: DocumentType,
  documentIdentifier: string,
  update: IssueStatusUpdate
): KnownBlock[] {
  const emoji = getStatusEmoji(update.newStatus);

  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} *Issue Status Updated*\n${documentIdentifier}`,
      },
    },
    {
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
    },
  ];

  if (update.reason) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Reason:* ${update.reason}`,
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

/**
 * Format a task update message
 */
export function formatTaskUpdate(
  documentType: DocumentType,
  documentIdentifier: string,
  update: IssueTaskUpdate
): KnownBlock[] {
  const taskTypeLabel = {
    investigation: "Investigation",
    action: "Action",
    approval: "Approval",
  }[update.taskType];

  const statusEmoji = getTaskStatusEmoji(update.status);

  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${statusEmoji} *${taskTypeLabel} Task ${update.status}*\n_${update.taskName}_`,
      },
    },
  ];

  const fields: any[] = [];

  if (update.assignee) {
    fields.push({
      type: "mrkdwn",
      text: `*Assigned to:*\n<@${update.assignee}>`,
    });
  }

  if (update.completedBy) {
    fields.push({
      type: "mrkdwn",
      text: `*Completed by:*\n<@${update.completedBy}>`,
    });
  }

  if (fields.length > 0) {
    blocks.push({
      type: "section",
      fields,
    });
  }

  if (update.notes) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Notes:* ${update.notes}`,
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `#${documentIdentifier} ${
          update.completedAt
            ? `• Completed <!date^${Math.floor(
                new Date(update.completedAt).getTime() / 1000
              )}^{date_short_pretty} at {time}|${update.completedAt}>`
            : ""
        }`.trim(),
      },
    ],
  });

  return blocks;
}

/**
 * Format an assignment update message
 */
export function formatAssignmentUpdate(
  documentType: DocumentType,
  documentIdentifier: string,
  update: IssueAssignmentUpdate
): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🎯 *Assignment Updated*\n${documentIdentifier}`,
      },
    },
  ];

  const fields: any[] = [];

  if (update.previousAssignee) {
    fields.push({
      type: "mrkdwn",
      text: `*Previous Assignee:*\n<@${update.previousAssignee}>`,
    });
  }

  fields.push({
    type: "mrkdwn",
    text: `*New Assignee:*\n<@${update.newAssignee}>`,
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

/**
 * Format a simple notification message
 */
export function formatSimpleNotification(
  title: string,
  message: string,
  context?: string
): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${title}*\n${message}`,
      },
    },
  ];

  if (context) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: context,
        },
      ],
    });
  }

  return blocks;
}

/**
 * Get status emoji based on status string
 */
export function getStatusEmoji(status: string): string {
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

/**
 * Get task status emoji based on status string
 */
export function getTaskStatusEmoji(status: string): string {
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

// Backward compatibility exports for NCR-specific functions
export function formatNonConformanceCreated(
  data: NonConformanceData,
  baseUrl: string
): KnownBlock[] {
  return formatDocumentCreated(data, baseUrl);
}
