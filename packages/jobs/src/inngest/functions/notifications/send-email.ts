import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { Email as EmailConfig } from "@carbon/ee";
import { NonRetriableError, serializeError } from "inngest";
import { Resend } from "resend";
import { inngest } from "../../client";

type EmailAttachment =
  | { filename: string; content: string }
  | { filename: string; path: string };

export const sendEmailFunction = inngest.createFunction(
  {
    id: "send-email",
    retries: 3
  },
  { event: "carbon/send-email" },
  async ({ event, step }) => {
    const payload = event.data;
    const serviceRole = getCarbonServiceRole();

    // Resend rejects the request if `to` or `cc` contain null/undefined
    // entries, so strip falsy values regardless of what callers pass.
    const sanitizeRecipients = (
      value: string | string[] | undefined
    ): string | string[] | undefined => {
      if (Array.isArray(value)) {
        const filtered = value.filter(
          (entry): entry is string =>
            typeof entry === "string" && entry.length > 0
        );
        return filtered.length ? filtered : undefined;
      }
      return value && typeof value === "string" ? value : undefined;
    };

    const toRecipients = sanitizeRecipients(payload.to);
    const ccRecipients = sanitizeRecipients(payload.cc);

    if (!toRecipients) {
      throw new NonRetriableError(
        "send-email called without any valid `to` recipients"
      );
    }

    const { companyName, integrationMetadata, integrationActive } =
      await step.run("fetch-company-integration", async () => {
        const [companyResult, integrationResult] = await Promise.all([
          serviceRole
            .from("company")
            .select("name")
            .eq("id", payload.companyId)
            .single(),
          serviceRole
            .from("companyIntegration")
            .select("active, metadata")
            .eq("companyId", payload.companyId)
            .eq("id", "email")
            .maybeSingle()
        ]);

        return {
          companyName: companyResult.data?.name ?? null,
          integrationActive: integrationResult.data?.active ?? false,
          integrationMetadata: integrationResult.data?.metadata ?? null
        };
      });

    // Legacy installs predate the provider field — default them to Resend so
    // existing configs keep working without any migration step on the caller.
    const metadataWithProvider =
      integrationMetadata && typeof integrationMetadata === "object"
        ? {
            provider: "resend",
            ...(integrationMetadata as Record<string, unknown>)
          }
        : integrationMetadata;

    const parsedMetadata = EmailConfig.schema.safeParse(metadataWithProvider);

    if (!parsedMetadata.success || !integrationActive) {
      return { success: false, message: "Invalid or inactive integration" };
    }

    const data = parsedMetadata.data as {
      provider: "resend" | "smtp";
      fromEmail: string;
      apiKey?: string;
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      secure?: boolean;
    };

    const fromAddress = `${companyName} <${data.fromEmail}>`;
    const normalizedAttachments = payload.attachments?.map(
      (attachment: EmailAttachment) => {
        if ("path" in attachment) {
          return {
            filename: attachment.filename,
            path: attachment.path
          };
        }

        return {
          filename: attachment.filename,
          content: attachment.content,
          encoding: "base64" as const
        };
      }
    );

    if (data.provider === "smtp") {
      const result = await step.run("send-email", async () => {
        const nodemailer = await import("nodemailer");
        const transporter = nodemailer.createTransport({
          host: data.host!,
          port: data.port!,
          secure: data.secure === true,
          auth: {
            user: data.username!,
            pass: data.password!
          }
        });

        console.info(`SMTP Email Job`);
        return transporter.sendMail({
          from: fromAddress,
          to: toRecipients,
          cc: ccRecipients,
          replyTo: payload.from,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
          attachments: normalizedAttachments
        });
      });

      return { success: true, result };
    }

    const result = await step.run("send-email", async () => {
      const resend = new Resend(data.apiKey!);

      const email = {
        from: fromAddress,
        to: toRecipients,
        cc: ccRecipients,
        reply_to: payload.from,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        attachments: payload.attachments
      };

      console.info(`Resend Email Job`);
      const response = await resend.emails.send(email);
      if (response.error) {
        if (response.error.name === "validation_error") {
          throw new NonRetriableError(
            `Resend validation error: ${serializeError(response.error)}`
          );
        }
        throw new Error(`Resend error: ${serializeError(response.error)}`);
      }
      return response.data;
    });

    return { success: true, result };
  }
);
