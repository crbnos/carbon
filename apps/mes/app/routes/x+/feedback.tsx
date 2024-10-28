import { getCarbonServiceRole, SUPABASE_API_URL } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { getSlackClient } from "~/lib/slack.server";
import { feedbackValidator } from "~/models/feedback";

export const config = {
  runtime: "nodejs",
};

export async function action({ request }: ActionFunctionArgs) {
  const { userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(feedbackValidator).validate(formData);

  if (validation.error) {
    return json({
      success: false,
      message: "Failed to submit feedback",
    });
  }

  const { attachmentPath, feedback, location } = validation.data;
  const serviceRole = await getCarbonServiceRole();
  const slackClient = getSlackClient();

  const [user, insertFeedback] = await Promise.all([
    serviceRole
      .from("user")
      .select("firstName,lastName,email")
      .eq("id", userId)
      .single(),
    serviceRole.from("feedback").insert([
      {
        feedback,
        location,
        attachmentPath: attachmentPath ? `feedback/${attachmentPath}` : null,
        userId,
      },
    ]),
  ]);

  if (insertFeedback.error) {
    return json({
      success: false,
      message: "Failed to submit feedback",
    });
  }

  await slackClient.sendMessage({
    channel: "#feedback",
    text: `New feedback submitted`,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `New feedback submitted` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Location:*\n${location}` },
          { type: "mrkdwn", text: `*Feedback:*\n${feedback}` },
          {
            type: "mrkdwn",
            text: `*User:*\n${user.data?.firstName ?? ""} ${
              user.data?.lastName ?? ""
            } <${user.data?.email ?? ""}>`,
          },
          {
            type: "mrkdwn",
            text: `*Attachment:*\n${
              attachmentPath
                ? `${SUPABASE_API_URL}/storage/v1/object/public/feedback/${attachmentPath}`
                : "None"
            }`,
          },
        ],
      },
    ],
  });

  return json({ success: true, message: "Feedback submitted" });
}
