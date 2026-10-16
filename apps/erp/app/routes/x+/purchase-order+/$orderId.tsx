// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  canApproveRequest,
  canCancelRequest,
  getLatestApprovalRequestForDocument
} from "@carbon/ee/approvals.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import { getPreferenceHeaders, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { FileObject } from "@supabase/storage-js";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { getCurrencyByCode } from "~/modules/accounting/accounting.service";
import { purchaseOrderApprovalValidator } from "~/modules/purchasing/purchasing.models";
import {
  getDefaultAttachmentsForPO,
  getPurchaseOrder,
  getPurchaseOrderDelivery,
  getPurchaseOrderLines,
  getSupplier,
  getSupplierInteraction,
  getSupplierInteractionDocuments
} from "~/modules/purchasing/purchasing.service";
import {
  PurchaseOrderExplorer,
  PurchaseOrderHeader,
  PurchaseOrderProperties
} from "~/modules/purchasing/ui/PurchaseOrder";
import { getCompanySettings } from "~/modules/settings/settings.service";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "purchase-order");

export const handle: Handle = {
  appBarSubtitle: msg`Purchase Order`,
  realtime: [
    { table: "purchaseOrder", column: "id", param: "orderId" },
    { table: "purchaseOrderLine", column: "purchaseOrderId", param: "orderId" },
    {
      // Receipts and invoices of this order share its supplier interaction
      // (`usePurchaseOrder`, `getSupplierInteraction`).
      table: "receipt",
      filter: ({ data }) =>
        data?.purchaseOrder?.supplierInteractionId
          ? `supplierInteractionId=eq.${data.purchaseOrder.supplierInteractionId}`
          : undefined
    },
    {
      table: "purchaseInvoice",
      filter: ({ data }) =>
        data?.purchaseOrder?.supplierInteractionId
          ? `supplierInteractionId=eq.${data.purchaseOrder.supplierInteractionId}`
          : undefined
    }
  ],
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Orders`, to: path.to.purchaseOrders },
    (data) => data?.purchaseOrder?.purchaseOrderId
  ),
  module: "purchasing"
};

export async function action(args: ActionFunctionArgs) {
  const input = await validator(purchaseOrderApprovalValidator).request(args, {
    params: ["orderId"]
  });
  if ("invalid" in input) return input.invalid;
  const { orderId } = input.params;
  const api = await carbon(args.request);
  const result = await api.purchasing.decidePurchaseOrderApproval({
    ...input.data,
    purchaseOrderId: orderId,
    locale: getPreferenceHeaders(args.request).locale
  });
  return respond(args.request, result).redirect(
    path.to.purchaseOrder(orderId),
    {
      message: `Approval request ${input.data.decision.toLowerCase()} successfully`
    }
  );
}

const toAttachments = (docs: FileObject[], folder: string) =>
  docs.map((d) => ({
    source: "po" as const,
    name: d.name,
    size:
      (d.metadata as { size?: number } | null | undefined)?.size != null
        ? Math.round(((d.metadata as { size?: number }).size as number) / 1024)
        : null,
    path: `${folder}/${d.name}`
  }));

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
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
  const [supplier, interaction, approvalRequest, companySettings] =
    await Promise.all([
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
        : Promise.resolve({ data: null, error: null }),
      getCompanySettings(serviceRole, companyId)
    ]);

  const defaultCc = supplier?.data?.defaultCc?.length
    ? supplier.data.defaultCc
    : (companySettings.data?.defaultSupplierCc ?? []);

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

  const itemIds = Array.from(
    new Set(
      (lines.data ?? []).map((l) => l.itemId).filter((id): id is string => !!id)
    )
  );
  const supplierInteractionId = purchaseOrder.data?.supplierInteractionId;
  // One listing feeds both the documents panel and the attachment list, and
  // neither holds up the page.
  const files = supplierInteractionId
    ? getSupplierInteractionDocuments(
        serviceRole,
        companyId,
        supplierInteractionId
      )
    : Promise.resolve([]);
  const resolvedAttachments = Promise.all([
    getDefaultAttachmentsForPO(serviceRole, {
      companyId,
      supplierId: purchaseOrder.data?.supplierId ?? null,
      itemIds
    }),
    files
  ])
    .then(([defaults, adHocDocs]) => [
      ...defaults,
      ...toAttachments(
        adHocDocs,
        `${companyId}/supplier-interaction/${supplierInteractionId}`
      )
    ])
    .catch((error) => {
      logger.error("Failed to resolve purchase order attachments", {
        companyId,
        orderId,
        error
      });
      return [];
    });
  const currency = purchaseOrder.data?.currencyCode
    ? await getCurrencyByCode(
        serviceRole,
        companyGroupId,
        purchaseOrder.data.currencyCode
      )
    : null;

  return {
    purchaseOrder: purchaseOrder.data,
    purchaseOrderDelivery: purchaseOrderDelivery.data,
    currency: currency?.data ?? null,
    lines: lines.data ?? [],
    files,
    interaction: interaction?.data,
    supplier: supplier?.data ?? null,
    approvalRequest: approvalRequest.data,
    canApprove,
    canReopen,
    canDelete,
    defaultCc,
    resolvedAttachments
  };
}

export default function PurchaseOrderRoute() {
  const params = useParams();
  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
        <PurchaseOrderHeader />
        <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={<PurchaseOrderExplorer />}
              content={
                <div className="bg-card h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={4} className="p-4">
                    <RecordOutlet />
                  </VStack>
                </div>
              }
              properties={<PurchaseOrderProperties key={orderId} />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
