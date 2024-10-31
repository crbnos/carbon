import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { QuoteEmail } from "@carbon/documents";
import { validationError, validator } from "@carbon/form";
import { renderAsync } from "@react-email/components";
import { tasks } from "@trigger.dev/sdk/v3";
import { redirect, type ActionFunctionArgs } from "@vercel/remix";
import { upsertDocument } from "~/modules/documents";
import {
  finalizeQuote,
  getCustomer,
  getCustomerContact,
  getOpportunityByQuote,
  getQuote,
  quoteFinalizeValidator,
} from "~/modules/sales";
import { getCompany } from "~/modules/settings";
import { upsertExternalLink } from "~/modules/shared";
import { getUser } from "~/modules/users/users.server";
import { loader as pdfLoader } from "~/routes/file+/quote+/$id[.]pdf";
import type { sendEmailResendTask } from "~/trigger/send-email-resend"; // Assuming you have this task defined
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

export const config = { runtime: "nodejs" };

export async function action(args: ActionFunctionArgs) {
  const { request, params } = args;
  assertIsPost(request);

  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales",
    role: "employee",
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  let file: ArrayBuffer;
  let fileName: string;

  const [quote, opportunity] = await Promise.all([
    getQuote(client, quoteId),
    getOpportunityByQuote(client, quoteId),
  ]);
  if (quote.error) {
    throw redirect(
      path.to.quote(quoteId),
      await flash(request, error(quote.error, "Failed to get quote"))
    );
  }
  if (opportunity.error) {
    throw redirect(
      path.to.quote(quoteId),
      await flash(
        request,
        error(opportunity.error, "Failed to get opportunity")
      )
    );
  }

  const externalLink = await upsertExternalLink(client, {
    id: quote.data.externalLinkId ?? undefined, // TODO
    documentType: "Quote",
    documentId: quoteId,
    customerId: quote.data.customerId,
    expiresAt: quote.data.expirationDate,
    companyId,
  });

  if (externalLink.data && quote.data.externalLinkId !== externalLink.data.id) {
    await client
      .from("quote")
      .update({ externalLinkId: externalLink.data.id })
      .eq("id", quoteId);
  }

  try {
    const pdf = await pdfLoader({ ...args, params: { id: quoteId } });
    if (pdf.headers.get("content-type") !== "application/pdf")
      throw new Error("Failed to generate PDF");

    file = await pdf.arrayBuffer();
    fileName = stripSpecialCharacters(
      `${quote.data.quoteId} - ${new Date().toISOString().slice(0, -5)}.pdf`
    );

    const documentFilePath = `${companyId}/opportunity/${opportunity.data.id}/${fileName}`;

    const documentFileUpload = await client.storage
      .from("private")
      .upload(documentFilePath, file, {
        cacheControl: `${12 * 60 * 60}`,
        contentType: "application/pdf",
        upsert: true,
      });

    if (documentFileUpload.error) {
      throw redirect(
        path.to.quote(quoteId),
        await flash(
          request,
          error(documentFileUpload.error, "Failed to upload file")
        )
      );
    }

    const createDocument = await upsertDocument(client, {
      path: documentFilePath,
      name: fileName,
      size: Math.round(file.byteLength / 1024),
      sourceDocument: "Quote",
      sourceDocumentId: quoteId,
      readGroups: [userId],
      writeGroups: [userId],
      createdBy: userId,
      companyId,
    });

    if (createDocument.error) {
      return redirect(
        path.to.quote(quoteId),
        await flash(
          request,
          error(createDocument.error, "Failed to create document")
        )
      );
    }

    const finalize = await finalizeQuote(client, quoteId, userId);
    if (finalize.error) {
      throw redirect(
        path.to.quote(quoteId),
        await flash(request, error(finalize.error, "Failed to finalize quote"))
      );
    }
  } catch (err) {
    throw redirect(
      path.to.quote(quoteId),
      await flash(request, error(err, "Failed to finalize quote"))
    );
  }

  const validation = await validator(quoteFinalizeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { notification, customerContact: customerContactId } = validation.data;

  switch (notification) {
    case "Email":
      try {
        if (!customerContactId) throw new Error("Customer contact is required");

        const [company, customer, customerContact, user] = await Promise.all([
          getCompany(client, companyId),
          getCustomer(client, quote.data.customerId!),
          getCustomerContact(client, customerContactId),
          getUser(client, userId),
        ]);

        if (!company.data) throw new Error("Failed to get company");
        if (!customer.data) throw new Error("Failed to get customer");
        if (!customerContact.data)
          throw new Error("Failed to get customer contact");
        if (!user.data) throw new Error("Failed to get user");

        const emailTemplate = QuoteEmail({
          company: company.data,
          // @ts-ignore
          quote: quote.data,
          recipient: {
            email: customerContact.data?.contact!.email!,
            firstName: customerContact.data.contact!.firstName!,
            lastName: customerContact.data.contact!.lastName!,
          },
          sender: {
            email: user.data.email,
            firstName: user.data.firstName,
            lastName: user.data.lastName,
          },
        });

        const html = await renderAsync(emailTemplate);
        const text = await renderAsync(emailTemplate, { plainText: true });

        await tasks.trigger<typeof sendEmailResendTask>("send-email-resend", {
          to: customerContact.data.contact!.email!,
          from: user.data.email,
          subject: `Quote ${quote.data.quoteId}`,
          html,
          text,
          attachments: [
            {
              content: Buffer.from(file).toString("base64"),
              filename: fileName,
            },
          ],
          companyId,
        });
      } catch (err) {
        throw redirect(
          path.to.quote(quoteId),
          await flash(request, error(err, "Failed to send email"))
        );
      }

      break;
    case undefined:
    case "None":
      break;
    default:
      throw new Error("Invalid notification type");
  }

  throw redirect(
    path.to.quote(quoteId),
    await flash(request, success("Quote finalized successfully"))
  );
}
