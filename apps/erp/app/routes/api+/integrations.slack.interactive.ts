import { getCarbonServiceRole, VERCEL_URL } from "@carbon/auth";
import { createSlackWebClient } from "@carbon/integrations/slack.server";
import { tasks } from "@trigger.dev/sdk/v3";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { z } from "zod";
import {
  getIssueTypesList,
  getIssueWorkflowsList,
  upsertIssue,
} from "~/modules/quality/quality.service";
import {
  getIntegration,
  getNextSequence,
} from "~/modules/settings/settings.service";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs",
};

// Slack interactive payload schema
const slackInteractivePayloadSchema = z.object({
  type: z.string(),
  team: z.object({
    id: z.string(),
    domain: z.string(),
  }),
  user: z.object({
    id: z.string(),
    name: z.string(),
  }),
  channel: z.object({
    id: z.string(),
    name: z.string(),
  }),
  trigger_id: z.string().optional(),
  response_url: z.string().optional(),
  actions: z.array(z.any()).optional(),
  view: z.any().optional(),
});

export async function action({ request }: ActionFunctionArgs) {
  try {
    // Verify the request is from Slack
    const formData = await request.formData();
    const payloadString = formData.get("payload") as string;

    if (!payloadString) {
      return json({ error: "Missing payload" }, { status: 400 });
    }

    const payload = slackInteractivePayloadSchema.parse(
      JSON.parse(payloadString)
    );

    // Get the service role client
    const serviceRole = await getCarbonServiceRole();

    // Get the Slack integration for this team
    const integration = await getIntegration(
      serviceRole,
      "slack",
      payload.team.id
    );

    if (!integration.data) {
      return json({
        response_type: "ephemeral",
        text: "Slack integration not found for this workspace.",
      });
    }

    const { companyId, metadata } = integration.data;
    const slackToken = (metadata as any)?.access_token as string;

    if (!slackToken) {
      return json({
        response_type: "ephemeral",
        text: "Slack token not found. Please reconfigure the integration.",
      });
    }

    // Handle different interaction types
    switch (payload.type) {
      case "block_actions":
        return handleBlockActions(payload, companyId, slackToken);

      case "view_submission":
        return handleViewSubmission(
          payload,
          companyId,
          slackToken,
          serviceRole
        );

      case "view_closed":
        // User closed the modal without submitting
        return json({ ok: true });

      default:
        return json({
          response_type: "ephemeral",
          text: `Unknown interaction type: ${payload.type}`,
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
  payload: any,
  companyId: string,
  slackToken: string
) {
  const action = payload.actions?.[0];

  if (!action) {
    return json({ ok: true });
  }

  const slackClient = createSlackWebClient({ token: slackToken });

  switch (action.action_id) {
    case "open_ncr_modal":
      // Get lists for the modal
      const serviceRole = await getCarbonServiceRole();
      const [types, workflows] = await Promise.all([
        getIssueTypesList(serviceRole, companyId),
        getIssueWorkflowsList(serviceRole, companyId),
      ]);

      // Open the NCR creation modal
      await slackClient.views.open({
        trigger_id: payload.trigger_id,
        view: {
          type: "modal",
          callback_id: "create_ncr_modal",
          title: {
            type: "plain_text",
            text: "Create NCR",
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
            {
              type: "input",
              block_id: "workflow_block",
              label: {
                type: "plain_text",
                text: "Workflow",
              },
              element: {
                type: "static_select",
                action_id: "workflow",
                placeholder: {
                  type: "plain_text",
                  text: "Select workflow",
                },
                options:
                  workflows.data?.map((workflow) => ({
                    text: {
                      type: "plain_text",
                      text: workflow.name,
                    },
                    value: workflow.id,
                  })) || [],
              },
              optional: true,
            },
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
            channel_id: payload.channel.id,
            user_id: payload.user.id,
          }),
        },
      });

      return json({ ok: true });

    default:
      return json({ ok: true });
  }
}

async function handleViewSubmission(
  payload: any,
  companyId: string,
  slackToken: string,
  serviceRole: any
) {
  const view = payload.view;

  if (view.callback_id !== "create_ncr_modal") {
    return json({ ok: true });
  }

  try {
    // Extract form values
    const values = view.state.values;
    const title = values.title_block.title.value;
    const description = values.description_block?.description?.value || "";
    const typeId = values.type_block.type.selected_option?.value;
    const workflowId = values.workflow_block?.workflow?.selected_option?.value;
    const severity =
      values.severity_block?.severity?.selected_option?.value || "Medium";

    // Parse metadata
    const metadata = JSON.parse(view.private_metadata);
    const { channel_id, user_id } = metadata;

    // Get next sequence number
    const nextSequence = await getNextSequence(
      serviceRole,
      "nonConformance",
      companyId
    );

    if (nextSequence.error || !nextSequence.data) {
      throw new Error("Failed to get next sequence number");
    }

    // Create the non-conformance
    const createResult = await upsertIssue(serviceRole, {
      nonConformanceId: nextSequence.data,
      approvalRequirements: [],
      companyId,
      createdBy: "system", // TODO: Map Slack user to system user
      description,
      investigationTypeIds: [],
      locationId: "", // TODO
      name: title,
      nonConformanceTypeId: typeId,
      nonConformanceWorkflowId: workflowId,
      openDate: new Date().toISOString(),
      priority: severity,
      requiredActionIds: [],
      source: "Internal",
    });

    if (createResult.error || !createResult.data) {
      throw new Error("Failed to create non-conformance");
    }

    const ncrId = createResult.data.id;
    const slackClient = createSlackWebClient({ token: slackToken });

    // Post initial message to channel
    const threadMessage = await slackClient.chat.postMessage({
      channel: channel_id,
      unfurl_links: false,
      unfurl_media: false,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `Issue #${nextSequence.data}`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${title}*\n${description || "_No description provided_"}`,
          },
          fields: [
            {
              type: "mrkdwn",
              text: `*Status:*\nRegistered`,
            },
            {
              type: "mrkdwn",
              text: `*Severity:*\n${severity}`,
            },
          ],
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Created by <@${user_id}>`,
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
              url: `${VERCEL_URL || "http://localhost:3000"}${path.to.issue(
                ncrId
              )}`,
              action_id: "view_in_carbon",
            },
          ],
        },
      ],
    });

    // Store the thread mapping in the database
    if (threadMessage.ts) {
      await serviceRole.from("slackDocumentThread").insert({
        documentType: "nonConformance",
        documentId: ncrId,
        companyId,
        channelId: channel_id,
        threadTs: threadMessage.ts,
        createdBy: user_id,
      });

      // Trigger async job to sync additional details
      await tasks.trigger("slack-document-created", {
        documentType: "nonConformance",
        documentId: ncrId,
        companyId,
        channelId: channel_id,
        threadTs: threadMessage.ts,
      });
    }

    // Close the modal with success
    return json({
      response_action: "clear",
    });
  } catch (error) {
    console.error("Error creating NCR:", error);

    // Show error in modal
    return json({
      response_action: "errors",
      errors: {
        title_block: "Failed to create NCR. Please try again.",
      },
    });
  }
}
