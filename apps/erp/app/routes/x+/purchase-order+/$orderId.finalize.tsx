import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { PurchaseOrderEmail } from "@carbon/documents/email";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { NotificationEvent } from "@carbon/notifications";
import {
  createCompanyPrivateSignedUrl,
  getCompanyPrivateBucket
} from "@carbon/utils";
import { renderAsync } from "@react-email/components";
import { parseAcceptLanguage } from "intl-parse-accept-language";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getPaymentTermsList } from "~/modules/accounting";
import { upsertDocument } from "~/modules/documents";
import {
  finalizePurchaseOrder,
  getPurchaseOrder,
  getPurchaseOrderLines,
  getPurchaseOrderLocations,
  getSupplier,
  getSupplierContact,
  purchaseOrderFinalizeValidator,
  updatePurchaseOrderStatus
} from "~/modules/purchasing";
import { getCompany, getCompanySettings } from "~/modules/settings";
import {
  createApprovalRequest,
  getApprovalRuleByAmount,
  getApproverUserIdsForRule,
  hasPendingApproval,
  isApprovalRequired
} from "~/modules/shared";
import { getUser } from "~/modules/users/users.server";
import { loader as pdfLoader } from "~/routes/file+/purchase-order+/$orderId[.]pdf";
import { path, requestReferrer } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

export async function action(args: ActionFunctionArgs) {
  const { request, params } = args;
  assertIsPost(request);

  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing",
    role: "employee"
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  let file: ArrayBuffer;
  let fileName: string;
  let documentFilePath: string;

  const serviceRole = getCarbonServiceRole();

  const purchaseOrder = await getPurchaseOrder(serviceRole, orderId);
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
        error("You are not authorized to finalize this purchase order")
      )
    );
  }

  // Check supplier approval status
  const supplierApprovalRequired = await isApprovalRequired(
    serviceRole,
    "supplier",
    companyId
  );
  if (supplierApprovalRequired && purchaseOrder.data.supplierId) {
    const supplier = await getSupplier(
      serviceRole,
      purchaseOrder.data.supplierId
    );
    if (supplier.data?.status !== "Active") {
      throw redirect(
        path.to.purchaseOrder(orderId),
        await flash(
          request,
          error("Cannot finalize: supplier is not approved (Active)")
        )
      );
    }
  }

  const orderAmount = purchaseOrder.data.orderTotal ?? 0;
  const approvalRequired = await isApprovalRequired(
    serviceRole,
    "purchaseOrder",
    companyId,
    orderAmount
  );

  const finalize = await finalizePurchaseOrder(client, orderId, userId);
  if (finalize.error) {
    throw redirect(
      path.to.purchaseOrder(orderId),
      await flash(
        request,
        error(finalize.error, "Failed to finalize purchase order")
      )
    );
  }

  // If approval is required, create the request and return early
  // PDF generation, email sending, and price updates happen after approval
  if (approvalRequired) {
    const hasPending = await hasPendingApproval(
      serviceRole,
      "purchaseOrder",
      orderId
    );

    if (!hasPending) {
      await createApprovalRequest(serviceRole, {
        documentType: "purchaseOrder",
        documentId: orderId,
        companyId,
        requestedBy: userId,
        createdBy: userId,
        amount: orderAmount
      });

      const rule = await getApprovalRuleByAmount(
        serviceRole,
        "purchaseOrder",
        companyId,
        orderAmount
      );
      const approverIds = rule.data
        ? await getApproverUserIdsForRule(serviceRole, rule.data)
        : [];

      if (approverIds.length > 0) {
        try {
          await trigger("notify", {
            event: NotificationEvent.ApprovalRequested,
            companyId,
            documentId: orderId,
            documentType: "purchaseOrder",
            recipient: { type: "users", userIds: approverIds },
            from: userId
          });
        } catch (e) {
          console.error("Failed to trigger approval notification", e);
        }
      }
    }

    await updatePurchaseOrderStatus(client, {
      id: orderId,
      status: "Needs Approval",
      assignee: undefined,
      updatedBy: userId
    });

    throw redirect(
      requestReferrer(request) ?? path.to.purchaseOrder(orderId),
      await flash(request, success("Purchase order submitted for approval"))
    );
  }

  // Check if we should update prices on purchase order finalize
  const companySettings = await getCompanySettings(serviceRole, companyId);
  if (
    companySettings.data?.purchasePriceUpdateTiming ===
    "Purchase Order Finalize"
  ) {
    const priceUpdate = await serviceRole.functions.invoke(
      "update-purchased-prices",
      {
        body: {
          purchaseOrderId: orderId,
          companyId,
          source: "purchaseOrder",
          updatePrices: true,
          updateLeadTimes: false
        }
      }
    );

    if (priceUpdate.error) {
      console.error("Failed to update purchased prices:", priceUpdate.error);
      // Don't fail the entire finalization, just log the error
    }
  }

  const acceptLanguage = request.headers.get("accept-language");
  const locales = parseAcceptLanguage(acceptLanguage, {
    validate: Intl.DateTimeFormat.supportedLocalesOf
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

    documentFilePath = `${companyId}/supplier-interaction/${purchaseOrder.data.supplierInteractionId}/${fileName}`;
    const companyPrivateBucket = getCompanyPrivateBucket(companyId);

    const documentFileUpload = await serviceRole.storage
      .from(companyPrivateBucket)
      .upload(documentFilePath, file, {
        cacheControl: `${12 * 60 * 60}`,
        contentType: "application/pdf",
        upsert: true
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
      companyId
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

  const validation = await validator(purchaseOrderFinalizeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { notification, supplierContact, cc: ccSelections } = validation.data;

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
          paymentTerms,
          buyer
        ] = await Promise.all([
          getCompany(serviceRole, companyId),
          getSupplierContact(serviceRole, supplierContact),
          getPurchaseOrder(serviceRole, orderId),
          getPurchaseOrderLines(serviceRole, orderId),
          getPurchaseOrderLocations(serviceRole, orderId),
          getPaymentTermsList(serviceRole, companyId),
          getUser(serviceRole, userId)
        ]);

        if (!supplier?.data?.contact)
          throw new Error("Failed to get supplier contact");
        if (!company.data) throw new Error("Failed to get company");
        if (!buyer.data) throw new Error("Failed to get user");
        if (!purchaseOrder.data)
          throw new Error("Failed to get purchase order");
        if (!purchaseOrderLocations.data)
          throw new Error("Failed to get purchase order locations");
        if (!paymentTerms.data) throw new Error("Failed to get payment terms");

        if (supplier.data.contact.email) {
          const emailTemplate = PurchaseOrderEmail({
            // @ts-expect-error TS2739 - TODO: fix type
            company: company.data,
            locale: locales?.[0] ?? "en-US",
            purchaseOrder: purchaseOrder.data,
            purchaseOrderLines: purchaseOrderLines.data ?? [],
            purchaseOrderLocations: purchaseOrderLocations.data,
            recipient: {
              email: supplier.data.contact.email,
              firstName: supplier.data.contact.firstName ?? undefined,
              lastName: supplier.data.contact.lastName ?? undefined
            },
            sender: {
              email: buyer.data.email,
              firstName: buyer.data.firstName,
              lastName: buyer.data.lastName
            },
            paymentTerms: paymentTerms.data
          });

          const html = await renderAsync(emailTemplate);
          const text = await renderAsync(emailTemplate, { plainText: true });

          const signedUrlResult = await createCompanyPrivateSignedUrl({
            companyId,
            requestedBucket: getCompanyPrivateBucket(companyId),
            objectPath: documentFilePath,
            expiresIn: 3600,
            createSignedUrl: async (physicalBucket, objectPath, expiresIn) => {
              const { data, error } = await serviceRole.storage
                .from(physicalBucket)
                .createSignedUrl(objectPath, expiresIn);

              return {
                signedUrl: data?.signedUrl ?? null,
                error: error ?? null
              };
            }
          });

          for (const bucketError of signedUrlResult.errors) {
            console.error(
              "Failed to create purchase order finalize attachment signed URL",
              {
                companyId,
                orderId,
                documentFilePath,
                physicalBucket: bucketError.physicalBucket,
                error: bucketError.error
              }
            );
          }

          await Promise.all([
            trigger("send-email", {
              to: [buyer.data.email, supplier.data.contact.email],
              cc: ccSelections?.length ? ccSelections : undefined,
              from: buyer.data.email,
              subject: `Purchase Order ${purchaseOrder.data.purchaseOrderId} from ${company.data.name}`,
              html,
              text,
              attachments: signedUrlResult.signedUrl
                ? [
                    {
                      path: signedUrlResult.signedUrl,
                      filename: fileName
                    }
                  ]
                : undefined,
              companyId
            })
          ]);
        }
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
    await flash(request, success("Purchase order finalized"))
  );
}
