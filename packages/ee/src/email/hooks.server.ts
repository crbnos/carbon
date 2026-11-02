// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { SERVER_MAIL_CONFIGURED } from "@carbon/lib/email.server";
import { getLogger } from "@carbon/logger";
import { Gmail } from "../gmail/config";
import { readConnection } from "../integrations/connections";
import { parseEmailSettings } from "./delivery";

const logger = getLogger("ee", "email");

/**
 * Server-side healthcheck for the Email integration.
 *
 * Validates the stored credentials for the company's chosen delivery
 * provider without actually sending a message:
 *
 * - `server`: healthy when this server has mail settings. The company's From
 *   cannot make it undeliverable: it is only ever the Reply-To beside the
 *   server's own From (see `sharedMailHeaders`), so the relay only ever sees its
 *   own sender.
 * - `resend`: hits `GET https://api.resend.com/domains` with the API key.
 *   A 2xx means the key is valid and has read access; a 401
 *   `restricted_api_key` means a valid "Sending access" key, also healthy.
 *   Anything else means the credentials are wrong or the account is suspended.
 * - `smtp`:   dynamically imports `nodemailer`, builds a transport from the
 *   stored host/port/username/password/secure and calls `.verify()`, which
 *   performs a handshake without sending mail.
 * - `gmail`:  the picked connection is this company's Gmail account and is
 *   Active. An Expired or Revoked one needs a reconnect on the Gmail card.
 *
 * Returns `true` on success and `false` on any failure (invalid metadata,
 * network error, bad credentials). Never throws — the settings page caches
 * a boolean and we don't want a transient SMTP outage to surface as a 500
 * in the integrations list.
 */
export async function emailHealthcheck(
  companyId: string,
  metadata: Record<string, unknown>
): Promise<boolean> {
  const parsed = parseEmailSettings(metadata);
  if (!parsed.success) return false;

  const data = parsed.data;
  if (data.provider === "server") return SERVER_MAIL_CONFIGURED;

  try {
    if (data.provider === "gmail") {
      const connection = await readConnection(
        getCarbonServiceRole(),
        companyId,
        data.gmailConnectionId
      );
      return (
        connection?.pieceName === Gmail.id && connection.status === "Active"
      );
    }

    if (data.provider === "resend") {
      const response = await fetch("https://api.resend.com/domains", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${data.apiKey}`
        }
      });
      if (response.ok) return true;
      // A "Sending access" key is refused here with `restricted_api_key`, but
      // sending is all the integration uses it for.
      if (response.status === 401) {
        const body = (await response.json().catch(() => null)) as {
          name?: string;
        } | null;
        return body?.name === "restricted_api_key";
      }
      return false;
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
