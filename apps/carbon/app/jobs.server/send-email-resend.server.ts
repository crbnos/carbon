import { eventTrigger } from "@trigger.dev/sdk";
import { nanoid } from "nanoid";
import { Resend } from "resend";
import { z } from "zod";

import { getSupabaseServiceRole } from "~/lib/supabase";
import { triggerClient } from "~/lib/trigger.server";
import { resendFormValidator } from "~/modules/settings";

const supabaseClient = getSupabaseServiceRole();

const job = triggerClient.defineJob({
  id: "send-email-resend",
  name: "Send Email with Resend",
  version: "0.0.1",
  trigger: eventTrigger({
    name: "resend.email",
    schema: z.object({
      to: z.union([z.string(), z.array(z.string())]),
      cc: z.union([z.string(), z.array(z.string())]).optional(),
      from: z.string().optional(),
      subject: z.string(),
      text: z.string(),
      html: z.string(),
      attachments: z
        .object({
          filename: z.string(),
          content: z.any(),
        })
        .array()
        .optional(),
      companyId: z.string(),
    }),
  }),
  run: async (payload, io, ctx) => {
    const integration = await supabaseClient
      .from("companyIntegration")
      .select("active, metadata")
      .eq("companyId", payload.companyId)
      .eq("id", "resend")
      .maybeSingle();

    // TODO: integration should include from email
    const integrationMetadata = resendFormValidator.safeParse(
      integration?.data?.metadata
    );

    if (!integrationMetadata.success || integration?.data?.active !== true)
      return;

    const resend = new Resend(integrationMetadata.data.apiKey);

    const email = {
      from: "onboarding@resend.dev",
      to: payload.to,
      reply_to: payload.from,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      attachments: payload.attachments,
      headers: {
        "X-Entity-Ref-ID": nanoid(7),
      },
    };

    await io.logger.info(`📬 Resend Email Job`);
    await resend.emails.send(email);
  },
});

export default job;
