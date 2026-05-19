import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
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

  const { receiptId } = params;
  if (!receiptId) throw new Error("Could not find receiptId");

  const [receipt, receiptLines, receiptLineTracking] = await Promise.all([
    getReceipt(receiptId),
    getReceiptLines(receiptId),
    getReceiptTracking(receiptId)
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

  return {
    receipt: receipt.data,
    receiptLines: receiptLines.data ?? [],
    receiptFiles: getReceiptFiles(receiptLineIds) ?? [],
    receiptLineTracking: receiptLineTracking.data ?? [],
    batchProperties: getBatchProperties(itemsWithBatchProperties) ?? [],
    companySettings: getCompanySettings(),
    itemShelfLife: await getShelfLifeForItems(trackedItemIds)
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
