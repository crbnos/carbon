// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Suspense } from "react";
import {
  LuBarcode,
  LuContainer,
  LuCreditCard,
  LuKeyRound,
  LuShoppingCart,
  LuSquareUser,
  LuTruck,
  LuUndo2
} from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import { Await, useParams } from "react-router";
import { Empty } from "~/components";
import {
  RelatedDocument,
  RelatedDocumentGroup,
  RelatedDocumentSkeleton
} from "~/components/DocumentPage";
import { usePermissions, useRouteData } from "~/hooks";
import type { Shipment } from "~/modules/inventory";
import type { SalesInvoice } from "~/modules/invoicing/types";
import SalesInvoiceStatus from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceStatus";
import { useCustomers, useSuppliers } from "~/stores";
import { path } from "~/utils/path";

/** The sources `file+/shipment+/$id[.]pdf.tsx` renders a packing slip for. */
const PACKING_SLIP_SOURCES = new Set<string>([
  "Sales Order",
  "Sales Invoice",
  "Purchase Order",
  "Outbound Transfer",
  "Rental Agreement"
]);

type SourceDocument = {
  to: string;
  icon: ReactNode;
  label: string;
};

/** Where the shipment's source document lives, when the user may open it. */
function useSourceDocument(shipment?: Shipment): SourceDocument | null {
  const { t } = useLingui();
  const permissions = usePermissions();
  const id = shipment?.sourceDocumentId;
  if (!shipment || !id || !shipment.sourceDocumentReadableId) return null;

  switch (shipment.sourceDocument) {
    case "Sales Order":
      return permissions.can("view", "sales")
        ? {
            to: path.to.salesOrderDetails(id),
            icon: <RiProgress8Line />,
            label: t`Sales Order`
          }
        : null;
    case "Sales Invoice":
      return permissions.can("view", "invoicing")
        ? {
            to: path.to.salesInvoice(id),
            icon: <LuCreditCard />,
            label: t`Sales Invoice`
          }
        : null;
    case "Purchase Order":
      return permissions.can("view", "purchasing")
        ? {
            to: path.to.purchaseOrderDetails(id),
            icon: <LuShoppingCart />,
            label: t`Purchase Order`
          }
        : null;
    case "Outbound Transfer":
      return permissions.can("view", "inventory")
        ? {
            to: path.to.warehouseTransferDetails(id),
            icon: <LuTruck />,
            label: t`Warehouse Transfer`
          }
        : null;
    case "Purchase Return Order":
      return permissions.can("view", "purchasing")
        ? {
            to: path.to.purchaseReturnOrderDetails(id),
            icon: <LuUndo2 />,
            label: t`Purchase Return`
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
 * Who the shipment goes to — the customer, or the supplier when it ships a
 * purchase back — when the user may open them.
 */
function useParty(
  shipment?: Shipment
): (SourceDocument & { name: string }) | null {
  const { t } = useLingui();
  const permissions = usePermissions();
  const [customers] = useCustomers();
  const [suppliers] = useSuppliers();
  if (!shipment) return null;

  const isPurchase =
    shipment.sourceDocument === "Purchase Order" ||
    shipment.sourceDocument === "Purchase Return Order" ||
    shipment.sourceDocument === "Purchase Invoice";

  if (isPurchase) {
    const supplier = suppliers.find((s) => s.id === shipment.supplierId);
    if (!supplier || !permissions.can("view", "purchasing")) return null;
    return {
      to: path.to.supplier(supplier.id),
      icon: <LuContainer />,
      label: t`Supplier`,
      name: supplier.name
    };
  }

  const customer = customers.find((c) => c.id === shipment.customerId);
  if (!customer || !permissions.can("view", "sales")) return null;
  return {
    to: path.to.customer(customer.id),
    icon: <LuSquareUser />,
    label: t`Customer`,
    name: customer.name
  };
}

/**
 * The documents around a shipment: who it goes to, what it ships, what billed
 * it, and its own packing slip.
 */
const ShipmentDocuments = () => {
  const { t } = useLingui();
  const { shipmentId } = useParams();
  if (!shipmentId) throw new Error("shipmentId not found");

  const permissions = usePermissions();
  const routeData = useRouteData<{
    shipment: Shipment;
    relatedItems?: Promise<{ invoices: SalesInvoice[] }>;
  }>(path.to.shipment(shipmentId));

  const shipment = routeData?.shipment;
  const party = useParty(shipment);
  const source = useSourceDocument(shipment);
  if (!shipment) return null;

  const partyRow = party ? (
    <RelatedDocument
      to={party.to}
      icon={party.icon}
      title={party.name}
      description={party.label}
    />
  ) : null;

  const sourceRow = source ? (
    <RelatedDocument
      to={source.to}
      icon={source.icon}
      title={shipment.sourceDocumentReadableId!}
      description={source.label}
    />
  ) : null;

  // A packing slip lists the source document's lines; only the sources the
  // packing-slip route renders have one to print.
  const packingSlipRow =
    shipment.sourceDocumentId &&
    shipment.sourceDocument &&
    PACKING_SLIP_SOURCES.has(shipment.sourceDocument) ? (
      <RelatedDocument
        to={path.to.file.shipment(shipmentId)}
        external
        icon={<LuBarcode />}
        title={t`Packing Slip`}
        description={t`PDF`}
      />
    ) : null;

  const hasRows = Boolean(partyRow || sourceRow || packingSlipRow);

  if (!permissions.can("view", "invoicing")) {
    return hasRows ? (
      <RelatedDocumentGroup>
        {partyRow}
        {sourceRow}
        {packingSlipRow}
      </RelatedDocumentGroup>
    ) : (
      <Empty className="py-12" />
    );
  }

  return (
    <Suspense
      fallback={
        <RelatedDocumentGroup>
          {partyRow}
          {sourceRow}
          <RelatedDocumentSkeleton />
          {packingSlipRow}
        </RelatedDocumentGroup>
      }
    >
      <Await
        resolve={routeData?.relatedItems}
        errorElement={
          // The invoices could not be read: still list what is known.
          hasRows ? (
            <RelatedDocumentGroup>
              {partyRow}
              {sourceRow}
              {packingSlipRow}
            </RelatedDocumentGroup>
          ) : (
            <Empty className="py-12" />
          )
        }
      >
        {(resolved) => {
          // A shipment raised from an invoice already lists it as its source.
          const invoices = (resolved?.invoices ?? []).filter(
            (invoice) =>
              !(
                shipment.sourceDocument === "Sales Invoice" &&
                invoice.id === shipment.sourceDocumentId
              )
          );

          if (!hasRows && invoices.length === 0) {
            return <Empty className="py-12" />;
          }

          return (
            <RelatedDocumentGroup>
              {partyRow}
              {sourceRow}
              {invoices.map((invoice) => (
                <RelatedDocument
                  key={invoice.id}
                  to={path.to.salesInvoice(invoice.id!)}
                  icon={<LuCreditCard />}
                  title={invoice.invoiceId ?? ""}
                  description={t`Sales Invoice`}
                  status={<SalesInvoiceStatus status={invoice.status} />}
                />
              ))}
              {packingSlipRow}
            </RelatedDocumentGroup>
          );
        }}
      </Await>
    </Suspense>
  );
};

export default ShipmentDocuments;
