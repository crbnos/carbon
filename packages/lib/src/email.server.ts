import {
  SMTP_FROM,
  SMTP_HOST,
  SMTP_PASSWORD,
  SMTP_PORT,
  SMTP_USER
} from "@carbon/env";
import { getLogger } from "@carbon/logger";
import type { Transporter } from "nodemailer";
import nodemailer from "nodemailer";

const log = getLogger("lib", "email");

export type SendEmailPayload = {
  /** Defaults to DEFAULT_FROM (SMTP_FROM). */
  from?: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: Array<
    { filename: string; content: string } | { filename: string; path: string }
  >;
};

export type SendEmailResult = {
  data: { id: string } | null;
  error: Error | null;
};

export const DEFAULT_FROM =
  SMTP_FROM ?? `Carbon <no-reply@${process.env.RESEND_DOMAIN ?? "carbon.ms"}>`;

/** Domain of the default from-address, e.g. "carbon.ms". */
export const EMAIL_DOMAIN =
  DEFAULT_FROM.match(/@([^>\s]+)/)?.[1] ?? "carbon.ms";

/**
 * Built on first send, not at import.
 *
 * The old Resend client was `new Resend(process.env.RESEND_API_KEY!)` at
 * module scope, and its constructor throws when the key is missing. Every
 * route bundle that imported `sendEmail` therefore evaluated it at boot, so
 * a deployment with no mail config did not lose email — it lost the whole
 * server, crash-looping before it served a request. Same rule applies to
 * the SMTP transport: an unconfigured install has opted out of email, and
 * inviting a user should not fail with a stack trace about mail servers.
 */
let transporter: Transporter | null | undefined;

const getTransporter = (): Transporter | null => {
  if (transporter !== undefined) return transporter;

  if (SMTP_HOST) {
    const auth =
      SMTP_USER && SMTP_PASSWORD
        ? { user: SMTP_USER, pass: SMTP_PASSWORD }
        : undefined;
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      // Never send credentials in plaintext if the relay skips STARTTLS.
      requireTLS: SMTP_PORT !== 465 && Boolean(auth),
      auth
    });
  } else if (process.env.RESEND_API_KEY) {
    // Legacy fallback so existing deployments keep sending with zero config
    // change: Resend's SMTP interface accepts the API key as the password.
    log.info(
      "SMTP_* not set — falling back to RESEND_API_KEY via smtp.resend.com; migrate to SMTP_* vars"
    );
    transporter = nodemailer.createTransport({
      host: "smtp.resend.com",
      port: 465,
      secure: true,
      auth: { user: "resend", pass: process.env.RESEND_API_KEY }
    });
  } else {
    log.info("SMTP not configured — email disabled");
    transporter = null;
  }

  return transporter;
};

export const sendEmail = async (
  payload: SendEmailPayload
): Promise<SendEmailResult> => {
  const transport = getTransporter();

  if (!transport) {
    // Log only non-sensitive metadata — the full payload carries recipient PII
    // and the rendered HTML body (which can include verification codes).
    log.debug("Email send skipped (SMTP not configured)", {
      to: payload.to,
      subject: payload.subject
    });
    return { data: null, error: null };
  }

  try {
    const info = await transport.sendMail({
      from: payload.from ?? DEFAULT_FROM,
      to: payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      replyTo: payload.replyTo,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      headers: payload.headers,
      attachments: payload.attachments?.map((attachment) =>
        "content" in attachment
          ? { ...attachment, encoding: "base64" as const }
          : attachment
      )
    });
    return { data: { id: info.messageId }, error: null };
  } catch (err) {
    log.error("Email send failed", {
      to: payload.to,
      subject: payload.subject,
      error: err
    });
    return { data: null, error: err as Error };
  }
};
