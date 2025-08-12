import { getCarbonServiceRole } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type {
  slackDocumentAssignmentUpdate,
  slackDocumentCreated,
  slackDocumentStatusUpdate,
  slackDocumentTaskUpdate,
} from "@carbon/jobs/trigger/slack-document-sync";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tasks } from "@trigger.dev/sdk/v3";
import { createSlackWebClient } from "./client";

export type DocumentType = "nonConformance";

export interface SlackAuth {
  slackToken: string;
  slackUserId?: string;
  channelId: string;
}

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

export async function createIssueSlackThread(
  client: SupabaseClient<Database>,
  data: {
    carbonUrl: string;
    companyId: string;
    description?: string;
    id: string;
    nonConformanceId: string;
    severity: string;
    title: string;
    userId: string;
  },
  slackAuth?: SlackAuth
) {
  try {
    const auth =
      slackAuth ?? (await getSlackAuth(client, data.companyId, data.userId));
    if (!auth) {
      throw new Error("Slack auth not found");
    }

    const slackClient = createSlackWebClient({ token: auth?.slackToken });

    const threadMessage = await slackClient.chat.postMessage({
      channel: auth.channelId,
      unfurl_links: false,
      unfurl_media: false,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `Issue ${data.nonConformanceId}`,
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
              text: `*Status:*\nRegistered`,
            },
            {
              type: "mrkdwn",
              text: `*Severity:*\n${data.severity}`,
            },
          ],
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Created by <@${auth.slackUserId}>`,
            },
          ],
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "View in Carbon",
              },
              url: data.carbonUrl,
              action_id: "view_in_carbon",
            },
          ],
        },
      ],
    });

    if (threadMessage.ts) {
      const threadRecord = await client
        .from("slackDocumentThread")
        .insert({
          documentType: "nonConformance",
          documentId: data.id,
          companyId: data.companyId,
          channelId: auth.channelId,
          threadTs: threadMessage.ts,
          createdBy: data.userId,
        })
        .select("*")
        .single();

      if (threadRecord.error) {
        console.error("Error creating thread record:", threadRecord.error);
      }

      return threadRecord;
    }

    return {
      data: null,
      error: { message: "Failed to post message to Slack" },
    };
  } catch (error) {
    console.error("Error creating Issue Slack thread:", error);
    return {
      data: null,
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
      },
    };
  }
}

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

export async function getSlackAuth(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string
): Promise<SlackAuth | null> {
  const companyIntegration = await client
    .from("companyIntegration")
    .select("*")
    .eq("companyId", companyId)
    .eq("id", "slack")
    .maybeSingle();
  if (companyIntegration.error) {
    return null;
  }

  const metadata = companyIntegration.data?.metadata as {
    access_token: string;
    channel_id: string;
  };

  if (!metadata) {
    return null;
  }

  const user = await client
    .from("user")
    .select("email")
    .eq("id", userId)
    .single();

  if (user.error || !user.data?.email) {
    return {
      slackToken: metadata.access_token,
      channelId: metadata.channel_id,
    };
  }

  try {
    const slackClient = createSlackWebClient({ token: metadata.access_token });
    const slackUser = await slackClient.users.lookupByEmail({
      email: user.data.email,
    });

    if (slackUser.ok && slackUser.user?.id) {
      return {
        slackToken: metadata.access_token,
        slackUserId: slackUser.user.id,
        channelId: metadata.channel_id,
      };
    }
  } catch (error) {
    console.error("Failed to lookup Slack user by email:", error);
  }

  return {
    slackToken: metadata.access_token,
    channelId: metadata.channel_id,
  };
}

export async function getSlackUserIdForCarbonUser(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string
): Promise<string | null> {
  const auth = await getSlackAuth(client, companyId, userId);
  return auth?.slackUserId || null;
}

export async function getSlackDocumentThread(
  client: SupabaseClient<Database>,
  documentType: DocumentType,
  documentId: string,
  companyId: string
) {
  console.log({ documentType, documentId, companyId });
  return client
    .from("slackDocumentThread")
    .select("*")
    .eq("documentType", documentType)
    .eq("documentId", documentId)
    .eq("companyId", companyId)
    .single();
}

export async function getSlackIntegrationByTeamId(
  client: SupabaseClient<Database>,
  teamId: string
) {
  return await client
    .from("companyIntegration")
    .select("*")
    .eq("metadata->>team_id", teamId)
    .eq("id", "slack")
    .maybeSingle();
}

export async function getCarbonEmployeeFromSlackId(
  client: SupabaseClient<Database>,
  accessToken: string,
  slackUserId: string,
  carbonCompanyId: string
) {
  try {
    const slackClient = createSlackWebClient({ token: accessToken });

    // Get user info from Slack
    const userInfo = await slackClient.users.info({
      user: slackUserId,
    });

    console.log({ userInfo: userInfo.user?.profile });

    if (!userInfo.ok || !userInfo.user?.profile?.email) {
      return { data: null, error: "Could not retrieve user email from Slack" };
    }

    const email = userInfo.user.profile.email;

    const user = await client
      .from("user")
      .select("id")
      .eq("email", email)
      .single();
    if (user.error) {
      throw new Error("User not found");
    }
    return client
      .from("employeeJob")
      .select("*")
      .eq("id", user.data.id)
      .eq("companyId", carbonCompanyId)
      .single();
  } catch (error) {
    console.error("Error getting Carbon employee from Slack ID:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function syncDocumentToSlack(
  client: SupabaseClient<Database>,
  data: {
    documentType: DocumentType;
    documentId: string;
    companyId: string;
    userId: string;
    type:
      | "created"
      | "status-update"
      | "task-update"
      | "assignment-update"
      | "custom";
    payload: Record<string, any>;
  }
) {
  const serviceRole = getCarbonServiceRole();
  const [thread, slackUserId] = await Promise.all([
    getSlackDocumentThread(
      serviceRole,
      data.documentType,
      data.documentId,
      data.companyId
    ),
    getSlackUserIdForCarbonUser(serviceRole, data.companyId, data.userId),
  ]);

  if (thread.data) {
    try {
      // Check if Slack integration is enabled for this company
      const { data: integration } = await serviceRole
        .from("companyIntegration")
        .select("metadata")
        .eq("companyId", data.companyId)
        .eq("active", true)
        .single();

      if (!integration?.metadata) {
        console.log("Slack integration not active for company", data.companyId);
        return {
          data: { success: true, message: "Slack integration not active" },
          error: null,
        };
      }

      const metadata = integration.metadata as Record<string, unknown>;

      // Check if notifications are enabled for this document type
      const notificationKey = `${data.documentType}_notifications_enabled`;
      if (metadata[notificationKey] === false) {
        console.log(
          `${data.documentType} notifications disabled for company`,
          data.companyId
        );
        return {
          data: {
            success: true,
            message: `${data.documentType} notifications disabled`,
          },
          error: null,
        };
      }

      // Trigger the appropriate Trigger.dev job
      let result;
      switch (data.type) {
        case "created":
          result = await tasks.trigger<typeof slackDocumentCreated>(
            "slack-document-created",
            {
              documentType: data.documentType,
              documentId: data.documentId,
              companyId: data.companyId,
              channelId: thread.data.channelId,
              threadTs: thread.data.threadTs,
            }
          );
          break;

        case "status-update":
          result = await tasks.trigger<typeof slackDocumentStatusUpdate>(
            "slack-document-status-update",
            {
              documentType: data.documentType,
              documentId: data.documentId,
              companyId: data.companyId,
              previousStatus: data.payload.previousStatus,
              newStatus: data.payload.newStatus,
              updatedBy: slackUserId || data.payload.updatedBy,
            }
          );
          break;

        case "task-update":
          result = await tasks.trigger<typeof slackDocumentTaskUpdate>(
            "slack-document-task-update",
            {
              documentType: data.documentType,
              documentId: data.documentId,
              companyId: data.companyId,
              taskType: data.payload.taskType,
              taskName: data.payload.taskName,
              status: data.payload.status,
              assignedTo: data.payload.assignedTo,
              completedBy: data.payload.completedBy || slackUserId,
              completedAt: data.payload.completedAt,
              notes: data.payload.notes,
            }
          );
          break;

        case "assignment-update":
          result = await tasks.trigger<typeof slackDocumentAssignmentUpdate>(
            "slack-document-assignment-update",
            {
              documentType: data.documentType,
              documentId: data.documentId,
              companyId: data.companyId,
              previousAssignee: data.payload.previousAssignee,
              newAssignee: data.payload.newAssignee,
              updatedBy: slackUserId || data.payload.updatedBy,
            }
          );
          break;

        case "custom":
          // For now, just log custom updates
          console.log(`Custom update for ${data.documentType}:`, data.payload);
          return { data: { success: true }, error: null };

        default:
          throw new Error(`Invalid type ${data.type}`);
      }

      return { data: { success: true, taskId: result.id }, error: null };
    } catch (error) {
      console.error("slack-document-sync error:", error);
      return {
        data: null,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  return { data: null, error: null };
}

export async function syncDocumentCreatedToSlack(
  client: SupabaseClient<Database>,
  data: {
    documentType: DocumentType;
    documentId: string;
    companyId: string;
    userId: string;
    channelId: string;
    threadTs: string;
    metadata?: Record<string, any>;
  }
) {
  return syncDocumentToSlack(client, {
    documentType: data.documentType,
    documentId: data.documentId,
    companyId: data.companyId,
    userId: data.userId,
    type: "created",
    payload: {
      channelId: data.channelId,
      threadTs: data.threadTs,
      metadata: data.metadata,
    },
  });
}

export async function syncDocumentStatusToSlack(
  client: SupabaseClient<Database>,
  data: {
    documentType: DocumentType;
    documentId: string;
    companyId: string;
    userId: string;
    previousStatus: string;
    newStatus: string;
    reason?: string;
    metadata?: Record<string, any>;
  }
) {
  return syncDocumentToSlack(client, {
    documentType: data.documentType,
    documentId: data.documentId,
    companyId: data.companyId,
    userId: data.userId,
    type: "status-update",
    payload: {
      previousStatus: data.previousStatus,
      newStatus: data.newStatus,
      updatedBy: data.userId,
      reason: data.reason,
      metadata: data.metadata,
    },
  });
}

export async function syncDocumentAssignmentToSlack(
  client: SupabaseClient<Database>,
  data: {
    documentType: DocumentType;
    documentId: string;
    companyId: string;
    userId: string;
    previousAssignee?: string;
    newAssignee: string;
    metadata?: Record<string, any>;
  }
) {
  return syncDocumentToSlack(client, {
    documentType: data.documentType,
    documentId: data.documentId,
    companyId: data.companyId,
    userId: data.userId,
    type: "assignment-update",
    payload: {
      previousAssignee: data.previousAssignee,
      newAssignee: data.newAssignee,
      updatedBy: data.userId,
      metadata: data.metadata,
    },
  });
}

export async function syncDocumentCustomToSlack(
  client: SupabaseClient<Database>,
  data: {
    documentType: DocumentType;
    documentId: string;
    companyId: string;
    userId: string;
    customType: string;
    payload: Record<string, any>;
  }
) {
  return syncDocumentToSlack(client, {
    documentType: data.documentType,
    documentId: data.documentId,
    companyId: data.companyId,
    userId: data.userId,
    type: "custom",
    payload: {
      customType: data.customType,
      ...data.payload,
    },
  });
}

export async function syncIssueStatusToSlack(
  client: SupabaseClient<Database>,
  data: {
    nonConformanceId: string;
    companyId: string;
    userId: string;
    previousStatus: string;
    newStatus: string;
    reason?: string;
  }
) {
  return syncDocumentStatusToSlack(client, {
    documentType: "nonConformance",
    documentId: data.nonConformanceId,
    companyId: data.companyId,
    userId: data.userId,
    previousStatus: data.previousStatus,
    newStatus: data.newStatus,
    reason: data.reason,
  });
}

export async function syncIssueTaskToSlack(
  client: SupabaseClient<Database>,
  data: {
    nonConformanceId: string;
    companyId: string;
    userId: string;
    taskType: "investigation" | "action" | "approval";
    taskName: string;
    status: string;
    assignedTo?: string;
    completedAt?: string;
    notes?: string;
  }
) {
  return syncDocumentToSlack(client, {
    documentType: "nonConformance",
    documentId: data.nonConformanceId,
    companyId: data.companyId,
    userId: data.userId,
    type: "task-update",
    payload: {
      taskType: data.taskType,
      taskName: data.taskName,
      status: data.status,
      assignedTo: data.assignedTo,
      completedBy: data.status === "Completed" ? data.userId : undefined,
      completedAt: data.completedAt,
      notes: data.notes,
    },
  });
}

export async function syncIssueAssignmentToSlack(
  client: SupabaseClient<Database>,
  data: {
    nonConformanceId: string;
    companyId: string;
    userId: string;
    previousAssignee?: string;
    newAssignee: string;
  }
) {
  return syncDocumentAssignmentToSlack(client, {
    documentType: "nonConformance",
    documentId: data.nonConformanceId,
    companyId: data.companyId,
    userId: data.userId,
    previousAssignee: data.previousAssignee,
    newAssignee: data.newAssignee,
  });
}

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
