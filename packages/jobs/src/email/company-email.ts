// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
// Deep subpaths, not the `@carbon/ee` barrel: it validates the server env at
// import, which every job test importing this module would then need.
import {
  companyMailRoute,
  companyTransport,
  Email,
  picksCredentialFreeEmail,
  sharedMailHeaders
} from "@carbon/ee/email/delivery";
import { resolveIntegrationSecrets } from "@carbon/ee/integrations/secrets";
import {
  createSmtpTransport,
  DEFAULT_FROM,
  deliverEmail,
  SERVER_MAIL_CONFIGURED,
  type SendEmailPayload,
  type SendEmailResult,
  sendEmail
} from "@carbon/lib/email.server";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GmailSendingLimitError, sendViaGmail } from "./gmail";

const log = getLogger("jobs", "company-email");

export type CompanyEmailPayload = Omit<SendEmailPayload, "from"> & {
  /** A quote, order, invoice, PO or RFQ: on server mail, From carries the company name. */
  document?: boolean;
};

/**
 * Sends one email for a company the way its Email settings say: its own
 * Resend account, SMTP server or Gmail account, else this server's transport.
 * Carbon's own mail (sign-in codes, onboarding, the changelog) does not come
 * here — it calls `sendEmail` directly.
 *
 * `serviceClient` must be the service role: it reads the vaulted secrets and
 * the Gmail connection's token.
 *
 * Returns `sendEmail`'s result shape: `data: null` with no error means no
 * transport is configured. An installed method that cannot send returns an
 * error; it never falls back to another address. Throws only when the
 * company's settings cannot be read, which the caller's retry handles.
 */
export async function sendCompanyEmail(
  serviceClient: SupabaseClient<Database>,
  companyId: string,
  payload: CompanyEmailPayload
): Promise<SendEmailResult> {
  const { document = false, ...message } = payload;

  const [integration, company] = await Promise.all([
    serviceClient
      .from("companyIntegration")
      .select("active, metadata, secretRef, updatedBy")
      .eq("id", Email.id)
      .eq("companyId", companyId)
      .maybeSingle(),
    serviceClient
      .from("company")
      .select("name")
      .eq("id", companyId)
      .maybeSingle()
  ]);
  if (integration.error) {
    log.error("Failed to read the company's Email integration", {
      companyId,
      error: integration.error
    });
    throw integration.error;
  }
  if (company.error) {
    log.error("Failed to read the company's name", {
      companyId,
      error: company.error
    });
    throw company.error;
  }

  const route = companyMailRoute(integration.data, SERVER_MAIL_CONFIGURED);
  const companyName = company.data?.name?.trim() || null;

  if (route.route === "unusable") {
    log.error("The company's Email settings cannot send", { companyId });
    return {
      data: null,
      error: new Error(
        "The company's Email settings cannot send: pick a delivery method that is set up"
      )
    };
  }

  if (route.route === "shared") {
    return sendEmail({
      ...message,
      ...sharedMailHeaders(
        {
          document,
          companyName,
          replyTo: message.replyTo,
          companyAddress: route.delivery?.fromEmail
        },
        DEFAULT_FROM
      )
    });
  }

  const { metadata, secretRef, updatedBy } = route.integration;
  const transport = companyTransport(
    picksCredentialFreeEmail(Email.id, metadata)
      ? metadata
      : await resolveIntegrationSecrets(
          serviceClient,
          companyId,
          Email.id,
          metadata,
          secretRef
        )
  );
  const senderName = companyName ?? "Carbon";

  if (transport.kind === "gmail") {
    const sent = await sendViaGmail(
      serviceClient,
      companyId,
      transport.connectionId,
      senderName,
      message
    );
    if (sent.error instanceof GmailSendingLimitError) {
      // Loaded here, not at the top: @carbon/kv boots the server env on import,
      // which every job test that imports this module would then need.
      const { notifyGmailSendingLimit } = await import("./sending-limit");
      await notifyGmailSendingLimit(companyId, updatedBy);
    }
    return sent;
  }
  return deliverEmail(createSmtpTransport(transport), {
    ...message,
    from: { name: senderName, address: transport.fromEmail }
  });
}
