// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { isUnaffectedByNavigation, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { DocumentPage, DocumentSidebar } from "~/components/DocumentPage";
import {
  getBatchProperties,
  getReceipt,
  getReceiptFiles,
  getReceiptLines,
  getReceiptRelatedItems,
  getReceiptTracking,
  getShelfLifeForItems
} from "~/modules/inventory";
import {
  ReceiptDocuments,
  ReceiptHeader
} from "~/modules/inventory/ui/Receipts";
import { getReceiptInspections } from "~/modules/quality";
import { getCompanySettings } from "~/modules/settings";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Receipts`, to: path.to.receipts },
    (data) => data?.receipt?.receiptId
  ),
  module: "inventory"
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { params: ["receiptId"] })
    ? false
    : args.defaultShouldRevalidate;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const serviceRole = await getCarbonServiceRole();

  const { receiptId } = params;
  if (!receiptId) throw new Error("Could not find receiptId");

  const [receipt, receiptLines, receiptLineTracking, receiptInspections] =
    await Promise.all([
      getReceipt(serviceRole, receiptId),
      getReceiptLines(serviceRole, receiptId),
      getReceiptTracking(serviceRole, receiptId, companyId),
      getReceiptInspections(serviceRole, receiptId, companyId)
    ]);

  if (receipt.error) {
    throw redirect(
      path.to.receipts,
      await flash(request, error(receipt.error, "Failed to load receipt"))
    );
  }

  if (receipt.data.companyId !== companyId) {
    throw redirect(path.to.receipts);
  }

  let receiptLineIds: string[] = [];
  let itemsWithBatchProperties: string[] = [];
  let trackedItemIds: string[] = [];

  if (receiptLines.data) {
    receiptLineIds = receiptLines.data.map((line) => line.id!).filter(Boolean);
    itemsWithBatchProperties = receiptLines.data
      .filter((line) => line && line.itemId && line.requiresBatchTracking)
      .map((line) => line.itemId)
      .filter((itemId) => itemId !== null);
    trackedItemIds = receiptLines.data
      .filter(
        (line) =>
          line?.itemId &&
          (line.requiresBatchTracking || line.requiresSerialTracking)
      )
      .map((line) => line.itemId)
      .filter((itemId) => itemId !== null) as string[];
  }

  let fixedAssetLines: {
    id: string;
    purchaseOrderLineId: string;
    assetId: string;
    assetName: string | null;
    assetReadableId: string | null;
    description: string | null;
    received: boolean;
    serialNumber: string | null;
  }[] = [];

  if (receipt.data.sourceDocument === "Purchase Order") {
    const faLineRecords = await serviceRole
      .from("receiptFixedAssetLine")
      .select(
        "id, purchaseOrderLineId, received, serialNumber, purchaseOrderLine:purchaseOrderLineId(assetId, description, fixedAsset:assetId(name, fixedAssetId, serialNumber))"
      )
      .eq("receiptId", receiptId)
      .eq("companyId", companyId);

    fixedAssetLines = (faLineRecords.data ?? [])
      .filter((row) => {
        const pol = row.purchaseOrderLine as any;
        return pol?.assetId;
      })
      .map((row) => {
        const pol = row.purchaseOrderLine as any;
        return {
          id: row.id,
          purchaseOrderLineId: row.purchaseOrderLineId,
          assetId: pol.assetId,
          assetName: pol.fixedAsset?.name ?? null,
          assetReadableId: pol.fixedAsset?.fixedAssetId ?? null,
          description: pol.description,
          received: row.received,
          serialNumber: row.serialNumber ?? pol.fixedAsset?.serialNumber ?? null
        };
      });
  }

  return {
    receipt: receipt.data,
    receiptLines: receiptLines.data ?? [],
    receiptInspections: receiptInspections.data ?? [],
    fixedAssetLines,
    receiptFiles: getReceiptFiles(serviceRole, companyId, receiptLineIds) ?? [],
    receiptLineTracking: receiptLineTracking.data ?? [],
    batchProperties:
      getBatchProperties(serviceRole, itemsWithBatchProperties, companyId) ??
      [],
    companySettings: getCompanySettings(serviceRole, companyId),
    itemShelfLife: await getShelfLifeForItems(serviceRole, trackedItemIds),
    relatedItems: getReceiptRelatedItems(
      client,
      companyId,
      receipt.data.supplierInteractionId,
      receipt.data.sourceDocument === "Sales Return Order"
        ? receipt.data.sourceDocumentId
        : null
    )
  };
}

export default function ReceiptRoute() {
  const { receipt } = useLoaderData<typeof loader>();

  return (
    <DocumentPage
      header={<ReceiptHeader />}
      sidebar={
        <DocumentSidebar
          documents={<ReceiptDocuments />}
          activity={{
            entityType: "receipt",
            entityId: receipt.id,
            refreshKey: `${receipt.updatedAt ?? ""}:${receipt.status}`
          }}
        />
      }
    >
      <Outlet />
    </DocumentPage>
  );
}
