import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { PurchaseOrderEmail } from "@carbon/documents/email";
import { validationError, validator } from "@carbon/form";
import { renderAsync } from "@react-email/components";
import { tasks } from "@trigger.dev/sdk/v3";
import { redirect, type ActionFunctionArgs } from "@vercel/remix";
import { parseAcceptLanguage } from "intl-parse-accept-language";
import { upsertDocument } from "~/modules/documents";
import {
  getPurchaseOrder,
  getPurchaseOrderLines,
  getPurchaseOrderLocations,
  getSupplierContact,
  purchaseOrderReleaseValidator,
  releasePurchaseOrder,
} from "~/modules/purchasing";
import { getCompany } from "~/modules/settings";
import { getUser } from "~/modules/users/users.server";
import { loader as pdfLoader } from "~/routes/file+/purchase-order+/$orderId[.]pdf";
import type { sendEmailResendTask } from "~/trigger/send-email-resend"; // Assuming you have a sendEmail task defined
import { path, requestReferrer } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

export const config = { runtime: "nodejs" };

export async function action(args: ActionFunctionArgs) {
  const { request, params } = args;
  assertIsPost(request);

  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing",
    role: "employee",
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  let file: ArrayBuffer;
  let fileName: string;

  const release = await releasePurchaseOrder(client, orderId, userId);
  if (release.error) {
    throw redirect(
      path.to.purchaseOrder(orderId),
      await flash(
        request,
        error(release.error, "Failed to release purchase order")
      )
    );
  }

  const serviceRole = getCarbonServiceRole();

  const [purchaseOrder] = await Promise.all([
    getPurchaseOrder(serviceRole, orderId),
  ]);
  if (purchaseOrder.error) {
    throw redirect(
      path.to.purchaseOrder(orderId),
      await flash(
        request,
        error(purchaseOrder.error, "Failed to get purchase order")
      )
    );
  }

  if (purchaseOrder.data.companyId !== companyId) {
    throw redirect(
      path.to.purchaseOrders,
      await flash(
        request,
        error("You are not authorized to release this purchase order")
      )
    );
  }

  const acceptLanguage = request.headers.get("accept-language");
  const locales = parseAcceptLanguage(acceptLanguage, {
    validate: Intl.DateTimeFormat.supportedLocalesOf,
  });

  try {
    const pdf = await pdfLoader(args);
    if (pdf.headers.get("content-type") !== "application/pdf")
      throw new Error("Failed to generate PDF");

    file = await pdf.arrayBuffer();
    fileName = stripSpecialCharacters(
      `${purchaseOrder.data.purchaseOrderId} - ${new Date()
        .toISOString()
        .slice(0, -5)}.pdf`
    );

    const documentFilePath = `${companyId}/supplier-interaction/${purchaseOrder.data.supplierInteractionId}/${fileName}`;

    const documentFileUpload = await serviceRole.storage
      .from("private")
      .upload(documentFilePath, file, {
        cacheControl: `${12 * 60 * 60}`,
        contentType: "application/pdf",
        upsert: true,
      });

    if (documentFileUpload.error) {
      throw redirect(
        path.to.purchaseOrder(orderId),
        await flash(
          request,
          error(documentFileUpload.error, "Failed to upload file")
        )
      );
    }

    const createDocument = await upsertDocument(serviceRole, {
      path: documentFilePath,
      name: fileName,
      size: Math.round(file.byteLength / 1024),
      sourceDocument: "Purchase Order",
      sourceDocumentId: orderId,
      readGroups: [userId],
      writeGroups: [userId],
      createdBy: userId,
      companyId,
    });

    if (createDocument.error) {
      return redirect(
        path.to.purchaseOrder(orderId),
        await flash(
          request,
          error(createDocument.error, "Failed to create document")
        )
      );
    }
  } catch (err) {
    throw redirect(
      path.to.purchaseOrder(orderId),
      await flash(request, error(err, "Failed to generate PDF"))
    );
  }

  const validation = await validator(purchaseOrderReleaseValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { notification, supplierContact } = validation.data;

  switch (notification) {
    case "Email":
      try {
        if (!supplierContact) throw new Error("Supplier contact is required");

        const [
          company,
          supplier,
          purchaseOrder,
          purchaseOrderLines,
          purchaseOrderLocations,
          buyer,
        ] = await Promise.all([
          getCompany(serviceRole, companyId),
          getSupplierContact(serviceRole, supplierContact),
          getPurchaseOrder(serviceRole, orderId),
          getPurchaseOrderLines(serviceRole, orderId),
          getPurchaseOrderLocations(serviceRole, orderId),
          getUser(serviceRole, userId),
        ]);

        if (!supplier?.data?.contact)
          throw new Error("Failed to get supplier contact");
        if (!company.data) throw new Error("Failed to get company");
        if (!buyer.data) throw new Error("Failed to get user");
        if (!purchaseOrder.data)
          throw new Error("Failed to get purchase order");
        if (!purchaseOrderLocations.data)
          throw new Error("Failed to get purchase order locations");

        const emailTemplate = PurchaseOrderEmail({
          company: company.data,
          locale: locales?.[0] ?? "en-US",
          purchaseOrder: purchaseOrder.data,
          purchaseOrderLines: purchaseOrderLines.data ?? [],
          purchaseOrderLocations: purchaseOrderLocations.data,
          recipient: {
            email: supplier.data.contact.email,
            firstName: supplier.data.contact.firstName ?? undefined,
            lastName: supplier.data.contact.lastName ?? undefined,
          },
          sender: {
            email: buyer.data.email,
            firstName: buyer.data.firstName,
            lastName: buyer.data.lastName,
          },
        });

        const html = await renderAsync(emailTemplate);
        const text = await renderAsync(emailTemplate, { plainText: true });

        await tasks.trigger<typeof sendEmailResendTask>("send-email-resend", {
          to: [buyer.data.email, supplier.data.contact.email],
          from: buyer.data.email,
          subject: `${purchaseOrder.data.purchaseOrderId} from ${company.data.name}`,
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
          path.to.purchaseOrder(orderId),
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
    requestReferrer(request) ?? path.to.purchaseOrder(orderId),
    await flash(request, success("Purchase order released"))
  );
}
