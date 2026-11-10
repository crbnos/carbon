// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { DocumentPage, DocumentSidebar } from "~/components/DocumentPage";
import {
  getBatchProperties,
  getReceipt,
  getReceiptFiles,
  getReceiptLines,
  getReceiptPutAwayLines,
  getReceiptRelatedItems,
  getRentalReceiptLines,
  getShelfLifeForItems,
  receiptLinesOpeningLots
} from "~/modules/inventory/inventory.service";
import { getReceiptTracking } from "~/modules/inventory/inventory.utils";
import type { RentalReceiptLine } from "~/modules/inventory/types";
import {
  ReceiptDocuments,
  ReceiptHeader
} from "~/modules/inventory/ui/Receipts";
import { getReceiptInspections } from "~/modules/quality/quality.service";
import { getCompanySettings } from "~/modules/settings/settings.service";
import { getDatabaseClient } from "~/services/database.server";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { recordMeta } from "~/utils/meta";
import { path } from "~/utils/path";

const logger = getLogger("erp", "receipt");

export const handle: Handle = {
  realtime: [
    { table: "receipt", column: "id", param: "receiptId" },
    { table: "receiptLine", column: "receiptId", param: "receiptId" }
  ],
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Receipts`, to: path.to.receipts },
    (data) => data?.receipt?.receiptId
  ),
  module: "inventory"
};

export const meta: MetaFunction<typeof loader> = ({ data }) =>
  recordMeta(data?.receipt?.receiptId, "Receipt");

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
  let trackedItemIds: string[] = [];

  if (receiptLines.data) {
    receiptLineIds = receiptLines.data.map((line) => line.id!).filter(Boolean);
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
        "id, purchaseOrderLineId, received, serialNumber, purchaseOrderLine!receiptFixedAssetLine_purchaseOrderLineId_fkey(assetId, description, fixedAsset!purchaseOrderLine_assetId_fkey(name, fixedAssetId, serialNumber))"
      )
      .eq("receiptId", receiptId)
      .eq("companyId", companyId)
      .not("purchaseOrderLineId", "is", null);

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

  // Only a purchase receipt opens inspection lots. Once posted, the lots
  // themselves (receiptInspections) say which lines were inspected.
  const receiptLinesToMark = (receiptLines.data ?? []).flatMap((line) =>
    line.itemId && line.id
      ? [{ id: line.id, itemId: line.itemId, lineId: line.lineId }]
      : []
  );
  const isPosted = receipt.data.status === "Posted";
  // The marks only inform: a failed lookup leaves them off rather than
  // failing the receipt, but it must not pass silently for "none needed".
  const [putAwayLines, putAwayTransfers, linesOpeningLots] = await Promise.all([
    isPosted &&
    !["Not Required", "Put Away"].includes(receipt.data.inspectionStatus)
      ? getReceiptPutAwayLines(getDatabaseClient(), companyId, receiptId).catch(
          (putAwayError: unknown) => {
            logger.error("Failed to load the receipt's putaway lines", {
              companyId,
              receiptId,
              error: putAwayError
            });
            return [];
          }
        )
      : Promise.resolve([]),
    serviceRole
      .from("stockTransfer")
      .select("id, stockTransferId, status")
      .eq("receiptId", receiptId)
      .eq("companyId", companyId)
      .order("createdAt"),
    receipt.data.sourceDocument === "Purchase Order" &&
    receipt.data.status !== "Posted" &&
    receipt.data.status !== "Voided"
      ? receiptLinesOpeningLots(getDatabaseClient(), companyId, {
          purchaseOrderId: receipt.data.sourceDocumentId,
          lines: receiptLinesToMark
        })
          .then((lines) => {
            if (lines === null) {
              logger.warn(
                "A line's project cannot take the charge: no inspection marks",
                { companyId, receiptId }
              );
            }
            return lines;
          })
          .catch((error: unknown) => {
            logger.error("Failed to load the receipt's inspected lines", {
              companyId,
              receiptId,
              error
            });
            return null;
          })
      : Promise.resolve([])
  ]);
  if (putAwayTransfers.error) {
    logger.error("Failed to load the receipt's putaway state", {
      companyId,
      receiptId,
      error: putAwayTransfers.error
    });
  }

  let rentalLines: RentalReceiptLine[] = [];

  if (receipt.data.sourceDocument === "Rental Agreement") {
    // Service role: rentalAgreementLine needs sales_view, which an inventory
    // user may not hold.
    const rentalLineRecords = await getRentalReceiptLines(
      serviceRole,
      receiptId,
      companyId
    );
    if (rentalLineRecords.error) {
      throw redirect(
        path.to.receipts,
        await flash(
          request,
          error(rentalLineRecords.error, "Failed to load the rental units")
        )
      );
    }

    rentalLines = (rentalLineRecords.data ?? []).map((row) => {
      // The read filters out rows with no rental line.
      const line = row.rentalAgreementLine!;
      return {
        id: row.id,
        rentalAgreementLineId: row.rentalAgreementLineId!,
        received: row.received,
        meter: row.meter === null ? null : Number(row.meter),
        notes: row.notes,
        takeOutOfService: row.takeOutOfService,
        outOfServiceReason: row.outOfServiceReason,
        // A CHECK constraint holds the column to these two values.
        residualDestination:
          row.residualDestination as RentalReceiptLine["residualDestination"],
        lessorClassification: line.lessorClassification ?? null,
        unitName: line.fixedAsset?.name ?? line.item?.name ?? "Rental unit",
        thumbnailPath: line.item?.thumbnailPath ?? null,
        itemType: line.item?.type ?? null,
        assetReadableId: line.fixedAsset?.fixedAssetId ?? null,
        serialNumber:
          line.fixedAsset?.serialNumber ??
          line.trackedEntity?.readableId ??
          null,
        lineStatus: line.status
      };
    });
    // By unit, like ordinary lines by part number, so the list holds still.
    rentalLines.sort((a, b) =>
      (a.assetReadableId ?? a.unitName).localeCompare(
        b.assetReadableId ?? b.unitName
      )
    );
  }

  return {
    receipt: receipt.data,
    receiptLines: receiptLines.data ?? [],
    receiptInspections: receiptInspections.data ?? [],
    inspectedLineIds: (linesOpeningLots ?? []).map((line) => line.id),
    heldLineIds: (linesOpeningLots ?? [])
      .filter((line) => line.holdsStock)
      .map((line) => line.id),
    putAwayReadyCount: putAwayLines.length,
    putAwayTransfers: putAwayTransfers.data ?? [],
    fixedAssetLines,
    rentalLines,
    receiptFiles: getReceiptFiles(serviceRole, companyId, receiptLineIds) ?? [],
    receiptLineTracking: receiptLineTracking.data ?? [],
    batchProperties:
      getBatchProperties(serviceRole, trackedItemIds, companyId) ?? [],
    companySettings: getCompanySettings(serviceRole, companyId),
    itemShelfLife: await getShelfLifeForItems(serviceRole, trackedItemIds),
    relatedItems: getReceiptRelatedItems(
      client,
      companyId,
      receipt.data.supplierInteractionId,
      receipt.data.sourceDocument === "Sales Return Order"
        ? receipt.data.sourceDocumentId
        : null,
      receipt.data.sourceDocument === "Sales Return Order"
        ? (receiptLines.data ?? []).flatMap((line) =>
            line.lineId ? [line.lineId] : []
          )
        : []
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
      <RecordOutlet />
    </DocumentPage>
  );
}
