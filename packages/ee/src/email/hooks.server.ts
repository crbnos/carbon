import { getLogger } from "@carbon/logger";
import { Email } from "./config";

const logger = getLogger("ee", "email");

/**
 * Server-side healthcheck for the Email integration.
 *
 * Validates the stored credentials for the company's chosen delivery
 * provider without actually sending a message:
 *
 * - `resend`: hits `GET https://api.resend.com/domains` with the API key.
 *   A 2xx means the key is valid and has read access; anything else means
 *   the credentials are wrong or the account is suspended.
 * - `smtp`:   dynamically imports `nodemailer`, builds a transport from the
 *   stored host/port/username/password/secure and calls `.verify()`, which
 *   performs a handshake without sending mail.
 *
 * Returns `true` on success and `false` on any failure (invalid metadata,
 * network error, bad credentials). Never throws — the settings page caches
 * a boolean and we don't want a transient SMTP outage to surface as a 500
 * in the integrations list.
 */
export async function emailHealthcheck(
  _companyId: string,
  metadata: Record<string, unknown>
): Promise<boolean> {
  // Legacy installs predate the `provider` field — default them to Resend
  // the same way `send-email.ts` does so existing configs stay healthy.
  const withProvider =
    metadata && typeof metadata === "object" && !("provider" in metadata)
      ? { provider: "resend", ...metadata }
      : metadata;

  const parsed = Email.schema.safeParse(withProvider);
  if (!parsed.success) return false;

  const data = parsed.data;

  try {
    if (data.provider === "resend") {
      const response = await fetch("https://api.resend.com/domains", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${data.apiKey}`
        }
      });
      return response.ok;
    }

    if (data.provider === "smtp") {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host: data.host,
        port: data.port,
        secure: data.secure,
        auth: {
          user: data.username,
          pass: data.password
        }
      });
      await transporter.verify();
      return true;
    }

    return false;
  } catch (error) {
    logger.error("Email integration healthcheck failed", { error });
    return false;
  }
}
