import { getCarbonServiceRole } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type {
  slackDocumentAssignmentUpdate,
  slackDocumentCreated,
  slackDocumentStatusUpdate,
  slackDocumentTaskUpdate,
} from "@carbon/jobs/trigger/slack-document-sync";
import { redis } from "@carbon/kv";
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

    const blocks = [
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
    ];

    console.log({ blocks, data });

    const threadMessage = await slackClient.chat.postMessage({
      channel: auth.channelId,
      unfurl_links: false,
      unfurl_media: false,
      blocks,
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

  const slackUserId = await getSlackUserIdByCarbonId(
    client,
    metadata.access_token,
    userId
  );

  return {
    slackToken: metadata.access_token,
    channelId: metadata.channel_id,
    slackUserId: slackUserId || undefined,
  };
}

export async function getSlackUserIdByCarbonId(
  client: SupabaseClient<Database>,
  accessToken: string,
  userId: string
) {
  const cachedUserId = await redis.get(`slack-user:${userId}`);
  if (cachedUserId && typeof cachedUserId === "string") {
    return cachedUserId;
  }

  const user = await client
    .from("user")
    .select("email")
    .eq("id", userId)
    .single();

  if (user.error || !user.data?.email) {
    return null;
  }

  try {
    const slackClient = createSlackWebClient({ token: accessToken });
    const slackUser = await slackClient.users.lookupByEmail({
      email: user.data.email,
    });

    if (slackUser.ok && slackUser.user?.id) {
      await redis.set(`slack-user:${userId}`, slackUser.user.id);
      return slackUser.user.id;
    }
  } catch (error) {
    console.error("Failed to lookup Slack user by email:", error);
  }
}

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

export async function getSlackIntegrationByTeamId(
  client: SupabaseClient<Database>,
  teamId: string
) {
  return await client
    .from("companyIntegration")
    .select("*")
    .eq("metadata->>team_id", teamId)
    .eq("id", "slack");
}

export async function getCarbonEmployeeFromSlackId(
  client: SupabaseClient<Database>,
  accessToken: string,
  slackUserId: string,
  carbonCompanyId: string
) {
  try {
    const slackClient = createSlackWebClient({ token: accessToken });

    const userInfo = await slackClient.users.info({
      user: slackUserId,
    });

    if (!userInfo.ok || !userInfo.user?.profile?.email) {
      return { data: null, error: "Could not retrieve user email from Slack" };
    }

    const email = userInfo.user.profile.email;

    const user = await client
      .from("user")
      .select("id")
      .eq("email", email)
      .single();

    if (user.error || !user.data?.id) {
      const location = await client
        .from("location")
        .select("id")
        .eq("companyId", carbonCompanyId);
      return {
        data: {
          id: "system",
          locationId: location.data?.[0]?.id,
        },
        error: null,
      };
    }
    const job = await client
      .from("employeeJob")
      .select("*")
      .eq("id", user.data.id)
      .eq("companyId", carbonCompanyId)
      .maybeSingle();

    if (job.error || !job.data?.id) {
      const location = await client
        .from("location")
        .select("id")
        .eq("companyId", carbonCompanyId);
      return {
        data: {
          id: user.data.id,
          locationId: location.data?.[0]?.id,
        },
        error: null,
      };
    }

    return job;
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
  const [thread, slackAuth] = await Promise.all([
    getSlackDocumentThread(
      serviceRole,
      data.documentType,
      data.documentId,
      data.companyId
    ),
    getSlackAuth(serviceRole, data.companyId, data.userId),
  ]);

  if (!slackAuth) {
    console.error("Slack auth not found for company", data.companyId);
    return {
      data: null,
      error: "Slack auth not found",
    };
  }

  if (thread.data) {
    try {
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
              updatedBy: slackAuth.slackUserId || data.payload.updatedBy,
            }
          );
          break;

        case "task-update":
          let taskName = "";
          let assignee: string | null | undefined = null;
          const taskId = data.payload.taskId || data.documentId; // fallback for backward compatibility
          if (data.payload.taskType === "investigation") {
            const task = await client
              .from("nonConformanceInvestigationTask")
              .select(
                "assignee, status, ...nonConformanceInvestigationType(name)"
              )
              .eq("id", taskId)
              .single();
            taskName = task.data?.name || "";
            assignee = task.data?.assignee
              ? await getSlackUserIdByCarbonId(
                  client,
                  slackAuth.slackToken,
                  task.data?.assignee || ""
                )
              : null;
          } else if (data.payload.taskType === "action") {
            const task = await client
              .from("nonConformanceActionTask")
              .select("assignee,status, ...nonConformanceRequiredAction(name)")
              .eq("id", taskId)
              .single();

            taskName = task.data?.name || "";
            assignee = task.data?.assignee
              ? await getSlackUserIdByCarbonId(
                  client,
                  slackAuth.slackToken,
                  task.data?.assignee || ""
                )
              : null;
          } else if (data.payload.taskType === "approval") {
            const task = await client
              .from("nonConformanceApprovalTask")
              .select("assignee, status, approvalType")
              .eq("id", taskId)
              .single();

            taskName = task.data?.approvalType || "";
            assignee = task.data?.assignee
              ? await getSlackUserIdByCarbonId(
                  client,
                  slackAuth.slackToken,
                  task.data?.assignee || ""
                )
              : "";
          }
          result = await tasks.trigger<typeof slackDocumentTaskUpdate>(
            "slack-document-task-update",
            {
              assignee,
              documentType: data.documentType,
              documentId: data.documentId,
              companyId: data.companyId,
              taskName,
              taskType: data.payload.taskType,
              status: data.payload.status,
              completedAt: data.payload.completedAt,
            }
          );
          break;

        case "assignment-update":
          let previousAssignee: string | undefined;
          let newAssignee: string | undefined;
          if (data.payload.previousAssignee) {
            previousAssignee = await getSlackUserIdByCarbonId(
              client,
              slackAuth.slackToken,
              data.payload.previousAssignee || ""
            );
          }
          if (data.payload.newAssignee) {
            newAssignee = await getSlackUserIdByCarbonId(
              client,
              slackAuth.slackToken,
              data.payload.newAssignee || ""
            );
          }
          result = await tasks.trigger<typeof slackDocumentAssignmentUpdate>(
            "slack-document-assignment-update",
            {
              documentType: data.documentType,
              documentId: data.documentId,
              companyId: data.companyId,
              previousAssignee,
              newAssignee,
              updatedBy: slackAuth.slackUserId || data.payload.updatedBy,
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
    channelId: string;
    companyId: string;
    documentId: string;
    documentType: DocumentType;
    metadata?: Record<string, any>;
    threadTs: string;
    userId: string;
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
    companyId: string;
    customType: string;
    documentId: string;
    documentType: DocumentType;
    payload: Record<string, any>;
    userId: string;
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
    companyId: string;
    newStatus: string;
    nonConformanceId: string;
    previousStatus: string;
    reason?: string;
    userId: string;
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
    companyId: string;
    completedAt?: string;
    id: string;
    status: string;
    taskType: "investigation" | "action" | "review";
    userId: string;
  }
) {
  let nonConformanceId = "";
  if (data.taskType === "investigation") {
    const nonConformance = await client
      .from("nonConformanceInvestigationTask")
      .select("nonConformanceId")
      .eq("id", data.id)
      .single();
    nonConformanceId = nonConformance.data?.nonConformanceId || "";
  }
  if (data.taskType === "action") {
    const nonConformance = await client
      .from("nonConformanceActionTask")
      .select("nonConformanceId")
      .eq("id", data.id)
      .single();
    nonConformanceId = nonConformance.data?.nonConformanceId || "";
  }
  if (data.taskType === "review") {
    const nonConformance = await client
      .from("nonConformanceApprovalTask")
      .select("nonConformanceId")
      .eq("id", data.id)
      .single();
    nonConformanceId = nonConformance.data?.nonConformanceId || "";
  }

  return syncDocumentToSlack(client, {
    documentType: "nonConformance",
    documentId: nonConformanceId,
    companyId: data.companyId,
    userId: data.userId,
    type: "task-update",
    payload: {
      taskId: data.id,
      taskType: data.taskType,
      status: data.status,
      completedAt: data.completedAt,
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
