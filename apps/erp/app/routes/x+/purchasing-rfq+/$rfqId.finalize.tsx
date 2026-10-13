// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { storage } from "@carbon/files";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { redirect, tiptapToHTML } from "@carbon/utils";
import type { JSONContent } from "@tiptap/react";
import type { ActionFunctionArgs } from "react-router";
import {
  finalizePurchasingRfq,
  getPurchasingRFQ,
  getPurchasingRFQLines,
  getSupplierInteractionDocuments,
  getSupplierInteractionLineAttachments,
  purchasingRfqFinalizeValidator
} from "~/modules/purchasing";
import { getCompany } from "~/modules/settings";
import { requireCompanyRecord } from "~/modules/shared/shared.server";
import { getUser } from "~/modules/users/users.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "purchasing-rfq", "finalize");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing",
    role: "employee",
    bypassRls: true
  });

  const { rfqId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");

  // bypassRls hands back the service role and every read/write below is keyed
  // on the URL's rfqId.
  await requireCompanyRecord(client, "purchasingRfq", companyId, {
    id: rfqId
  });

  // Validate form data
  const validation = await validator(purchasingRfqFinalizeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { suppliers: supplierContacts } = validation.data;

  // Get RFQ, lines, and suppliers
  const [rfqResult, linesResult] = await Promise.all([
    getPurchasingRFQ(client, rfqId),
    getPurchasingRFQLines(client, rfqId)
  ]);

  if (rfqResult.error) {
    throw redirect(
      path.to.purchasingRfqDetails(rfqId),
      await flash(request, error(rfqResult.error, "Failed to load RFQ"))
    );
  }

  if (linesResult.error) {
    throw redirect(
      path.to.purchasingRfqDetails(rfqId),
      await flash(request, error(linesResult.error, "Failed to load RFQ lines"))
    );
  }

  const lines = linesResult.data ?? [];
  if (lines.length === 0) {
    throw redirect(
      path.to.purchasingRfqDetails(rfqId),
      await flash(request, error(null, "No line items found for this RFQ"))
    );
  }

  // Get company and user info for emails
  const [company, user] = await Promise.all([
    getCompany(client, companyId),
    getUser(client, userId)
  ]);

  const requestUrl = new URL(request.url);
  const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;

  // The quotes, their lines and share links, and the RFQ's status are written
  // in one transaction.
  const finalize = await finalizePurchasingRfq(client, getDatabaseClient(), {
    rfqId,
    companyId,
    userId
  });
  if (finalize.error) {
    throw redirect(
      path.to.purchasingRfqDetails(rfqId),
      await flash(
        request,
        error(
          finalize.error,
          finalize.error.message || "Failed to create supplier quotes"
        )
      )
    );
  }
  const createdQuotes = finalize.data.quotes;

  const contactIdBySupplier = new Map(
    supplierContacts.flatMap((sc) =>
      sc.contactId ? [[sc.supplierId, sc.contactId] as const] : []
    )
  );
  const contacts = contactIdBySupplier.size
    ? await client
        .from("supplierContact")
        .select("id, contact(email, firstName)")
        .in("id", [...contactIdBySupplier.values()])
        .eq("companyId", companyId)
    : null;
  const contactById = new Map(
    (contacts?.data ?? []).map((row) => [row.id, row.contact])
  );

  const emailsToSend = createdQuotes.flatMap((quote) => {
    const contactId = contactIdBySupplier.get(quote.supplierId);
    const contact = contactId ? contactById.get(contactId) : undefined;
    return contact?.email
      ? [
          {
            contactEmail: contact.email,
            contactFirstName: contact.firstName ?? "there",
            supplierQuoteReadableId: quote.supplierQuoteId,
            externalLinkId: quote.externalLinkId
          }
        ]
      : [];
  });

  // Send emails if we have any contacts (using same format as supplier quote send)
  if (emailsToSend.length > 0 && company.data && user.data) {
    // Build attachments: RFQ-level documents + line-level documents
    const attachments: Array<{ filename: string; path: string }> = [];

    // Fetch RFQ-level supplier interaction documents
    const rfqDocs = await getSupplierInteractionDocuments(
      client,
      companyId,
      rfqId
    );

    for (const doc of rfqDocs) {
      const storagePath = `${companyId}/supplier-interaction/${rfqId}/${doc.name}`;
      const { data, error } = await storage(client)
        .company(companyId)
        .createSignedUrl(storagePath, 3600);

      if (data) {
        attachments.push({ filename: doc.name, path: data.signedUrl });
      } else {
        logger.error("Failed to create signed URL for attachment", {
          storagePath,
          error
        });
      }
    }

    attachments.push(
      ...(await getSupplierInteractionLineAttachments(
        client,
        companyId,
        lines.flatMap((line) => (line.id ? [line.id] : []))
      ))
    );

    // Convert internal notes to HTML
    const internalNotes = (rfqResult.data?.internalNotes ?? {}) as JSONContent;
    const notesHtml = tiptapToHTML(internalNotes);

    for (const email of emailsToSend) {
      try {
        const externalQuoteUrl = `${baseUrl}${path.to.externalSupplierQuote(email.externalLinkId)}`;
        const emailSubject = `Supplier Quote ${email.supplierQuoteReadableId} from ${company.data.name}`;
        const emailBody = `Hey ${email.contactFirstName},\n\nPlease provide pricing and lead time(s) for the linked quote:`;
        const emailSignature = `Thanks,\n${user.data.firstName} ${user.data.lastName}\n${company.data.name}`;

        const htmlParts = [
          emailBody.replace(/\n/g, "<br>"),
          `<br><a href="${externalQuoteUrl}">${externalQuoteUrl}</a>`
        ];

        if (notesHtml) {
          htmlParts.push(`<br><br>${notesHtml}`);
        }

        htmlParts.push(`<br><br>${emailSignature.replace(/\n/g, "<br>")}`);

        await trigger("send-email", {
          to: [user.data.email, email.contactEmail],
          from: user.data.email,
          subject: emailSubject,
          html: htmlParts.join(""),
          text: `${emailBody}\n\n${externalQuoteUrl}\n\n${emailSignature}`,
          attachments,
          companyId
        });
      } catch (err) {
        logger.error("Failed to send email", { error: err });
        // Continue with other emails even if one fails
      }
    }
  }

  throw redirect(
    path.to.purchasingRfqDetails(rfqId),
    await flash(
      request,
      success(
        `Created ${createdQuotes.length} supplier quote(s)${
          emailsToSend.length > 0
            ? ` and sent ${emailsToSend.length} email(s)`
            : ""
        }`
      )
    )
  );
}
