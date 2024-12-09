import { getSlackClient } from "~/lib/slack.server";

import { validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { z } from "zod";

export const config = { runtime: "nodejs" };

export const emailValidator = z.object({
  email: z.string().email(),
});

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const validation = await validator(emailValidator).validate(formData);

  if (validation.error) {
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
        text: { type: "mrkdwn", text: `New lead: ${validation.data.email}` },
      },
    ],
  });

  return json({ success: true, message: "Email submitted" });
}
