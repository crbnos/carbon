import { QuoteEmail } from "@carbon/documents";
import { validationError, validator } from "@carbon/form";
import { renderAsync } from "@react-email/components";
import { redirect, type ActionFunctionArgs } from "@vercel/remix";
import { triggerClient } from "~/lib/trigger.server";
import { upsertDocument } from "~/modules/documents";
import {
  getCustomer,
  getCustomerContact,
  getQuote,
  quoteFinalizeValidator,
  releaseQuote,
} from "~/modules/sales";
import { getCompany } from "~/modules/settings";
import { getUser } from "~/modules/users/users.server";
import { loader as pdfLoader } from "~/routes/file+/quote+/$id[.]pdf";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

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

  const quote = await getQuote(client, quoteId);
  if (quote.error) {
    throw redirect(
      path.to.quote(quoteId),
      await flash(request, error(quote.error, "Failed to get quote"))
    );
  }

  try {
    const pdf = await pdfLoader({ ...args, params: { id: quoteId } });
    if (pdf.headers.get("content-type") !== "application/pdf")
      throw new Error("Failed to generate PDF");

    file = await pdf.arrayBuffer();
    fileName = `${quote.data.quoteId} - ${new Date()
      .toISOString()
      .slice(0, -5)}.pdf`;

    const documentFilePath = `${companyId}/quote/${quoteId}/${fileName}`;

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

    const release = await releaseQuote(client, quoteId, userId);
    if (release.error) {
      throw redirect(
        path.to.quote(quoteId),
        await flash(request, error(release.error, "Failed to release quote"))
      );
    }
  } catch (err) {
    throw redirect(
      path.to.quote(quoteId),
      await flash(request, error(err, "Failed to release quote"))
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

        // TODO: Update sender email
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

        await triggerClient.sendEvent({
          name: "resend.email",
          payload: {
            to: customerContact.data.contact!.email!,
            from: user.data.email,
            subject: `Quote ${quote.data.quoteId}`,
            html: await renderAsync(emailTemplate),
            text: await renderAsync(emailTemplate, { plainText: true }),
            attachments: [
              {
                content: Buffer.from(file),
                filename: fileName,
              },
            ],
            companyId,
          },
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
