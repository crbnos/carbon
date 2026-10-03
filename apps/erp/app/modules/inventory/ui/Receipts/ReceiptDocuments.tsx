// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Suspense } from "react";
import {
  LuClipboardCheck,
  LuContainer,
  LuCreditCard,
  LuShoppingCart,
  LuSquareUser,
  LuTruck,
  LuUndo2
} from "react-icons/lu";
import { Await, useParams } from "react-router";
import { Empty } from "~/components";
import DocumentIcon from "~/components/DocumentIcon";
import {
  RelatedDocument,
  RelatedDocumentGroup,
  RelatedDocumentSkeleton
} from "~/components/DocumentPage";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type { Receipt, ReceiptLine } from "~/modules/inventory";
import type { purchaseInvoiceStatusType } from "~/modules/invoicing";
import PurchaseInvoicingStatus from "~/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoicingStatus";
import { InspectionStatus } from "~/modules/quality/ui/Inspections/InspectionStatus";
import { getDocumentType } from "~/modules/shared";
import { useCustomers, useSuppliers } from "~/stores";
import type { StorageItem } from "~/types";
import { path } from "~/utils/path";

type RelatedItems = {
  invoices: {
    id: string;
    invoiceId: string;
    status: (typeof purchaseInvoiceStatusType)[number];
  }[];
  customerId: string | null;
};

type ReceiptInspection = {
  id: string;
  inspectionId: string;
  itemReadableId: string | null;
  status: string;
};

type DocumentLink = {
  to: string;
  icon: ReactNode;
  label: string;
};

/** Where the receipt's source document lives, when the user may open it. */
function useSourceDocument(receipt?: Receipt): DocumentLink | null {
  const { t } = useLingui();
  const permissions = usePermissions();
  const id = receipt?.sourceDocumentId;
  if (!receipt || !id || !receipt.sourceDocumentReadableId) return null;

  switch (receipt.sourceDocument) {
    case "Purchase Order":
      return permissions.can("view", "purchasing")
        ? {
            to: path.to.purchaseOrderDetails(id),
            icon: <LuShoppingCart />,
            label: t`Purchase Order`
          }
        : null;
    case "Purchase Invoice":
      return permissions.can("view", "invoicing")
        ? {
            to: path.to.purchaseInvoice(id),
            icon: <LuCreditCard />,
            label: t`Purchase Invoice`
          }
        : null;
    case "Inbound Transfer":
      return permissions.can("view", "inventory")
        ? {
            to: path.to.warehouseTransferDetails(id),
            icon: <LuTruck />,
            label: t`Warehouse Transfer`
          }
        : null;
    case "Sales Return Order":
      return permissions.can("view", "sales")
        ? {
            to: path.to.salesReturnOrderDetails(id),
            icon: <LuUndo2 />,
            label: t`Sales Return`
          }
        : null;
    default:
      return null;
  }
}

/**
 * Who the receipt comes from — the supplier, or the customer when it takes a
 * sales return back — when the user may open them. A return's customer lives
 * on the return, so it arrives with the related items.
 */
function useParty(
  receipt: Receipt | undefined,
  customerId: string | null
): (DocumentLink & { name: string }) | null {
  const { t } = useLingui();
  const permissions = usePermissions();
  const [customers] = useCustomers();
  const [suppliers] = useSuppliers();
  if (!receipt) return null;

  if (receipt.sourceDocument === "Sales Return Order") {
    const customer = customers.find((c) => c.id === customerId);
    if (!customer || !permissions.can("view", "sales")) return null;
    return {
      to: path.to.customer(customer.id),
      icon: <LuSquareUser />,
      label: t`Customer`,
      name: customer.name
    };
  }

  const supplier = suppliers.find((s) => s.id === receipt.supplierId);
  if (!supplier || !permissions.can("view", "purchasing")) return null;
  return {
    to: path.to.supplier(supplier.id),
    icon: <LuContainer />,
    label: t`Supplier`,
    name: supplier.name
  };
}

/**
 * The documents around a receipt: who it comes from, what it receives, the
 * inspections posting raised, what billed it, and the files attached to its
 * lines.
 */
const ReceiptDocuments = () => {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const routeData = useRouteData<{
    receipt: Receipt;
    receiptInspections: ReceiptInspection[];
    receiptLines: ReceiptLine[];
    receiptFiles?: Promise<{ data: StorageItem[] }>;
    relatedItems?: Promise<RelatedItems>;
  }>(path.to.receipt(receiptId));

  const receipt = routeData?.receipt;
  if (!receipt) return null;

  return (
    <Suspense
      fallback={
        <RelatedDocumentGroup>
          <RelatedDocumentSkeleton />
          <RelatedDocumentSkeleton />
        </RelatedDocumentGroup>
      }
    >
      <Await resolve={routeData?.relatedItems}>
        {(resolved) => (
          <Await resolve={routeData?.receiptFiles}>
            {(files) => (
              <ReceiptDocumentList
                receipt={receipt}
                receiptLines={routeData?.receiptLines ?? []}
                inspections={routeData?.receiptInspections ?? []}
                relatedItems={resolved ?? { invoices: [], customerId: null }}
                files={files?.data ?? []}
              />
            )}
          </Await>
        )}
      </Await>
    </Suspense>
  );
};

function ReceiptDocumentList({
  receipt,
  receiptLines,
  inspections,
  relatedItems,
  files
}: {
  receipt: Receipt;
  receiptLines: ReceiptLine[];
  inspections: ReceiptInspection[];
  relatedItems: RelatedItems;
  /** Line attachments; `bucket` holds the receipt line id. */
  files: StorageItem[];
}) {
  const { t } = useLingui();
  const { company } = useUser();
  const permissions = usePermissions();
  const party = useParty(receipt, relatedItems.customerId);
  const source = useSourceDocument(receipt);

  const visibleInspections = permissions.can("view", "quality")
    ? inspections
    : [];
  // A receipt raised from an invoice already lists it as its source.
  const invoices = permissions.can("view", "invoicing")
    ? relatedItems.invoices.filter(
        (invoice) =>
          !(
            receipt.sourceDocument === "Purchase Invoice" &&
            invoice.id === receipt.sourceDocumentId
          )
      )
    : [];

  if (
    !party &&
    !source &&
    visibleInspections.length === 0 &&
    invoices.length === 0 &&
    files.length === 0
  ) {
    return <Empty className="py-12" />;
  }

  return (
    <RelatedDocumentGroup>
      {party && (
        <RelatedDocument
          to={party.to}
          icon={party.icon}
          title={party.name}
          description={party.label}
        />
      )}
      {source && (
        <RelatedDocument
          to={source.to}
          icon={source.icon}
          title={receipt.sourceDocumentReadableId!}
          description={source.label}
        />
      )}
      {visibleInspections.map((inspection) => (
        <RelatedDocument
          key={inspection.id}
          to={path.to.inspection(inspection.id)}
          icon={<LuClipboardCheck />}
          title={inspection.inspectionId}
          description={
            inspection.itemReadableId
              ? t`Inspection · ${inspection.itemReadableId}`
              : t`Inspection`
          }
          status={<InspectionStatus status={inspection.status} />}
        />
      ))}
      {invoices.map((invoice) => (
        <RelatedDocument
          key={invoice.id}
          to={path.to.purchaseInvoice(invoice.id)}
          icon={<LuCreditCard />}
          title={invoice.invoiceId}
          description={t`Purchase Invoice`}
          status={<PurchaseInvoicingStatus status={invoice.status} />}
        />
      ))}
      {files.map((file) => {
        const itemReadableId = receiptLines.find(
          (line) => line.id === file.bucket
        )?.itemReadableId;
        return (
          <RelatedDocument
            key={`${file.bucket}/${file.name}`}
            to={path.to.file.previewFile(
              `private/${company.id}/inventory/${file.bucket}/${file.name}`
            )}
            external
            icon={<DocumentIcon type={getDocumentType(file.name)} />}
            title={file.name}
            description={
              itemReadableId ? t`Attachment · ${itemReadableId}` : t`Attachment`
            }
          />
        );
      })}
    </RelatedDocumentGroup>
  );
}

export default ReceiptDocuments;
