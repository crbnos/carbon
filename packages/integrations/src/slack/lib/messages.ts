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
  id: string;
  documentType: DocumentType;
  title: string;
  description?: string;
  status: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  assignedTo?: string;
  metadata?: Record<string, any>;
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

export interface QuoteData extends BaseDocumentData {
  documentType: "quote";
  quoteId: string;
  customerName?: string;
  expirationDate?: string;
}

export interface SalesOrderData extends BaseDocumentData {
  documentType: "salesOrder";
  salesOrderId: string;
  customerName?: string;
  deliveryDate?: string;
}

export interface JobData extends BaseDocumentData {
  documentType: "job";
  jobId: string;
  partNumber?: string;
  quantity?: number;
  dueDate?: string;
}

export type DocumentData =
  | NonConformanceData
  | QuoteData
  | SalesOrderData
  | JobData;

export interface TaskUpdate {
  taskType: "investigation" | "action" | "approval";
  taskName: string;
  status: string;
  assignedTo?: string;
  completedBy?: string;
  completedAt?: string;
  notes?: string;
}

export interface StatusUpdate {
  previousStatus: string;
  newStatus: string;
  updatedBy: string;
  reason?: string;
}

export interface AssignmentUpdate {
  previousAssignee?: string;
  newAssignee: string;
  updatedBy: string;
}

/**
 * Get document type display info
 */
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
    quote: {
      emoji: "💰",
      name: "Quote",
      urlPath: "/x/quote",
    },
    salesOrder: {
      emoji: "📦",
      name: "Sales Order",
      urlPath: "/x/sales-order",
    },
    job: { emoji: "🔧", name: "Job", urlPath: "/x/job" },
    purchaseOrder: {
      emoji: "📋",
      name: "Purchase Order",
      urlPath: "/x/purchase-order",
    },
    invoice: {
      emoji: "🧾",
      name: "Invoice",
      urlPath: "/x/invoice",
    },
    receipt: {
      emoji: "📥",
      name: "Receipt",
      urlPath: "/x/receipt",
    },
    shipment: {
      emoji: "🚚",
      name: "Shipment",
      urlPath: "/x/shipment",
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
    case "quote":
      return (data as QuoteData).quoteId;
    case "salesOrder":
      return (data as SalesOrderData).salesOrderId;
    case "job":
      return (data as JobData).jobId;
    default:
      // @ts-expect-error - this is a fallback for unknown document types
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
        text: `*${data.title}*\n${
          data.description || "_No description provided_"
        }`,
      },
      fields: [
        {
          type: "mrkdwn",
          text: `*Status:*\n${data.status}`,
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

    case "quote":
      const quoteData = data as QuoteData;
      if (quoteData.customerName) {
        fields.push({
          type: "mrkdwn",
          text: `*Customer:*\n${quoteData.customerName}`,
        });
      }
      break;

    case "salesOrder":
      const soData = data as SalesOrderData;
      if (soData.customerName) {
        fields.push({
          type: "mrkdwn",
          text: `*Customer:*\n${soData.customerName}`,
        });
      }
      break;

    case "job":
      const jobData = data as JobData;
      if (jobData.partNumber) {
        fields.push({
          type: "mrkdwn",
          text: `*Part Number:*\n${jobData.partNumber}`,
        });
      }
      if (jobData.quantity) {
        fields.push({
          type: "mrkdwn",
          text: `*Quantity:*\n${jobData.quantity.toLocaleString()}`,
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

    case "quote":
      const quoteData = data as QuoteData;
      if (quoteData.expirationDate) {
        sections.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Expires:* <!date^${Math.floor(
              new Date(quoteData.expirationDate).getTime() / 1000
            )}^{date_short_pretty}|${quoteData.expirationDate}>`,
          },
        });
      }
      break;

    case "job":
      const jobData = data as JobData;
      if (jobData.dueDate) {
        sections.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Due Date:* <!date^${Math.floor(
              new Date(jobData.dueDate).getTime() / 1000
            )}^{date_short_pretty}|${jobData.dueDate}>`,
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
  update: StatusUpdate
): KnownBlock[] {
  const typeInfo = getDocumentTypeInfo(documentType);

  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${typeInfo.emoji} *Status Updated*\n\`${update.previousStatus}\` → \`${update.newStatus}\``,
      },
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
        text: `Updated by <@${update.updatedBy}> • #${documentIdentifier}`,
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
  update: TaskUpdate
): KnownBlock[] {
  const taskTypeLabel = {
    investigation: "Investigation",
    action: "Action",
    approval: "Approval",
  }[update.taskType];

  const statusEmoji =
    {
      Pending: "⏳",
      "In Progress": "🔄",
      Completed: "✅",
      Skipped: "⏭️",
    }[update.status] || "📋";

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

  if (update.assignedTo) {
    fields.push({
      type: "mrkdwn",
      text: `*Assigned to:*\n<@${update.assignedTo}>`,
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
  update: AssignmentUpdate
): KnownBlock[] {
  const typeInfo = getDocumentTypeInfo(documentType);

  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${typeInfo.emoji} *Assignment Updated*\n${
          update.previousAssignee
            ? `<@${update.previousAssignee}> → <@${update.newAssignee}>`
            : `Assigned to <@${update.newAssignee}>`
        }`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Updated by <@${update.updatedBy}> • #${documentIdentifier}`,
        },
      ],
    },
  ];

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

// Backward compatibility exports for NCR-specific functions
export function formatNonConformanceCreated(
  data: NonConformanceData,
  baseUrl: string
): KnownBlock[] {
  return formatDocumentCreated(data, baseUrl);
}
