import { getCarbonServiceRole } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tasks } from "@trigger.dev/sdk/v3";

export type DocumentType =
  | "nonConformance"
  | "quote"
  | "salesOrder"
  | "job"
  | "purchaseOrder"
  | "invoice"
  | "receipt"
  | "shipment";

export interface SlackDocumentThread {
  id: string;
  companyId: string;
  documentType: DocumentType;
  documentId: string;
  channelId: string;
  threadTs: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
}

/**
 * Get Slack thread for any document type
 */
export async function getSlackDocumentThread(
  client: SupabaseClient<Database>,
  documentType: DocumentType,
  documentId: string,
  companyId: string
) {
  return client
    .from("slackDocumentThread")
    .select("*")
    .eq("documentType", documentType)
    .eq("documentId", documentId)
    .eq("companyId", companyId)
    .single();
}

/**
 * Create Slack thread mapping for any document type
 */
export async function createSlackDocumentThread(
  client: SupabaseClient<Database>,
  data: {
    documentType: DocumentType;
    documentId: string;
    companyId: string;
    channelId: string;
    threadTs: string;
    createdBy: string;
  }
) {
  return client.from("slackDocumentThread").insert(data).select("*").single();
}

/**
 * Update Slack thread mapping
 */
export async function updateSlackDocumentThread(
  client: SupabaseClient<Database>,
  id: string,
  updates: {
    channelId?: string;
    threadTs?: string;
    updatedBy: string;
  }
) {
  return client
    .from("slackDocumentThread")
    .update({
      ...updates,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
}

/**
 * Delete Slack thread mapping
 */
export async function deleteSlackDocumentThread(
  client: SupabaseClient<Database>,
  documentType: DocumentType,
  documentId: string,
  companyId: string
) {
  return client
    .from("slackDocumentThread")
    .delete()
    .eq("documentType", documentType)
    .eq("documentId", documentId)
    .eq("companyId", companyId);
}

/**
 * Get all Slack threads for a company (optionally filtered by document type)
 */
export async function getCompanySlackThreads(
  client: SupabaseClient<Database>,
  companyId: string,
  documentType?: DocumentType
) {
  let query = client
    .from("slackDocumentThread")
    .select("*")
    .eq("companyId", companyId);

  if (documentType) {
    query = query.eq("documentType", documentType);
  }

  return query.order("createdAt", { ascending: false });
}

/**
 * Generic function to sync document updates to Slack
 */
export async function syncDocumentToSlack(
  client: SupabaseClient<Database>,
  data: {
    documentType: DocumentType;
    documentId: string;
    companyId: string;
    updateType:
      | "created"
      | "status-update"
      | "task-update"
      | "assignment-update"
      | "custom";
    payload: Record<string, any>;
  }
) {
  // Check if Slack thread exists
  const thread = await getSlackDocumentThread(
    client,
    data.documentType,
    data.documentId,
    data.companyId
  );

  if (thread.data) {
    // Invoke the edge function to trigger Slack sync
    return getCarbonServiceRole().functions.invoke("slack-document-sync", {
      body: {
        documentType: data.documentType,
        documentId: data.documentId,
        companyId: data.companyId,
        updateType: data.updateType,
        channelId: thread.data.channelId,
        threadTs: thread.data.threadTs,
        payload: data.payload,
      },
    });
  }

  return { data: null, error: null };
}

/**
 * Sync document creation to Slack (creates initial thread message)
 */
export async function syncDocumentCreatedToSlack(
  client: SupabaseClient<Database>,
  data: {
    documentType: DocumentType;
    documentId: string;
    companyId: string;
    channelId: string;
    threadTs: string;
    metadata?: Record<string, any>;
  }
) {
  return syncDocumentToSlack(client, {
    documentType: data.documentType,
    documentId: data.documentId,
    companyId: data.companyId,
    updateType: "created",
    payload: {
      channelId: data.channelId,
      threadTs: data.threadTs,
      metadata: data.metadata,
    },
  });
}

/**
 * Sync document status update to Slack
 */
export async function syncDocumentStatusToSlack(
  client: SupabaseClient<Database>,
  data: {
    documentType: DocumentType;
    documentId: string;
    companyId: string;
    previousStatus: string;
    newStatus: string;
    updatedBy: string;
    reason?: string;
    metadata?: Record<string, any>;
  }
) {
  return syncDocumentToSlack(client, {
    documentType: data.documentType,
    documentId: data.documentId,
    companyId: data.companyId,
    updateType: "status-update",
    payload: {
      previousStatus: data.previousStatus,
      newStatus: data.newStatus,
      updatedBy: data.updatedBy,
      reason: data.reason,
      metadata: data.metadata,
    },
  });
}

/**
 * Sync document assignment update to Slack
 */
export async function syncDocumentAssignmentToSlack(
  client: SupabaseClient<Database>,
  data: {
    documentType: DocumentType;
    documentId: string;
    companyId: string;
    previousAssignee?: string;
    newAssignee: string;
    updatedBy: string;
    metadata?: Record<string, any>;
  }
) {
  return syncDocumentToSlack(client, {
    documentType: data.documentType,
    documentId: data.documentId,
    companyId: data.companyId,
    updateType: "assignment-update",
    payload: {
      previousAssignee: data.previousAssignee,
      newAssignee: data.newAssignee,
      updatedBy: data.updatedBy,
      metadata: data.metadata,
    },
  });
}

/**
 * Sync custom document update to Slack
 */
export async function syncDocumentCustomToSlack(
  client: SupabaseClient<Database>,
  data: {
    documentType: DocumentType;
    documentId: string;
    companyId: string;
    customType: string;
    payload: Record<string, any>;
  }
) {
  return syncDocumentToSlack(client, {
    documentType: data.documentType,
    documentId: data.documentId,
    companyId: data.companyId,
    updateType: "custom",
    payload: {
      customType: data.customType,
      ...data.payload,
    },
  });
}

// Non-conformance specific wrapper functions for backward compatibility

/**
 * Get Slack thread for a non-conformance
 */
export async function getIssueSlackThread(
  client: SupabaseClient<Database>,
  nonConformanceId: string,
  companyId: string
) {
  return getSlackDocumentThread(
    client,
    "nonConformance",
    nonConformanceId,
    companyId
  );
}

/**
 * Create Slack thread mapping for a non-conformance
 */
export async function createIssueSlackThread(
  client: SupabaseClient<Database>,
  data: {
    nonConformanceId: string;
    companyId: string;
    channelId: string;
    threadTs: string;
    createdBy: string;
  }
) {
  return createSlackDocumentThread(client, {
    documentType: "nonConformance",
    documentId: data.nonConformanceId,
    companyId: data.companyId,
    channelId: data.channelId,
    threadTs: data.threadTs,
    createdBy: data.createdBy,
  });
}

/**
 * Sync non-conformance status update to Slack
 */
export async function syncIssueStatusToSlack(
  client: SupabaseClient<Database>,
  data: {
    nonConformanceId: string;
    companyId: string;
    previousStatus: string;
    newStatus: string;
    updatedBy: string;
    reason?: string;
  }
) {
  return syncDocumentStatusToSlack(client, {
    documentType: "nonConformance",
    documentId: data.nonConformanceId,
    companyId: data.companyId,
    previousStatus: data.previousStatus,
    newStatus: data.newStatus,
    updatedBy: data.updatedBy,
    reason: data.reason,
  });
}

/**
 * Sync task update to Slack
 */
export async function syncIssueTaskToSlack(
  client: SupabaseClient<Database>,
  data: {
    nonConformanceId: string;
    companyId: string;
    taskType: "investigation" | "action" | "approval";
    taskName: string;
    status: string;
    assignedTo?: string;
    completedBy?: string;
    completedAt?: string;
    notes?: string;
  }
) {
  return syncDocumentCustomToSlack(client, {
    documentType: "nonConformance",
    documentId: data.nonConformanceId,
    companyId: data.companyId,
    customType: "task-update",
    payload: {
      taskType: data.taskType,
      taskName: data.taskName,
      status: data.status,
      assignedTo: data.assignedTo,
      completedBy: data.completedBy,
      completedAt: data.completedAt,
      notes: data.notes,
    },
  });
}

/**
 * Sync assignment update to Slack
 */
export async function syncIssueAssignmentToSlack(
  client: SupabaseClient<Database>,
  data: {
    nonConformanceId: string;
    companyId: string;
    previousAssignee?: string;
    newAssignee: string;
    updatedBy: string;
  }
) {
  return syncDocumentAssignmentToSlack(client, {
    documentType: "nonConformance",
    documentId: data.nonConformanceId,
    companyId: data.companyId,
    previousAssignee: data.previousAssignee,
    newAssignee: data.newAssignee,
    updatedBy: data.updatedBy,
  });
}

/**
 * Create Slack thread for any document type - posts initial message and stores thread mapping
 */
export async function createDocumentSlackThread(
  client: SupabaseClient<Database>,
  data: {
    documentType: DocumentType;
    documentId: string;
    companyId: string;
    createdBy: string;
  }
) {
  try {
    // Get the Slack integration for this company
    const { data: integration } = await client
      .from("companyIntegration")
      .select("metadata")
      .eq("id", "slack")
      .eq("companyId", data.companyId)
      .single();

    if (!integration?.metadata) {
      // No Slack integration found, skip silently
      return { data: null, error: null };
    }

    const slackMetadata = integration.metadata as any;
    const slackToken = slackMetadata.access_token as string;
    const channelId = slackMetadata.incoming_webhook?.channel_id as string;

    if (!slackToken || !channelId) {
      // Missing required Slack configuration, skip silently
      return { data: null, error: null };
    }

    // Import Slack client functions dynamically
    const { createSlackWebClient } = await import("./client");
    const slackClient = createSlackWebClient({ token: slackToken });

    // Post initial message to channel (simple format for now)
    const threadMessage = await slackClient.chat.postMessage({
      channel: channelId,
      unfurl_links: false,
      unfurl_media: false,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📄 New ${data.documentType} created`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Document ID: ${data.documentId} • Company: ${data.companyId}`,
            },
          ],
        },
      ],
    });

    // Store the thread mapping in the database
    if (threadMessage.ts) {
      const { data: threadRecord } = await client
        .from("slackDocumentThread")
        .insert({
          documentType: data.documentType,
          documentId: data.documentId,
          companyId: data.companyId,
          channelId,
          threadTs: threadMessage.ts,
          createdBy: data.createdBy,
        })
        .select("*")
        .single();

      // Trigger background job to sync detailed information
      try {
        const { tasks } = await import("@trigger.dev/sdk/v3");
        await tasks.trigger("slack-document-created", {
          documentType: data.documentType,
          documentId: data.documentId,
          companyId: data.companyId,
          channelId,
          threadTs: threadMessage.ts,
        });
      } catch (error) {
        console.warn("Failed to trigger background job:", error);
        // Don't fail the operation if background job fails
      }

      return { data: threadRecord, error: null };
    }

    return { data: null, error: "Failed to post message to Slack" };
  } catch (error) {
    console.error("Error creating Slack thread:", error);
    // Don't throw error - we don't want to fail document creation if Slack fails
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Create Slack thread for a non-conformance (issue)
 */
export async function createIssueSlackThreadWithMessage(
  client: SupabaseClient<Database>,
  data: {
    nonConformanceId: string;
    companyId: string;
    createdBy: string;
  }
) {
  const result = await createDocumentSlackThread(client, {
    documentType: "nonConformance",
    documentId: data.nonConformanceId,
    companyId: data.companyId,
    createdBy: data.createdBy,
  });

  if (result.error) {
    return result;
  }

  await tasks.trigger("slack-document-created", {
    documentType: "nonConformance",
    documentId: data.nonConformanceId,
    companyId: data.companyId,
  });

  return result;
}
