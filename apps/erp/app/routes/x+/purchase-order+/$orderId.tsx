import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { PurchaseOrderEmail } from "@carbon/documents/email";
import { validationError, validator } from "@carbon/form";
import type { sendEmailResendTask } from "@carbon/jobs/trigger/send-email-resend";
import { NotificationEvent } from "@carbon/notifications";
import { VStack } from "@carbon/react";
import { renderAsync } from "@react-email/components";
import { FunctionRegion } from "@supabase/supabase-js";
import { tasks } from "@trigger.dev/sdk";
import { parseAcceptLanguage } from "intl-parse-accept-language";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { getPaymentTermsList } from "~/modules/accounting";
import { upsertDocument } from "~/modules/documents";
import {
  getPurchaseOrder,
  getPurchaseOrderDelivery,
  getPurchaseOrderLines,
  getPurchaseOrderLocations,
  getSupplier,
  getSupplierContact,
  getSupplierInteraction,
  getSupplierInteractionDocuments,
  purchaseOrderApprovalValidator
} from "~/modules/purchasing";
import {
  PurchaseOrderExplorer,
  PurchaseOrderHeader,
  PurchaseOrderProperties
} from "~/modules/purchasing/ui/PurchaseOrder";
import { getCompany, getCompanySettings } from "~/modules/settings";
import {
  approveRequest,
  canApproveRequest,
  canCancelRequest,
  getLatestApprovalRequestForDocument,
  rejectRequest
} from "~/modules/shared";
import { getUser } from "~/modules/users/users.server";
import { loader as pdfLoader } from "~/routes/file+/purchase-order+/$orderId[.]pdf";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

export const handle: Handle = {
  breadcrumb: "Orders",
  to: path.to.purchaseOrders,
  module: "purchasing"
};

export async function action(args: ActionFunctionArgs) {
  const { request, params } = args;
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const validation = await validator(purchaseOrderApprovalValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { approvalRequestId, decision, notification, supplierContact } =
    validation.data;

  const serviceRole = getCarbonServiceRole();

  // Verify user can approve this request
  const approvalRequest = await getLatestApprovalRequestForDocument(
    serviceRole,
    "purchaseOrder",
    orderId
  );

  if (!approvalRequest.data || approvalRequest.data.id !== approvalRequestId) {
    throw redirect(
      path.to.purchaseOrder(orderId),
      await flash(request, error(null, "Approval request not found"))
    );
  }

  const canApproveResult = await canApproveRequest(
    serviceRole,
    {
      amount: approvalRequest.data.amount,
      documentType: approvalRequest.data.documentType,
      companyId: approvalRequest.data.companyId
    },
    userId
  );

  if (!canApproveResult) {
    throw redirect(
      path.to.purchaseOrder(orderId),
      await flash(
        request,
        error(null, "You do not have permission to approve this request")
      )
    );
  }

  // Process approval decision
  const result =
    decision === "Approved"
      ? await approveRequest(serviceRole, approvalRequestId, userId)
      : await rejectRequest(serviceRole, approvalRequestId, userId);

  if (result.error) {
    throw redirect(
      path.to.purchaseOrder(orderId),
      await flash(
        request,
        error(
          result.error,
          result.error?.message ?? "Failed to process approval decision"
        )
      )
    );
  }

  const requestedBy = approvalRequest.data?.requestedBy;
  if (requestedBy && requestedBy !== userId) {
    try {
      await tasks.trigger("notify", {
        event:
          decision === "Approved"
            ? NotificationEvent.ApprovalApproved
            : NotificationEvent.ApprovalRejected,
        companyId,
        documentId: orderId,
        documentType: "purchaseOrder",
        recipient: { type: "user", userId: requestedBy },
        from: userId
      });
    } catch (e) {
      console.error("Failed to trigger approval decision notification", e);
    }
  }

  // If approved, handle post-approval tasks: PDF generation, document creation, email, price updates
  if (decision === "Approved") {
    const purchaseOrder = await getPurchaseOrder(serviceRole, orderId);
    if (purchaseOrder.data) {
      let file: ArrayBuffer | undefined;
      let fileName: string | undefined;

      // Generate PDF and create document
      try {
        const pdf = await pdfLoader(args);
        if (pdf.headers.get("content-type") === "application/pdf") {
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
              upsert: true
            });

          if (!documentFileUpload.error) {
            await upsertDocument(serviceRole, {
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
          }
        }
      } catch (err) {
        // Log but don't fail the approval - PDF generation is not critical
        console.error("Failed to generate PDF after approval:", err);
      }

      // Send email notification if requested
      if (notification === "Email" && supplierContact && file && fileName) {
        try {
          const acceptLanguage = request.headers.get("accept-language");
          const locales = parseAcceptLanguage(acceptLanguage, {
            validate: Intl.DateTimeFormat.supportedLocalesOf
          });

          const [
            company,
            supplier,
            purchaseOrderLines,
            purchaseOrderLocations,
            paymentTerms,
            buyer
          ] = await Promise.all([
            getCompany(serviceRole, companyId),
            getSupplierContact(serviceRole, supplierContact),
            getPurchaseOrderLines(serviceRole, orderId),
            getPurchaseOrderLocations(serviceRole, orderId),
            getPaymentTermsList(serviceRole, companyId),
            getUser(serviceRole, userId)
          ]);

          const supplierEmail = supplier?.data?.contact?.email;
          if (
            supplierEmail &&
            company.data &&
            buyer.data &&
            purchaseOrderLocations.data &&
            paymentTerms.data
          ) {
            const emailTemplate = PurchaseOrderEmail({
              company: company.data,
              locale: locales?.[0] ?? "en-US",
              purchaseOrder: purchaseOrder.data,
              purchaseOrderLines: purchaseOrderLines.data ?? [],
              purchaseOrderLocations: purchaseOrderLocations.data,
              recipient: {
                email: supplierEmail,
                firstName: supplier.data?.contact?.firstName ?? undefined,
                lastName: supplier.data?.contact?.lastName ?? undefined
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

            await tasks.trigger<typeof sendEmailResendTask>(
              "send-email-resend",
              {
                to: [buyer.data.email, supplierEmail],
                from: buyer.data.email,
                subject: `Purchase Order ${purchaseOrder.data.purchaseOrderId} from ${company.data.name}`,
                html,
                text,
                attachments: [
                  {
                    content: Buffer.from(file).toString("base64"),
                    filename: fileName
                  }
                ],
                companyId
              }
            );
          }
        } catch (err) {
          console.error("Failed to send email after approval:", err);
        }
      }

      // Check if we should update prices on purchase order approval
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
              source: "purchaseOrder"
            },
            region: FunctionRegion.UsEast1
          }
        );

        if (priceUpdate.error) {
          console.error(
            "Failed to update purchased prices:",
            priceUpdate.error
          );
        }
      }
    }
  }

  throw redirect(
    path.to.purchaseOrder(orderId),
    await flash(
      request,
      success(`Approval request ${decision.toLowerCase()} successfully`)
    )
  );
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "purchasing",
    bypassRls: true
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const [purchaseOrder, lines, purchaseOrderDelivery] = await Promise.all([
    getPurchaseOrder(client, orderId),
    getPurchaseOrderLines(client, orderId),
    getPurchaseOrderDelivery(client, orderId)
  ]);

  if (purchaseOrder.data?.companyId !== companyId) {
    throw redirect(
      path.to.purchaseOrders,
      await flash(
        request,
        error("You are not authorized to view this purchase order")
      )
    );
  }

  if (purchaseOrder.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(purchaseOrder.error, "Failed to load purchaseOrder")
      )
    );
  }

  if (companyId !== purchaseOrder.data?.companyId) {
    throw redirect(path.to.purchaseOrders);
  }

  const serviceRole = getCarbonServiceRole();
  const [supplier, interaction, approvalRequest] = await Promise.all([
    purchaseOrder.data?.supplierId
      ? getSupplier(client, purchaseOrder.data.supplierId)
      : null,
    getSupplierInteraction(client, purchaseOrder.data.supplierInteractionId),
    // Only fetch approval request if status is "Needs Approval"
    purchaseOrder.data?.status === "Needs Approval"
      ? getLatestApprovalRequestForDocument(
          serviceRole,
          "purchaseOrder",
          orderId
        )
      : Promise.resolve({ data: null, error: null })
  ]);

  // Check if user can approve the request
  let canApprove = false;
  let canReopen = true; // Default to true (no approval request = can reopen)
  let canDelete = true; // Default to true (no approval request = can delete)

  if (
    approvalRequest.data &&
    purchaseOrder.data?.status === "Needs Approval" &&
    approvalRequest.data.status === "Pending" &&
    approvalRequest.data.requestedBy
  ) {
    const requestedBy = approvalRequest.data.requestedBy;
    const status = approvalRequest.data.status;

    canApprove = await canApproveRequest(
      serviceRole,
      {
        amount: approvalRequest.data.amount,
        documentType: approvalRequest.data.documentType,
        companyId: approvalRequest.data.companyId
      },
      userId
    );

    // Check if user can reopen: must be requester OR approver
    const isRequester = canCancelRequest(
      {
        requestedBy,
        status
      },
      userId
    );
    const isApprover = canApprove;
    canReopen = isRequester || isApprover;

    // Check if user can delete: only requester can delete POs in "Needs Approval"
    // Approvers should reject instead, normal users have no permission
    canDelete = isRequester;
  }

  return {
    purchaseOrder: purchaseOrder.data,
    purchaseOrderDelivery: purchaseOrderDelivery.data,
    lines: lines.data ?? [],
    files: getSupplierInteractionDocuments(
      client,
      companyId,
      purchaseOrder.data.supplierInteractionId!
    ),
    interaction: interaction?.data,
    supplier: supplier?.data ?? null,
    approvalRequest: approvalRequest.data,
    canApprove,
    canReopen,
    canDelete
  };
}

export default function PurchaseOrderRoute() {
  const params = useParams();
  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <PurchaseOrderHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={<PurchaseOrderExplorer />}
              content={
                <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={2} className="p-2">
                    <Outlet />
                  </VStack>
                </div>
              }
              properties={<PurchaseOrderProperties />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
