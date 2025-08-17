import { getCarbonServiceRole, VERCEL_URL } from "@carbon/auth";
import type { Database } from "@carbon/database";
import {
  createIssueSlackThread,
  createSlackWebClient,
  getCarbonEmployeeFromSlackId,
  getSlackIntegrationByTeamId,
} from "@carbon/integrations/slack.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FunctionRegion } from "@supabase/supabase-js";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { z } from "zod";
import {
  getIssueTypesList,
  getIssueWorkflowsList,
  upsertIssue,
} from "~/modules/quality/quality.service";

import { getNextSequence } from "~/modules/settings/settings.service";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs",
};

const slackInteractivePayloadSchema = z.object({
  type: z.string(),
  team: z
    .object({
      id: z.string(),
      domain: z.string(),
    })
    .optional(),
  user: z.object({
    id: z.string(),
    name: z.string().optional(),
    username: z.string().optional(),
  }),
  channel: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional(),
  trigger_id: z.string().optional(),
  response_url: z.string().optional(),
  actions: z.array(z.any()).optional(),
  view: z.any().optional(),
  api_app_id: z.string().optional(),
  token: z.string().optional(),
  container: z.any().optional(),
  enterprise: z.any().optional(),
  message: z.any().optional(),
  // Shortcut specific fields
  callback_id: z.string().optional(),
});

export async function action({ request }: ActionFunctionArgs) {
  try {
    const formData = await request.formData();
    const payloadString = formData.get("payload") as string;

    if (!payloadString) {
      return json({ error: "Missing payload" }, { status: 400 });
    }

    let payload = slackInteractivePayloadSchema.safeParse(
      JSON.parse(payloadString)
    );

    if (!payload.success) {
      console.error(
        "Slack payload validation error:",
        JSON.stringify(payload.error)
      );
      return json(
        {
          response_type: "ephemeral",
          text: "Invalid payload format received.",
        },
        { status: 400 }
      );
    }

    const serviceRole = await getCarbonServiceRole();

    if (!payload.data.team?.id) {
      return json({
        response_type: "ephemeral",
        text: "Invalid payload: missing team information.",
      });
    }

    const integration = await getSlackIntegrationByTeamId(
      serviceRole,
      payload.data.team.id
    );

    if (!integration.data || integration.error) {
      console.error("Failed to get Slack integration", integration.error);
      return json({
        response_type: "ephemeral",
        text: "Slack integration not found for this workspace.",
      });
    }

    const { companyId, metadata } = integration.data;
    const slackToken = (metadata as any)?.access_token as string;

    if (!slackToken) {
      console.error("Slack token not found");
      return json({
        response_type: "ephemeral",
        text: "Slack token not found. Please reconfigure the integration.",
      });
    }

    switch (payload.data.type) {
      case "shortcut":
        return handleShortcut(payload.data, companyId, slackToken, serviceRole);

      case "block_actions":
        return handleBlockActions(payload.data, companyId, slackToken);

      case "view_submission":
        return handleViewSubmission(
          payload.data,
          companyId,
          slackToken,
          serviceRole,
          integration.data
        );

      case "view_closed":
        return json({ ok: true });

      default:
        return json({
          response_type: "ephemeral",
          text: `Unknown interaction type: ${payload.data.type}`,
        });
    }
  } catch (error) {
    console.error("Slack interactive error:", error);
    return json(
      {
        response_type: "ephemeral",
        text: "An error occurred processing your interaction. Please try again.",
      },
      { status: 500 }
    );
  }
}

async function handleBlockActions(
  payload: z.infer<typeof slackInteractivePayloadSchema>,
  companyId: string,
  slackToken: string
) {
  const action = payload.actions?.[0];

  if (!action) {
    return json({ ok: true });
  }

  // Handle other block actions here as needed
  // Issue creation is now handled via shortcuts

  switch (action.action_id) {
    case "view_in_carbon":
      // This action just opens a URL, so we don't need to handle it
      return json({ ok: true });

    default:
      return json({ ok: true });
  }
}

async function handleShortcut(
  payload: z.infer<typeof slackInteractivePayloadSchema>,
  companyId: string,
  slackToken: string,
  serviceRole: SupabaseClient<Database>
) {
  // Handle different shortcut types based on callback_id
  const callbackId = payload.callback_id;
  console.log({ function: "handleShortcut", callbackId });
  switch (callbackId) {
    case "create_ncr_modal":
      return handleCreateNcrShortcut(
        payload,
        companyId,
        slackToken,
        serviceRole
      );

    default:
      return json({ ok: true });
  }
}

async function handleCreateNcrShortcut(
  payload: z.infer<typeof slackInteractivePayloadSchema>,
  companyId: string,
  slackToken: string,
  serviceRole: any
) {
  if (!payload.trigger_id) {
    return json({
      response_type: "ephemeral",
      text: "Missing trigger ID for modal interaction.",
    });
  }

  try {
    const [types, workflows] = await Promise.all([
      getIssueTypesList(serviceRole, companyId),
      getIssueWorkflowsList(serviceRole, companyId),
    ]);

    const slackClient = createSlackWebClient({ token: slackToken });

    await slackClient.views.open({
      trigger_id: payload.trigger_id,
      view: {
        type: "modal",
        callback_id: "create_ncr_modal",
        title: {
          type: "plain_text",
          text: "Create Issue",
        },
        submit: {
          type: "plain_text",
          text: "Create",
        },
        close: {
          type: "plain_text",
          text: "Cancel",
        },
        blocks: [
          {
            type: "input",
            block_id: "title_block",
            label: {
              type: "plain_text",
              text: "Title",
            },
            element: {
              type: "plain_text_input",
              action_id: "title",
              placeholder: {
                type: "plain_text",
                text: "Brief description of the non-conformance",
              },
            },
          },
          {
            type: "input",
            block_id: "description_block",
            label: {
              type: "plain_text",
              text: "Description",
            },
            element: {
              type: "plain_text_input",
              action_id: "description",
              multiline: true,
              placeholder: {
                type: "plain_text",
                text: "Detailed description of the issue",
              },
            },
            optional: true,
          },
          {
            type: "input",
            block_id: "type_block",
            label: {
              type: "plain_text",
              text: "Type",
            },
            element: {
              type: "static_select",
              action_id: "type",
              placeholder: {
                type: "plain_text",
                text: "Select issue type",
              },
              options:
                types.data?.map((type) => ({
                  text: {
                    type: "plain_text",
                    text: type.name,
                  },
                  value: type.id,
                })) || [],
            },
          },
          // Only include workflow block if workflows are available
          ...(workflows.data && workflows.data.length > 0
            ? [
                {
                  type: "input" as const,
                  block_id: "workflow_block",
                  label: {
                    type: "plain_text" as const,
                    text: "Workflow",
                  },
                  element: {
                    type: "static_select" as const,
                    action_id: "workflow",
                    placeholder: {
                      type: "plain_text" as const,
                      text: "Select workflow",
                    },
                    options: workflows.data.map((workflow) => ({
                      text: {
                        type: "plain_text" as const,
                        text: workflow.name,
                      },
                      value: workflow.id,
                    })),
                  },
                  optional: true,
                },
              ]
            : []),
          {
            type: "input",
            block_id: "severity_block",
            label: {
              type: "plain_text",
              text: "Severity",
            },
            element: {
              type: "static_select",
              action_id: "severity",
              placeholder: {
                type: "plain_text",
                text: "Select severity",
              },
              options: [
                { text: { type: "plain_text", text: "Low" }, value: "Low" },
                {
                  text: { type: "plain_text", text: "Medium" },
                  value: "Medium",
                },
                { text: { type: "plain_text", text: "High" }, value: "High" },
                {
                  text: { type: "plain_text", text: "Critical" },
                  value: "Critical",
                },
              ],
            },
            optional: true,
          },
        ],
        private_metadata: JSON.stringify({
          channel_id: payload.channel?.id || "",
          user_id: payload.user.id,
        }),
      },
    });

    return json({ ok: true });
  } catch (error) {
    console.error("Error opening Issue modal:", error);
    return json({
      response_type: "ephemeral",
      text: "Failed to open Issue form. Please try again.",
    });
  }
}

async function handleViewSubmission(
  payload: z.infer<typeof slackInteractivePayloadSchema>,
  companyId: string,
  slackToken: string,
  serviceRole: SupabaseClient<Database>,
  integration: any
) {
  console.log({ function: "handleViewSubmission", payload });
  const view = payload.view;

  if (view.callback_id !== "create_ncr_modal") {
    return json({ ok: true });
  }

  try {
    const values = view.state.values;
    const title = values.title_block.title.value;
    const description = values.description_block?.description?.value || "";
    const typeId = values.type_block.type.selected_option?.value;
    const workflowId = values.workflow_block?.workflow?.selected_option?.value;
    const severity =
      values.severity_block?.severity?.selected_option?.value || "Medium";

    const modalMetadata = JSON.parse(view.private_metadata);
    const { user_id } = modalMetadata;

    // Use the configured channel from integration metadata, not the trigger channel
    const integrationMetadata = integration.metadata as any;
    const configuredChannelId = integrationMetadata?.channel_id;

    if (!configuredChannelId) {
      throw new Error("No channel configured for Slack integration");
    }

    const [nextSequence, employee] = await Promise.all([
      getNextSequence(serviceRole, "nonConformance", companyId),
      getCarbonEmployeeFromSlackId(serviceRole, slackToken, user_id, companyId),
    ]);

    if (nextSequence.error || !nextSequence.data) {
      throw new Error("Failed to get next sequence number");
    }

    if (employee.error || !employee.data) {
      console.error(employee.error);
      throw new Error("Failed to get employee");
    }

    const createResult = await upsertIssue(serviceRole, {
      nonConformanceId: nextSequence.data,
      approvalRequirements: [],
      companyId,
      createdBy: employee.data?.id,
      description,
      investigationTypeIds: [],
      locationId: employee.data?.locationId || "",
      name: title,
      nonConformanceTypeId: typeId,
      nonConformanceWorkflowId: workflowId,
      openDate: new Date().toISOString(),
      priority: severity,
      requiredActionIds: [],
      source: "Internal",
    });

    if (createResult.error || !createResult.data) {
      console.error(createResult.error);
      throw new Error("Failed to create issue");
    }

    const ncrId = createResult.data.id;

    const [threadResult, tasksResult] = await Promise.all([
      createIssueSlackThread(
        serviceRole,
        {
          carbonUrl: `${VERCEL_URL || "http://localhost:3000"}${path.to.issue(
            ncrId
          )}`,
          companyId,
          description,
          id: ncrId,
          nonConformanceId: nextSequence.data,
          severity,
          title,
          userId: employee.data?.id,
        },
        {
          slackToken,
          slackUserId: user_id,
          channelId: configuredChannelId,
        }
      ),
      serviceRole.functions.invoke("create", {
        body: {
          type: "nonConformanceTasks",
          id: ncrId,
          companyId,
          userId: employee.data?.id ?? "system",
        },
        region: FunctionRegion.UsEast1,
      }),
    ]);

    if (tasksResult.error) {
      console.error("Error creating tasks:", tasksResult.error);
    }

    if (threadResult.error) {
      console.error("Error creating thread:", threadResult.error);
    }

    return json({
      response_action: "clear",
    });
  } catch (error) {
    console.error("Error creating Issue:", error);

    return json({
      response_action: "errors",
      errors: {
        title_block: "Failed to create Issue. Please try again.",
      },
    });
  }
}
