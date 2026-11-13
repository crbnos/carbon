// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { type Gate, pageOfTable } from "@carbon/database/access";
import { useLingui } from "@lingui/react/macro";
import { Suspense } from "react";
import { LuKeyRound, LuSection, LuShoppingCart } from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import { Await, useParams } from "react-router";
import { Empty } from "~/components";
import {
  RelatedDocument,
  RelatedDocumentGroup,
  RelatedDocumentSkeleton
} from "~/components/DocumentPage";
import { usePermissions, useRouteData } from "~/hooks";
import PurchasingStatus from "~/modules/purchasing/ui/PurchaseOrder/PurchasingStatus";
import { CONTRACT_READ_GATE } from "~/modules/sales/sales.models";
import RentalStatus from "~/modules/sales/ui/Rentals/RentalStatus";
import SalesStatus from "~/modules/sales/ui/SalesOrder/SalesStatus";
import { path } from "~/utils/path";
import type { DepositDocument } from "../../invoicing.models";
import {
  type SettlementRelatedItems,
  useCounterparty,
  useSettlementRows
} from "./useSettlementDocuments";

type Payment = Database["public"]["Tables"]["payment"]["Row"];

/**
 * The documents around a payment: who it is with, the order or agreement it
 * is a deposit for, what it settles, the credits it draws, and the journal
 * entry posting wrote.
 */
const PaymentDocuments = () => {
  const { paymentId } = useParams();
  if (!paymentId) throw new Error("paymentId not found");

  const routeData = useRouteData<{
    payment: Payment;
    depositDocuments: DepositDocument[];
    relatedItems?: Promise<SettlementRelatedItems>;
  }>(path.to.payment(paymentId));

  const payment = routeData?.payment;
  if (!payment) return null;

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
        {(related) => (
          <PaymentDocumentList
            payment={payment}
            depositDocuments={routeData?.depositDocuments ?? []}
            related={related}
          />
        )}
      </Await>
    </Suspense>
  );
};

/**
 * The order, rental agreement or contract a payment is a deposit for, or the
 * purchase order it is a prepayment for, with what showing it needs: View on
 * the page that owns its table. A contract opens from either contracts list.
 */
const DEPOSIT_SOURCES = (
  [
    ["rentalAgreementId", "rentalAgreement"],
    ["salesOrderId", "salesOrder"],
    ["customerContractId", "customerContract"],
    ["purchaseOrderId", "purchaseOrder"]
  ] as const
).map(([column, table]) => ({
  column,
  gate:
    table === "customerContract"
      ? CONTRACT_READ_GATE
      : ({ [pageOfTable(table)]: "View" } as Gate)
}));

function PaymentDocumentList({
  payment,
  depositDocuments,
  related
}: {
  payment: Payment;
  depositDocuments: DepositDocument[];
  related?: SettlementRelatedItems;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const party = useCounterparty(payment);
  const settlementRows = useSettlementRows(related, payment.status === "Draft");

  const source = DEPOSIT_SOURCES.find(({ column }) => payment[column]);
  const depositId = source && payment[source.column];
  const deposit =
    source && depositId && permissions.has(source.gate)
      ? depositDocuments.find((doc) => doc.id === depositId)
      : undefined;

  if (!party && !deposit && settlementRows.length === 0) {
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
      {deposit &&
        (deposit.kind === "rentalAgreement" ? (
          <RelatedDocument
            to={path.to.rentalAgreement(deposit.id)}
            icon={<LuKeyRound />}
            title={deposit.readableId}
            description={t`Rental Agreement`}
            status={
              <RentalStatus
                status={
                  deposit.status as Database["public"]["Enums"]["rentalAgreementStatus"]
                }
              />
            }
          />
        ) : deposit.kind === "customerContract" ? (
          <RelatedDocument
            to={path.to.contract(deposit.id)}
            icon={<LuSection />}
            title={deposit.readableId}
            description={t`Contract`}
          />
        ) : deposit.kind === "purchaseOrder" ? (
          <RelatedDocument
            to={path.to.purchaseOrderDetails(deposit.id)}
            icon={<LuShoppingCart />}
            title={deposit.readableId}
            description={t`Purchase Order`}
            status={
              <PurchasingStatus
                status={
                  deposit.status as Database["public"]["Enums"]["purchaseOrderStatus"]
                }
              />
            }
          />
        ) : (
          <RelatedDocument
            to={path.to.salesOrderDetails(deposit.id)}
            icon={<RiProgress8Line />}
            title={deposit.readableId}
            description={t`Sales Order`}
            status={
              <SalesStatus
                status={
                  deposit.status as Database["public"]["Enums"]["salesOrderStatus"]
                }
              />
            }
          />
        ))}
      {settlementRows}
    </RelatedDocumentGroup>
  );
}

export default PaymentDocuments;
