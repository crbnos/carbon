// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { useLingui } from "@lingui/react/macro";
import { Suspense } from "react";
import { LuKeyRound } from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import { Await, useParams } from "react-router";
import { Empty } from "~/components";
import {
  RelatedDocument,
  RelatedDocumentGroup,
  RelatedDocumentSkeleton
} from "~/components/DocumentPage";
import { usePermissions, useRouteData } from "~/hooks";
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

  // The order or rental agreement this payment is a deposit for.
  const depositId = payment.rentalAgreementId ?? payment.salesOrderId;
  const deposit =
    depositId && permissions.can("view", "sales")
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
