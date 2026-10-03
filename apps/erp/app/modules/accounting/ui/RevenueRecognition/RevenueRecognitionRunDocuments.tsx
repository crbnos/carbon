// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { useLingui } from "@lingui/react/macro";
import { Suspense } from "react";
import { LuCreditCard, LuKeyRound } from "react-icons/lu";
import { Await, useParams } from "react-router";
import { Empty } from "~/components";
import {
  RelatedDocument,
  RelatedDocumentGroup,
  RelatedDocumentSkeleton
} from "~/components/DocumentPage";
import { usePermissions, useRouteData } from "~/hooks";
import SalesInvoiceStatus from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceStatus";
import RentalStatus from "~/modules/sales/ui/Rentals/RentalStatus";
import { path } from "~/utils/path";
import {
  AccountingPeriodDocument,
  JournalEntryDocument,
  type PeriodRunRelatedItems
} from "../PeriodRunDocuments";

/** A sales invoice a run recognized deferred revenue for. */
export type RunSalesInvoice = Pick<
  Database["public"]["Tables"]["salesInvoice"]["Row"],
  "id" | "invoiceId" | "status"
>;

/** A rental agreement a run accrued rent or lease interest for. */
export type RunRentalAgreement = Pick<
  Database["public"]["Tables"]["rentalAgreement"]["Row"],
  "id" | "rentalAgreementId" | "status"
>;

/**
 * The documents around a revenue recognition run: the accounting period it
 * posts into, the one journal entry it posted, and the rental agreements and
 * sales invoices whose revenue it recognized.
 */
const RevenueRecognitionRunDocuments = () => {
  const { t } = useLingui();
  const { runId } = useParams();
  if (!runId) throw new Error("runId not found");

  const permissions = usePermissions();
  const routeData = useRouteData<{
    salesInvoices: RunSalesInvoice[];
    rentalAgreements: RunRentalAgreement[];
    relatedItems?: Promise<PeriodRunRelatedItems>;
  }>(path.to.revenueRecognitionRun(runId));

  const rentalAgreements = permissions.can("view", "sales")
    ? [...(routeData?.rentalAgreements ?? [])].sort((a, b) =>
        a.rentalAgreementId.localeCompare(b.rentalAgreementId)
      )
    : [];
  const salesInvoices = permissions.can("view", "invoicing")
    ? [...(routeData?.salesInvoices ?? [])].sort((a, b) =>
        a.invoiceId.localeCompare(b.invoiceId)
      )
    : [];

  const sourceRows = (
    <>
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
    </>
  );
  const hasSourceRows = rentalAgreements.length + salesInvoices.length > 0;

  return (
    <Suspense
      fallback={
        <RelatedDocumentGroup>
          <RelatedDocumentSkeleton />
          <RelatedDocumentSkeleton />
          {sourceRows}
        </RelatedDocumentGroup>
      }
    >
      <Await resolve={routeData?.relatedItems}>
        {(resolved) => {
          const period = resolved?.accountingPeriod ?? null;
          const journals = resolved?.journals ?? [];

          if (!period && journals.length === 0 && !hasSourceRows) {
            return <Empty className="py-12" />;
          }

          return (
            <RelatedDocumentGroup>
              {period && <AccountingPeriodDocument period={period} />}
              {journals.map((journal) => (
                <JournalEntryDocument key={journal.id} journal={journal} />
              ))}
              {sourceRows}
            </RelatedDocumentGroup>
          );
        }}
      </Await>
    </Suspense>
  );
};

export default RevenueRecognitionRunDocuments;
