// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
// Deep subpaths, not the `@carbon/ee` barrel: it validates the server env at
// import, which every job test importing this module would then need.
import {
  companyTransport,
  Email,
  picksCredentialFreeEmail,
  resolveEmailDelivery,
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
import { sendViaGmail } from "./gmail";

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
 * transport is configured. Throws only when the company's settings cannot be
 * read, which the caller's retry handles.
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
      .select("active, metadata, secretRef")
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

  const delivery = resolveEmailDelivery(
    integration.data,
    SERVER_MAIL_CONFIGURED
  );
  const companyName = company.data?.name?.trim() || null;

  // No delivery, or server mail: this server's own transport.
  if (!integration.data || !delivery || delivery.provider === "server") {
    return sendEmail({
      ...message,
      ...sharedMailHeaders(
        {
          document,
          companyName,
          replyTo: message.replyTo,
          companyAddress: delivery?.fromEmail
        },
        DEFAULT_FROM
      )
    });
  }

  const { metadata, secretRef } = integration.data;
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
    return sendViaGmail(
      serviceClient,
      companyId,
      transport.connectionId,
      senderName,
      message
    );
  }
  return deliverEmail(createSmtpTransport(transport), {
    ...message,
    from: { name: senderName, address: transport.fromEmail }
  });
}
