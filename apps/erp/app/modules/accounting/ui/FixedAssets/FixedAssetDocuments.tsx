// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type { ComponentProps, ReactNode } from "react";
import { Suspense } from "react";
import {
  LuBookOpen,
  LuCirclePlay,
  LuClock,
  LuContainer,
  LuCreditCard,
  LuHandCoins,
  LuKeyRound,
  LuQrCode,
  LuShoppingCart,
  LuSquareUser,
  LuTruck
} from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import { Await, useParams } from "react-router";
import { Empty, MethodItemTypeIcon } from "~/components";
import {
  RelatedDocument,
  RelatedDocumentGroup,
  RelatedDocumentSkeleton
} from "~/components/DocumentPage";
import { usePermissions, useRouteData } from "~/hooks";
import type {
  AssetDepreciationHistoryItem,
  FixedAsset,
  FixedAssetRelatedItems
} from "~/modules/accounting";
import ReceiptStatus from "~/modules/inventory/ui/Receipts/ReceiptStatus";
import ShipmentStatus from "~/modules/inventory/ui/Shipments/ShipmentStatus";
import PurchaseInvoicingStatus from "~/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoicingStatus";
import SalesInvoiceStatus from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceStatus";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import JobStatus from "~/modules/production/ui/Jobs/JobStatus";
import PurchasingStatus from "~/modules/purchasing/ui/PurchaseOrder/PurchasingStatus";
import RentalStatus from "~/modules/sales/ui/Rentals/RentalStatus";
import SalesStatus from "~/modules/sales/ui/SalesOrder/SalesStatus";
import type { ItemType } from "~/modules/shared";
import { itemType } from "~/modules/shared";
import { useCustomers, useSuppliers } from "~/stores";
import { path } from "~/utils/path";
import DepreciationRunStatus from "./DepreciationRunStatus";

type DepreciationRunLink = {
  id: string;
  depreciationRunId: string;
  status: string | null;
};

/** One row per depreciation run, newest first (the loader's order). */
function getDepreciationRuns(history: AssetDepreciationHistoryItem[]) {
  const runs = new Map<string, DepreciationRunLink>();
  for (const line of history) {
    const run = line.depreciationRun as DepreciationRunLink | null;
    if (run?.id && !runs.has(run.id)) runs.set(run.id, run);
  }
  return [...runs.values()];
}

function isLinkableItemType(type: string): type is ItemType {
  return (itemType as readonly string[]).includes(type);
}

/**
 * The documents around a fixed asset: who it was bought from and sold or
 * rented to, the item and serial it is, the jobs that built it, the purchase,
 * sales and rental documents with a line on it, its depreciation runs and its
 * disposal journal.
 */
const FixedAssetDocuments = () => {
  const { fixedAssetId } = useParams();
  if (!fixedAssetId) throw new Error("fixedAssetId not found");

  const routeData = useRouteData<{
    asset: FixedAsset;
    depreciationHistory: AssetDepreciationHistoryItem[];
    relatedItems?: Promise<FixedAssetRelatedItems>;
  }>(path.to.fixedAsset(fixedAssetId));

  if (!routeData?.asset) return null;
  const depreciationRuns = getDepreciationRuns(
    routeData.depreciationHistory ?? []
  );

  return (
    <Suspense
      fallback={
        <RelatedDocumentGroup>
          <RelatedDocumentSkeleton />
          <RelatedDocumentSkeleton />
        </RelatedDocumentGroup>
      }
    >
      <Await resolve={routeData.relatedItems}>
        {(related) => (
          <FixedAssetDocumentList
            related={related ?? null}
            depreciationRuns={depreciationRuns}
          />
        )}
      </Await>
    </Suspense>
  );
};

function FixedAssetDocumentList({
  related,
  depreciationRuns
}: {
  related: FixedAssetRelatedItems | null;
  depreciationRuns: DepreciationRunLink[];
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const [suppliers] = useSuppliers();
  const [customers] = useCustomers();

  const canViewPurchasing = permissions.can("view", "purchasing");
  const canViewSales = permissions.can("view", "sales");
  const canViewInvoicing = permissions.can("view", "invoicing");
  const canViewInventory = permissions.can("view", "inventory");
  const canViewProduction = permissions.can("view", "production");
  const canViewParts = permissions.can("view", "parts");
  const canViewAccounting = permissions.can("view", "accounting");

  const purchaseOrders = canViewPurchasing
    ? (related?.purchaseOrders ?? [])
    : [];
  const receipts = canViewInventory ? (related?.receipts ?? []) : [];
  const purchaseInvoices = canViewInvoicing
    ? (related?.purchaseInvoices ?? [])
    : [];
  const rentalAgreements = canViewSales
    ? (related?.rentalAgreements ?? [])
    : [];
  const salesOrders = canViewSales ? (related?.salesOrders ?? []) : [];
  const shipments = canViewInventory ? (related?.shipments ?? []) : [];
  const salesInvoices = canViewInvoicing ? (related?.salesInvoices ?? []) : [];
  const jobs = canViewProduction ? (related?.jobs ?? []) : [];
  const runs = canViewAccounting ? depreciationRuns : [];

  // Who it was bought from, then who it was sold or rented to.
  const supplierIds = canViewPurchasing
    ? [
        ...new Set(
          [
            ...(related?.purchaseOrders ?? []),
            ...(related?.purchaseInvoices ?? [])
          ]
            .map((document) => document.supplierId)
            .filter((id): id is string => Boolean(id))
        )
      ]
    : [];
  const customerIds = canViewSales
    ? [
        ...new Set(
          [
            ...(related?.salesOrders ?? []),
            ...(related?.rentalAgreements ?? []),
            ...(related?.salesInvoices ?? [])
          ]
            .map((document) => document.customerId)
            .filter((id): id is string => Boolean(id))
        )
      ]
    : [];
  const parties: {
    id: string;
    to: string;
    icon: ReactNode;
    name: string;
    label: string;
  }[] = [
    ...supplierIds.flatMap((id) => {
      const supplier = suppliers.find((s) => s.id === id);
      return supplier
        ? [
            {
              id,
              to: path.to.supplier(id),
              icon: <LuContainer />,
              name: supplier.name,
              label: t`Supplier`
            }
          ]
        : [];
    }),
    ...customerIds.flatMap((id) => {
      const customer = customers.find((c) => c.id === id);
      return customer
        ? [
            {
              id,
              to: path.to.customer(id),
              icon: <LuSquareUser />,
              name: customer.name,
              label: t`Customer`
            }
          ]
        : [];
    })
  ];

  const item = canViewParts ? (related?.item ?? null) : null;
  const linkType = item && isLinkableItemType(item.type) ? item.type : null;
  const trackedEntity = canViewInventory
    ? (related?.trackedEntity ?? null)
    : null;
  const disposalJournal = canViewAccounting
    ? (related?.disposalJournal ?? null)
    : null;

  const hasRows =
    parties.length > 0 ||
    Boolean(item && linkType) ||
    Boolean(trackedEntity) ||
    jobs.length > 0 ||
    purchaseOrders.length > 0 ||
    receipts.length > 0 ||
    purchaseInvoices.length > 0 ||
    rentalAgreements.length > 0 ||
    salesOrders.length > 0 ||
    shipments.length > 0 ||
    salesInvoices.length > 0 ||
    runs.length > 0 ||
    Boolean(disposalJournal);

  if (!hasRows) return <Empty className="py-12" />;

  return (
    <RelatedDocumentGroup>
      {parties.map((party) => (
        <RelatedDocument
          key={party.id}
          to={party.to}
          icon={party.icon}
          title={party.name}
          description={party.label}
        />
      ))}
      {item && linkType && (
        <RelatedDocument
          to={getLinkToItemDetails(linkType, item.id)}
          icon={<MethodItemTypeIcon type={linkType} />}
          title={item.readableIdWithRevision ?? item.name}
          description={t`Item`}
        />
      )}
      {trackedEntity && (
        <RelatedDocument
          to={`${path.to.traceabilityGraph}?trackedEntityId=${trackedEntity.id}`}
          icon={<LuQrCode />}
          title={trackedEntity.readableId ?? trackedEntity.id}
          description={t`Serial Number`}
        />
      )}
      {jobs.map((job) => (
        <RelatedDocument
          key={job.id}
          to={path.to.job(job.id)}
          icon={<LuCirclePlay />}
          title={job.jobId}
          description={t`Job`}
          status={<JobStatus status={job.status} />}
        />
      ))}
      {purchaseOrders.map((order) => (
        <RelatedDocument
          key={order.id}
          to={path.to.purchaseOrderDetails(order.id)}
          icon={<LuShoppingCart />}
          title={order.purchaseOrderId}
          description={t`Purchase Order`}
          status={<PurchasingStatus status={order.status} />}
        />
      ))}
      {receipts.map((receipt) => (
        <RelatedDocument
          key={receipt.id}
          to={path.to.receipt(receipt.id)}
          icon={<LuHandCoins />}
          title={receipt.receiptId}
          description={t`Receipt`}
          status={<ReceiptStatus status={receipt.status} />}
        />
      ))}
      {purchaseInvoices.map((invoice) => (
        <RelatedDocument
          key={invoice.id}
          to={path.to.purchaseInvoice(invoice.id)}
          icon={<LuCreditCard />}
          title={invoice.invoiceId}
          description={t`Purchase Invoice`}
          status={
            <PurchaseInvoicingStatus
              status={
                // The app's status list has no "Return"; render it unstyled.
                invoice.status as ComponentProps<
                  typeof PurchaseInvoicingStatus
                >["status"]
              }
            />
          }
        />
      ))}
      {runs.map((run) => (
        <RelatedDocument
          key={run.id}
          to={path.to.depreciationRun(run.id)}
          icon={<LuClock />}
          title={run.depreciationRunId}
          description={t`Depreciation Run`}
          status={<DepreciationRunStatus status={run.status} />}
        />
      ))}
      {rentalAgreements.map((agreement) => (
        <RelatedDocument
          key={agreement.id}
          to={path.to.rentalAgreement(agreement.id)}
          icon={<LuKeyRound />}
          title={agreement.rentalAgreementId}
          description={t`Rental Agreement`}
          status={<RentalStatus status={agreement.status} />}
        />
      ))}
      {salesOrders.map((order) => (
        <RelatedDocument
          key={order.id}
          to={path.to.salesOrderDetails(order.id)}
          icon={<RiProgress8Line />}
          title={order.salesOrderId}
          description={t`Sales Order`}
          status={<SalesStatus status={order.status} />}
        />
      ))}
      {shipments.map((shipment) => (
        <RelatedDocument
          key={shipment.id}
          to={path.to.shipment(shipment.id)}
          icon={<LuTruck />}
          title={shipment.shipmentId}
          description={t`Shipment`}
          status={
            <ShipmentStatus
              status={shipment.status}
              invoiced={shipment.invoiced}
            />
          }
        />
      ))}
      {salesInvoices.map((invoice) => (
        <RelatedDocument
          key={invoice.id}
          to={path.to.salesInvoice(invoice.id)}
          icon={<LuCreditCard />}
          title={invoice.invoiceId}
          description={t`Sales Invoice`}
          status={<SalesInvoiceStatus status={invoice.status} />}
        />
      ))}
      {disposalJournal && (
        <RelatedDocument
          to={path.to.journalEntry(disposalJournal.id)}
          icon={<LuBookOpen />}
          title={disposalJournal.journalEntryId}
          description={t`Disposal Journal Entry`}
        />
      )}
    </RelatedDocumentGroup>
  );
}

export default FixedAssetDocuments;
