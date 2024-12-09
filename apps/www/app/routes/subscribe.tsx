import { getSlackClient } from "~/lib/slack.server";

import { json, type ActionFunctionArgs } from "@vercel/remix";
import { z } from "zod";

export const emailValidator = z.object({
  email: z.string().email(),
});

export const config = {
  runtime: "nodejs",
};

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = String(formData.get("email"));

  if (!email) {
    return json(
      { success: false, message: "Email is required" },
      { status: 400 }
    );
  }

  const slackClient = getSlackClient();
  await slackClient.sendMessage({
    channel: "#leads",
    text: "New lead from website",
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `New lead: ${email}` },
      },
    ],
  });

  return json({ success: true, message: "Email submitted" });
}
