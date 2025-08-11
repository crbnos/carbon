import { getCarbonServiceRole } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
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
  const thread = await getSlackDocumentThread(
    serviceRole,
    data.documentType,
    data.documentId,
    data.companyId
  );

  if (thread.data) {
    return serviceRole.functions.invoke("slack-document-sync", {
      body: {
        documentType: data.documentType,
        documentId: data.documentId,
        companyId: data.companyId,
        type: data.type,
        channelId: thread.data.channelId,
        threadTs: thread.data.threadTs,
        payload: data.payload,
      },
    });
  }

  return { data: null, error: null };
}

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
    type: "status-update",
    payload: {
      previousStatus: data.previousStatus,
      newStatus: data.newStatus,
      updatedBy: data.updatedBy,
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
    type: "assignment-update",
    payload: {
      previousAssignee: data.previousAssignee,
      newAssignee: data.newAssignee,
      updatedBy: data.updatedBy,
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
    customType: string;
    payload: Record<string, any>;
  }
) {
  return syncDocumentToSlack(client, {
    documentType: data.documentType,
    documentId: data.documentId,
    companyId: data.companyId,
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
  });
}

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
