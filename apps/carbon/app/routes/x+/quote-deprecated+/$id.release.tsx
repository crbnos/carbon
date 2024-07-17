import { QuoteEmail } from "@carbon/documents";
import { validationError, validator } from "@carbon/remix-validated-form";
import { renderAsync } from "@react-email/components";
import { redirect, type ActionFunctionArgs } from "@remix-run/node";
import { triggerClient } from "~/lib/trigger.server";
import { upsertDocument } from "~/modules/documents";
import {
  getCustomer,
  getCustomerContact,
  getQuote,
  getQuoteLines,
  quotationReleaseValidator,
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

export async function action(args: ActionFunctionArgs) {
  const { request, params } = args;
  assertIsPost(request);

  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales",
    role: "employee",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  let file: ArrayBuffer;
  let fileName: string;

  const release = await releaseQuote(client, id, userId);
  if (release.error) {
    throw redirect(
      path.to.quote(id),
      await flash(request, error(release.error, "Failed to release quote"))
    );
  }

  const quote = await getQuote(client, id);
  if (quote.error) {
    throw redirect(
      path.to.quote(id),
      await flash(request, error(quote.error, "Failed to get quote"))
    );
  }

  try {
    const pdf = await pdfLoader(args);
    if (pdf.headers.get("content-type") !== "application/pdf")
      throw new Error("Failed to generate PDF");

    file = await pdf.arrayBuffer();
    fileName = `${quote.data.quoteId} - ${new Date()
      .toISOString()
      .slice(0, -5)}.pdf`;

    const documentFilePath = `${companyId}/quote/internal/${id}/${fileName}`;

    const documentFileUpload = await client.storage
      .from("private")
      .upload(documentFilePath, file, {
        cacheControl: `${12 * 60 * 60}`,
        contentType: "application/pdf",
        upsert: true,
      });

    if (documentFileUpload.error) {
      throw redirect(
        path.to.quote(id),
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
      sourceDocumentId: id,
      readGroups: [userId],
      writeGroups: [userId],
      createdBy: userId,
      companyId,
    });

    if (createDocument.error) {
      return redirect(
        path.to.quote(id),
        await flash(
          request,
          error(createDocument.error, "Failed to create document")
        )
      );
    }
  } catch (err) {
    throw redirect(
      path.to.quote(id),
      await flash(request, error(err, "Failed to generate PDF"))
    );
  }

  const validation = await validator(quotationReleaseValidator).validate(
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

        const [company, customer, customerContact, quoteLines, user] =
          await Promise.all([
            getCompany(client, companyId),
            getCustomer(client, quote.data.customerId!),
            getCustomerContact(client, customerContactId),
            getQuoteLines(client, id),
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
          // @ts-ignore
          quoteLines: quoteLines.data ?? [],
          recipient: {
            email: customerContact.data?.contact!.email!,
            firstName: "Customer",
            lastName: "",
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
            subject: `${quote.data.quoteId} from ${company.data.name}`,
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
          path.to.quote(id),
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
    path.to.quote(id),
    await flash(request, success("Quote released"))
  );
}
