// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import {
  formatPeriodLabel,
  PERIOD_CLOSE_STATUS_COLOR_MAP
} from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { Suspense } from "react";
import { LuBookOpen, LuCalendarCheck } from "react-icons/lu";
import { Await, useParams } from "react-router";
import { Empty } from "~/components";
import {
  RelatedDocument,
  RelatedDocumentGroup,
  RelatedDocumentSkeleton
} from "~/components/DocumentPage";
import { JournalEntrySourceTypeIcon } from "~/components/Icons";
import { useRouteData } from "~/hooks";
import type {
  getJournalEntryRelatedItems,
  JournalEntry,
  JournalSourceDocument,
  PeriodCloseStatus
} from "~/modules/accounting";
import { path } from "~/utils/path";
import JournalEntryStatus from "./JournalEntryStatus";

type RelatedItems = Awaited<ReturnType<typeof getJournalEntryRelatedItems>>;
type SourceKind = JournalSourceDocument["kind"];
type JournalEntrySourceType = NonNullable<JournalEntry["sourceType"]>;

/**
 * The documents around a journal entry: everything it was posted from, the
 * entry it reverses or that reversed it, and the period it posts into.
 */
const JournalEntryDocuments = () => {
  const { t } = useLingui();
  const { journalEntryId } = useParams();
  if (!journalEntryId) throw new Error("journalEntryId not found");

  const routeData = useRouteData<{
    journalEntry: JournalEntry;
    relatedItems?: Promise<RelatedItems>;
  }>(path.to.journalEntry(journalEntryId));

  // What each kind is called, where it opens, and the journal source type
  // whose icon stands for it.
  const kinds: Record<
    SourceKind,
    { label: string; to: (id: string) => string; icon: JournalEntrySourceType }
  > = {
    receipt: {
      label: t`Receipt`,
      to: path.to.receiptDetails,
      icon: "Purchase Receipt"
    },
    shipment: {
      label: t`Shipment`,
      to: path.to.shipmentDetails,
      icon: "Sales Shipment"
    },
    salesInvoice: {
      label: t`Sales Invoice`,
      to: path.to.salesInvoiceDetails,
      icon: "Sales Invoice"
    },
    purchaseInvoice: {
      label: t`Purchase Invoice`,
      to: path.to.purchaseInvoiceDetails,
      icon: "Purchase Invoice"
    },
    rentalAgreement: {
      label: t`Rental Agreement`,
      to: path.to.rentalAgreementDetails,
      icon: "Lease"
    },
    job: { label: t`Job`, to: path.to.jobDetails, icon: "Job Receipt" },
    fixedAsset: {
      label: t`Fixed Asset`,
      to: path.to.fixedAsset,
      icon: "Asset Transfer"
    },
    inventoryCount: {
      label: t`Inventory Count`,
      to: path.to.inventoryCount,
      icon: "Inventory Adjustment"
    },
    maintenanceDispatch: {
      label: t`Maintenance Dispatch`,
      to: path.to.maintenanceDispatch,
      icon: "Maintenance Event"
    },
    nonConformance: {
      label: t`Issue`,
      to: path.to.issue,
      icon: "Non-Conformance"
    },
    inspection: {
      label: t`Inspection`,
      to: path.to.inspection,
      icon: "Inbound Inspection"
    },
    charge: { label: t`Charge`, to: path.to.charge, icon: "Charge" },
    reimbursement: {
      label: t`Reimbursement`,
      to: path.to.reimbursement,
      icon: "Reimbursement"
    },
    payment: { label: t`Payment`, to: path.to.payment, icon: "Payment" },
    memo: { label: t`Memo`, to: path.to.memo, icon: "Credit Memo" },
    depreciationRun: {
      label: t`Depreciation Run`,
      to: path.to.depreciationRun,
      icon: "Asset Depreciation"
    },
    revenueRecognitionRun: {
      label: t`Revenue Recognition Run`,
      to: path.to.revenueRecognitionRun,
      icon: "Revenue Recognition"
    }
  };
  const closeStatusLabels: Record<PeriodCloseStatus, string> = {
    Open: t`Open`,
    Locked: t`Locked`,
    Closed: t`Closed`
  };

  if (!routeData?.journalEntry) return null;

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
        {(resolved) => {
          const { documents, reversalOf, reversedBy, accountingPeriod } =
            resolved ?? {
              documents: [],
              reversalOf: null,
              reversedBy: null,
              accountingPeriod: null
            };

          if (
            documents.length === 0 &&
            !reversalOf &&
            !reversedBy &&
            !accountingPeriod
          ) {
            return <Empty className="py-12" />;
          }

          return (
            <RelatedDocumentGroup>
              {documents.map((document) => {
                const kind = kinds[document.kind];
                return (
                  <RelatedDocument
                    key={`${document.kind}:${document.id}`}
                    to={kind.to(document.id)}
                    icon={<JournalEntrySourceTypeIcon sourceType={kind.icon} />}
                    title={document.readableId}
                    description={kind.label}
                  />
                );
              })}
              {reversalOf && (
                <RelatedDocument
                  to={path.to.journalEntryDetails(reversalOf.id)}
                  icon={<LuBookOpen />}
                  title={reversalOf.journalEntryId}
                  description={t`Reversed entry`}
                  status={<JournalEntryStatus status={reversalOf.status} />}
                />
              )}
              {reversedBy && (
                <RelatedDocument
                  to={path.to.journalEntryDetails(reversedBy.id)}
                  icon={<LuBookOpen />}
                  title={reversedBy.journalEntryId}
                  description={t`Reversing entry`}
                  status={<JournalEntryStatus status={reversedBy.status} />}
                />
              )}
              {accountingPeriod && (
                <RelatedDocument
                  to={path.to.accountingPeriodClose(accountingPeriod.id)}
                  icon={<LuCalendarCheck />}
                  title={formatPeriodLabel(accountingPeriod.startDate)}
                  description={t`Accounting Period`}
                  status={
                    <Status
                      color={
                        PERIOD_CLOSE_STATUS_COLOR_MAP[
                          accountingPeriod.closeStatus
                        ] ?? "gray"
                      }
                    >
                      {closeStatusLabels[accountingPeriod.closeStatus]}
                    </Status>
                  }
                />
              )}
            </RelatedDocumentGroup>
          );
        }}
      </Await>
    </Suspense>
  );
};

export default JournalEntryDocuments;
