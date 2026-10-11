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
  LuKeyRound,
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
    case "Rental Agreement":
      return permissions.can("view", "sales")
        ? {
            to: path.to.rentalAgreementDetails(id),
            icon: <LuKeyRound />,
            label: t`Rental Agreement`
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
 * lines. The rows the receipt itself names render at once; invoices, a
 * return's customer and attachments stream in.
 */
const ReceiptDocuments = () => {
  const { t } = useLingui();
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
  const permissions = usePermissions();
  // A sales return's customer lives on the return, so it streams in with the
  // related items; every other receipt's party is its supplier.
  const supplierParty = useParty(receipt, null);
  const source = useSourceDocument(receipt);
  if (!receipt) return null;

  const isSalesReturn = receipt.sourceDocument === "Sales Return Order";
  // A rental receipt has no supplier, and `receipt` has no customer.
  const hidesSupplier =
    isSalesReturn || receipt.sourceDocument === "Rental Agreement";
  const inspections = permissions.can("view", "quality")
    ? (routeData?.receiptInspections ?? [])
    : [];
  const receiptLines = routeData?.receiptLines ?? [];
  const relatedItems = routeData?.relatedItems;
  const receiptFiles = routeData?.receiptFiles;

  const supplierRow =
    !hidesSupplier && supplierParty ? (
      <RelatedDocument
        to={supplierParty.to}
        icon={supplierParty.icon}
        title={supplierParty.name}
        description={supplierParty.label}
      />
    ) : null;

  const sourceRow = source ? (
    <RelatedDocument
      to={source.to}
      icon={source.icon}
      title={receipt.sourceDocumentReadableId!}
      description={source.label}
    />
  ) : null;

  const inspectionRows = inspections.map((inspection) => {
    const itemReadableId = inspection.itemReadableId;
    return (
      <RelatedDocument
        key={inspection.id}
        to={path.to.inspection(inspection.id)}
        icon={<LuClipboardCheck />}
        title={inspection.inspectionId}
        description={
          itemReadableId ? t`Inspection · ${itemReadableId}` : t`Inspection`
        }
        status={<InspectionStatus status={inspection.status} />}
      />
    );
  });

  const hasImmediateRows = Boolean(
    supplierRow || sourceRow || inspectionRows.length > 0
  );

  // With nothing to show up front, wait for the streamed rows before
  // deciding whether the list is empty.
  if (!hasImmediateRows) {
    return (
      <Suspense
        fallback={
          <RelatedDocumentGroup>
            <RelatedDocumentSkeleton />
          </RelatedDocumentGroup>
        }
      >
        <Await
          resolve={relatedItems}
          errorElement={<Empty className="py-12" />}
        >
          {(resolved) => (
            <Await
              resolve={receiptFiles}
              errorElement={<Empty className="py-12" />}
            >
              {(files) => (
                <StreamedReceiptDocuments
                  receipt={receipt}
                  receiptLines={receiptLines}
                  relatedItems={resolved ?? EMPTY_RELATED_ITEMS}
                  files={files?.data ?? []}
                />
              )}
            </Await>
          )}
        </Await>
      </Suspense>
    );
  }

  return (
    <RelatedDocumentGroup>
      {isSalesReturn ? (
        <Suspense fallback={null}>
          <Await resolve={relatedItems} errorElement={null}>
            {(resolved) => (
              <ReturnCustomerRow
                receipt={receipt}
                customerId={resolved?.customerId ?? null}
              />
            )}
          </Await>
        </Suspense>
      ) : (
        supplierRow
      )}
      {sourceRow}
      {inspectionRows}
      <Suspense fallback={<RelatedDocumentSkeleton />}>
        <Await
          resolve={relatedItems}
          errorElement={
            <li className="px-3 py-2.5 text-xs text-muted-foreground">
              {t`Invoices could not be loaded`}
            </li>
          }
        >
          {(resolved) => (
            <InvoiceRows
              receipt={receipt}
              invoices={(resolved ?? EMPTY_RELATED_ITEMS).invoices}
            />
          )}
        </Await>
      </Suspense>
      <Suspense fallback={null}>
        <Await
          resolve={receiptFiles}
          errorElement={
            <li className="px-3 py-2.5 text-xs text-muted-foreground">
              {t`Attachments could not be loaded`}
            </li>
          }
        >
          {(files) => (
            <AttachmentRows
              receiptLines={receiptLines}
              files={files?.data ?? []}
            />
          )}
        </Await>
      </Suspense>
    </RelatedDocumentGroup>
  );
};

const EMPTY_RELATED_ITEMS: RelatedItems = { invoices: [], customerId: null };

/** The customer a sales return came back from. */
function ReturnCustomerRow({
  receipt,
  customerId
}: {
  receipt: Receipt;
  customerId: string | null;
}) {
  const party = useParty(receipt, customerId);
  if (!party) return null;
  return (
    <RelatedDocument
      to={party.to}
      icon={party.icon}
      title={party.name}
      description={party.label}
    />
  );
}

/** The purchase invoices that billed the receipt. */
function InvoiceRows({
  receipt,
  invoices
}: {
  receipt: Receipt;
  invoices: RelatedItems["invoices"];
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  if (!permissions.can("view", "invoicing")) return null;

  // A receipt raised from an invoice already lists it as its source.
  return (
    <>
      {invoices
        .filter(
          (invoice) =>
            !(
              receipt.sourceDocument === "Purchase Invoice" &&
              invoice.id === receipt.sourceDocumentId
            )
        )
        .map((invoice) => (
          <RelatedDocument
            key={invoice.id}
            to={path.to.purchaseInvoice(invoice.id)}
            icon={<LuCreditCard />}
            title={invoice.invoiceId}
            description={t`Purchase Invoice`}
            status={<PurchaseInvoicingStatus status={invoice.status} />}
          />
        ))}
    </>
  );
}

/** Files attached to the receipt's lines; `bucket` holds the line id. */
function AttachmentRows({
  receiptLines,
  files
}: {
  receiptLines: ReceiptLine[];
  files: StorageItem[];
}) {
  const { t } = useLingui();
  const { company } = useUser();

  return (
    <>
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
    </>
  );
}

/**
 * The receipt's documents when it names none itself: only what streamed in,
 * or the empty state.
 */
function StreamedReceiptDocuments({
  receipt,
  receiptLines,
  relatedItems,
  files
}: {
  receipt: Receipt;
  receiptLines: ReceiptLine[];
  relatedItems: RelatedItems;
  files: StorageItem[];
}) {
  const permissions = usePermissions();
  // Only a sales return can reach here with a party: a supplier would have
  // rendered up front.
  const customer = useParty(receipt, relatedItems.customerId);
  const hasInvoices =
    permissions.can("view", "invoicing") &&
    relatedItems.invoices.some(
      (invoice) =>
        !(
          receipt.sourceDocument === "Purchase Invoice" &&
          invoice.id === receipt.sourceDocumentId
        )
    );

  if (!customer && !hasInvoices && files.length === 0) {
    return <Empty className="py-12" />;
  }

  return (
    <RelatedDocumentGroup>
      {receipt.sourceDocument === "Sales Return Order" && (
        <ReturnCustomerRow
          receipt={receipt}
          customerId={relatedItems.customerId}
        />
      )}
      <InvoiceRows receipt={receipt} invoices={relatedItems.invoices} />
      <AttachmentRows receiptLines={receiptLines} files={files} />
    </RelatedDocumentGroup>
  );
}

export default ReceiptDocuments;
