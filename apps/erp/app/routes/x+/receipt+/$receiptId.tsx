import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useParams } from "react-router";
import {
  getBatchProperties,
  getReceipt,
  getReceiptFiles,
  getReceiptLines,
  getReceiptTracking,
  getShelfLifeForItems
} from "~/modules/inventory";
import { getCompanySettings } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Receipts`,
  to: path.to.receipts
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const serviceRole = await getCarbonServiceRole();

  const { receiptId } = params;
  if (!receiptId) throw new Error("Could not find receiptId");

  const [receipt, receiptLines, receiptLineTracking] = await Promise.all([
    getReceipt(serviceRole, receiptId),
    getReceiptLines(serviceRole, receiptId),
    getReceiptTracking(serviceRole, receiptId, companyId)
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
      .eq("receiptId", receiptId);

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
    fixedAssetLines,
    receiptFiles: getReceiptFiles(serviceRole, companyId, receiptLineIds) ?? [],
    receiptLineTracking: receiptLineTracking.data ?? [],
    batchProperties:
      getBatchProperties(serviceRole, itemsWithBatchProperties, companyId) ??
      [],
    companySettings: getCompanySettings(serviceRole, companyId),
    itemShelfLife: await getShelfLifeForItems(serviceRole, trackedItemIds)
  };
}

export default function ReceiptRoute() {
  const params = useParams();
  const { receiptId } = params;
  if (!receiptId) throw new Error("Could not find receiptId");

  return (
    <div className="flex h-[calc(100dvh-49px)] overflow-y-auto scrollbar-hide w-full">
      <div className="h-full p-4 w-full max-w-5xl mx-auto">
        <div className="flex flex-col gap-2 pb-16 w-full">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
