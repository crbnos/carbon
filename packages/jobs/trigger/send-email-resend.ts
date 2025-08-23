import { getCarbonServiceRole } from "@carbon/auth";
import { Resend as ResendConfig } from "@carbon/ee";
import { task } from "@trigger.dev/sdk/v3";
import { Resend } from "resend";

const serviceRole = getCarbonServiceRole();

export const sendEmailResendTask = task({
  id: "send-email-resend",
  run: async (payload: {
    to: string | string[];
    cc?: string | string[];
    from?: string;
    subject: string;
    text: string;
    html: string;
    attachments?: Array<{ filename: string; content: any }>;
    companyId: string;
  }) => {
    const [company, integration] = await Promise.all([
      serviceRole
        .from("company")
        .select("name")
        .eq("id", payload.companyId)
        .single(),
      serviceRole
        .from("companyIntegration")
        .select("active, metadata")
        .eq("companyId", payload.companyId)
        .eq("id", "resend")
        .maybeSingle(),
    ]);

    const integrationMetadata = ResendConfig.schema.safeParse(
      integration?.data?.metadata
    );

    console.info(integrationMetadata.data?.fromEmail ?? "No email found");

    if (!integrationMetadata.success || integration?.data?.active !== true) {
      return { success: false, message: "🔴 Invalid or inactive integration" };
    }

    const resend = new Resend(integrationMetadata.data.apiKey);

    const email = {
      from: `${company.data?.name} <${
        integrationMetadata.data.fromEmail ?? "onboarding@resend.dev"
      }>`,
      to: payload.to,
      reply_to: payload.from,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      attachments: payload.attachments,
    };

    console.info(`📬 Resend Email Job`);
    const result = await resend.emails.send(email);

    return { success: true, result };
  },
});
