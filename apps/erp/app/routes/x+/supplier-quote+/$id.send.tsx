import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getSupplierContact,
  getSupplierInteractionDocuments,
  getSupplierInteractionLineDocuments,
  getSupplierQuote,
  getSupplierQuoteLines,
  sendSupplierQuote,
  supplierQuoteFinalizeValidator
} from "~/modules/purchasing";
import { getCompany } from "~/modules/settings";
import { upsertExternalLink } from "~/modules/shared";
import { getUser } from "~/modules/users/users.server";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const { request, params } = args;
  assertIsPost(request);

  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing",
    role: "employee",
    bypassRls: true
  });

  const { id } = params;
  if (!id) throw new Error("Could not find supplier quote id");

  const quote = await getSupplierQuote(id);
  if (quote.error) {
    throw redirect(
      path.to.supplierQuote(id),
      await flash(request, error(quote.error, "Failed to get supplier quote"))
    );
  }

  // Reuse existing external link or create one if it doesn't exist
  const externalLink = await upsertExternalLink({
    id: quote.data.externalLinkId ?? undefined,
    documentType: "SupplierQuote",
    documentId: id,
    supplierId: quote.data.supplierId,
    expiresAt: quote.data.expirationDate,
    companyId
  });

  if (externalLink.data && quote.data.externalLinkId !== externalLink.data.id) {
    await client
      .from("supplierQuote")
      .update({
        externalLinkId: externalLink.data.id
      })
      .eq("id", id);
  }

  // Send keeps status as Draft
  try {
    const send = await sendSupplierQuote(id);
    if (send.error) {
      throw redirect(
        path.to.supplierQuote(id),
        await flash(request, error(send.error, "Failed to send supplier quote"))
      );
    }
  } catch (err) {
    throw redirect(
      path.to.supplierQuote(id),
      await flash(request, error(err, "Failed to send supplier quote"))
    );
  }

  const validation = await validator(supplierQuoteFinalizeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    notification,
    supplierContact: supplierContactId,
    cc: ccSelections
  } = validation.data;

  switch (notification) {
    case "Email":
      try {
        if (!supplierContactId) throw new Error("Supplier contact is required");

        const [company, supplierContact, supplierQuote, user] =
          await Promise.all([
            getCompany(),
            getSupplierContact(supplierContactId),
            getSupplierQuote(id),
            getUser(client, userId)
          ]);

        if (!company.data) throw new Error("Failed to get company");
        if (!supplierContact?.data?.contact)
          throw new Error("Failed to get supplier contact");
        if (!supplierQuote.data)
          throw new Error("Failed to get supplier quote");
        if (!user.data) throw new Error("Failed to get user");

        const attachments: Array<{ filename: string; path: string }> = [];

        // Fetch top-level supplier interaction documents
        const interactionId = supplierQuote.data.supplierInteractionId;
        if (interactionId) {
          const topDocs = await getSupplierInteractionDocuments(interactionId);

          for (const doc of topDocs) {
            const storagePath = `${companyId}/supplier-interaction/${interactionId}/${doc.name}`;
            const { data: signedUrlData } = await client.storage
              .from("private")
              .createSignedUrl(storagePath, 3600);

            if (signedUrlData?.signedUrl) {
              attachments.push({
                filename: doc.name,
                path: signedUrlData.signedUrl
              });
            }
          }
        }

        // Fetch line-level supplier interaction documents
        const lines = await getSupplierQuoteLines(id);

        if (lines.data) {
          for (const line of lines.data) {
            const docs = await getSupplierInteractionLineDocuments(
              line.id ?? ""
            );

            for (const doc of docs) {
              const storagePath = `${companyId}/supplier-interaction-line/${line.id}/${doc.name}`;
              const { data: signedUrlData } = await client.storage
                .from("private")
                .createSignedUrl(storagePath, 3600);

              if (signedUrlData?.signedUrl) {
                attachments.push({
                  filename: doc.name,
                  path: signedUrlData.signedUrl
                });
              }
            }
          }
        }

        const requestUrl = new URL(request.url);
        const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
        const externalQuoteUrl: string = `${baseUrl}${path.to.externalSupplierQuote(
          externalLink.data?.id ?? ""
        )}`;

        const emailSubject = `Supplier Quote ${supplierQuote.data.supplierQuoteId} from ${company.data.name}`;

        const emailBody = `Hey ${
          supplierContact.data.contact.firstName || "there"
        },\n\nPlease provide pricing and lead time(s) for the linked quote:`;
        const emailSignature = `Thanks,\n${user.data.firstName} ${user.data.lastName}\n${company.data.name}`;

        await trigger("send-email", {
          to: [user.data.email, supplierContact.data.contact?.email].filter(
            Boolean
          ) as string[],
          cc: ccSelections?.length ? ccSelections : undefined,
          from: user.data.email,
          subject: emailSubject,
          html: `${emailBody.replace(
            /\n/g,
            "<br>"
          )}<br><a href="${externalQuoteUrl}">${externalQuoteUrl}</a><br><br>${emailSignature.replace(
            /\n/g,
            "<br>"
          )}`,
          text: `${emailBody}\n\n${externalQuoteUrl}\n\n${emailSignature}`,
          attachments,
          companyId
        });
      } catch (err) {
        throw redirect(
          path.to.supplierQuote(id),
          await flash(request, error(err, "Failed to send email"))
        );
      }

      break;
    case undefined:
    case "Share":
      break;
    default:
      throw new Error("Invalid notification type");
  }

  throw redirect(
    path.to.supplierQuote(id),
    await flash(request, success("Supplier quote sent successfully"))
  );
}
