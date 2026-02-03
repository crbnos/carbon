import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { sendEmailResendTask } from "@carbon/jobs/trigger/send-email-resend";
import { tiptapToHTML } from "@carbon/utils";
import type { JSONContent } from "@tiptap/react";
import { tasks } from "@trigger.dev/sdk";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getPurchasingRFQ,
  getPurchasingRFQLines,
  getPurchasingRFQSuppliers,
  getSupplierContact,
  getSupplierInteractionDocuments,
  getSupplierInteractionLineDocuments,
  purchasingRfqFinalizeValidator,
  updatePurchasingRFQStatus,
  upsertSupplierQuote,
  upsertSupplierQuoteLine
} from "~/modules/purchasing";
import { getCompany, getNextSequence } from "~/modules/settings";
import { upsertExternalLink } from "~/modules/shared";
import { getUser } from "~/modules/users/users.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing",
    role: "employee",
    bypassRls: true
  });

  const { rfqId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");

  // Validate form data
  const validation = await validator(purchasingRfqFinalizeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { suppliers: supplierContacts } = validation.data;

  // Get RFQ, lines, and suppliers
  const [rfqResult, linesResult, suppliersResult] = await Promise.all([
    getPurchasingRFQ(client, rfqId),
    getPurchasingRFQLines(client, rfqId),
    getPurchasingRFQSuppliers(client, rfqId)
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

  if (suppliersResult.error) {
    throw redirect(
      path.to.purchasingRfqDetails(rfqId),
      await flash(
        request,
        error(suppliersResult.error, "Failed to load RFQ suppliers")
      )
    );
  }

  const lines = linesResult.data ?? [];
  const suppliers = suppliersResult.data ?? [];

  if (suppliers.length === 0) {
    throw redirect(
      path.to.purchasingRfqDetails(rfqId),
      await flash(request, error(null, "No suppliers found for this RFQ"))
    );
  }

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

  // Create a supplier quote for each supplier
  const createdQuotes: string[] = [];
  const emailsToSend: Array<{
    contactEmail: string;
    contactFirstName: string;
    supplierQuoteId: string;
    externalLinkId: string;
  }> = [];

  for (const rfqSupplier of suppliers) {
    const supplierId = rfqSupplier.supplierId;
    const supplierContactData = supplierContacts.find(
      (sc) => sc.supplierId === supplierId
    );

    // Get next sequence number for the supplier quote
    const sequence = await getNextSequence(client, "supplierQuote", companyId);
    if (sequence.error || !sequence.data) {
      console.error("Failed to get sequence:", sequence.error);
      continue;
    }

    // Create the supplier quote
    const quoteResult = await upsertSupplierQuote(client, {
      supplierQuoteId: sequence.data,
      supplierQuoteType: "Purchase",
      supplierId,
      quotedDate: new Date().toISOString().split("T")[0],
      companyId,
      createdBy: userId
    });

    if (quoteResult.error || !quoteResult.data) {
      console.error("Failed to create supplier quote:", quoteResult.error);
      continue;
    }

    const supplierQuoteId = quoteResult.data.id;
    createdQuotes.push(supplierQuoteId);

    // Create quote lines for each RFQ line that has an itemId
    for (const line of lines) {
      // Skip lines without an itemId since supplierQuoteLine.itemId is NOT NULL
      if (!line.itemId) {
        console.warn("Skipping line without itemId:", line.id);
        continue;
      }

      await upsertSupplierQuoteLine(client, {
        supplierQuoteId,
        itemId: line.itemId,
        description: line.description ?? "",
        quantity: line.quantity ?? [1],
        inventoryUnitOfMeasureCode: line.inventoryUnitOfMeasureCode ?? "EA",
        purchaseUnitOfMeasureCode: line.purchaseUnitOfMeasureCode ?? "EA",
        conversionFactor: line.conversionFactor ?? 1,
        companyId,
        createdBy: userId
      });
    }

    // Link RFQ to supplier quote
    await client.from("purchasingRfqToSupplierQuote").insert({
      purchasingRfqId: rfqId,
      supplierQuoteId,
      companyId
    });

    // Create or get external link for the supplier quote (required for sharing/email)
    // First check if one already exists (in case quote was created before)
    const existingLink = await client
      .from("externalLink")
      .select("id")
      .eq("documentId", supplierQuoteId)
      .eq("documentType", "SupplierQuote")
      .eq("companyId", companyId)
      .maybeSingle();

    const externalLinkResult = await upsertExternalLink(client, {
      id: existingLink.data?.id,
      documentType: "SupplierQuote",
      documentId: supplierQuoteId,
      supplierId,
      companyId
    });

    // Update quote with external link ID
    if (externalLinkResult.data) {
      await client
        .from("supplierQuote")
        .update({ externalLinkId: externalLinkResult.data.id })
        .eq("id", supplierQuoteId);
    }

    // If contact was provided, queue up email
    if (supplierContactData?.contactId && externalLinkResult.data) {
      const supplierContact = await getSupplierContact(
        client,
        supplierContactData.contactId
      );

      if (supplierContact?.data?.contact?.email) {
        emailsToSend.push({
          contactEmail: supplierContact.data.contact.email,
          contactFirstName: supplierContact.data.contact.firstName ?? "there",
          supplierQuoteId: sequence.data,
          externalLinkId: externalLinkResult.data.id
        });
      }
    }
  }

  // Update RFQ status to Requested
  await updatePurchasingRFQStatus(client, {
    id: rfqId,
    status: "Requested",
    updatedBy: userId
  });

  // Send emails if we have any contacts (using same format as supplier quote send)
  if (emailsToSend.length > 0 && company.data && user.data) {
    // Build attachments: RFQ-level documents + line-level documents
    const attachments: Array<{ filename: string; content: string }> = [];

    // Fetch RFQ-level supplier interaction documents
    const rfqDocs = await getSupplierInteractionDocuments(
      client,
      companyId,
      rfqId
    );

    for (const doc of rfqDocs) {
      const { data: fileData } = await client.storage
        .from("private")
        .download(`${companyId}/supplier-interaction/${rfqId}/${doc.name}`);

      if (fileData) {
        const arrayBuffer = await fileData.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        attachments.push({ filename: doc.name, content: base64 });
      }
    }

    // Fetch line-level supplier interaction documents
    for (const line of lines) {
      if (!line.id) continue;

      const lineDocs = await getSupplierInteractionLineDocuments(
        client,
        companyId,
        line.id
      );

      for (const doc of lineDocs) {
        const { data: fileData } = await client.storage
          .from("private")
          .download(
            `${companyId}/supplier-interaction-line/${line.id}/${doc.name}`
          );

        if (fileData) {
          const arrayBuffer = await fileData.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString("base64");
          attachments.push({ filename: doc.name, content: base64 });
        }
      }
    }

    // Convert internal notes to HTML
    const internalNotes = (rfqResult.data?.internalNotes ?? {}) as JSONContent;
    const notesHtml = tiptapToHTML(internalNotes);

    for (const email of emailsToSend) {
      try {
        const externalQuoteUrl = `${baseUrl}${path.to.externalSupplierQuote(email.externalLinkId)}`;
        const emailSubject = `Supplier Quote ${email.supplierQuoteId} from ${company.data.name}`;
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

        await tasks.trigger<typeof sendEmailResendTask>("send-email-resend", {
          to: [user.data.email, email.contactEmail],
          from: user.data.email,
          subject: emailSubject,
          html: htmlParts.join(""),
          text: `${emailBody}\n\n${externalQuoteUrl}\n\n${emailSignature}`,
          attachments,
          companyId
        });
      } catch (err) {
        console.error("Failed to send email:", err);
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
