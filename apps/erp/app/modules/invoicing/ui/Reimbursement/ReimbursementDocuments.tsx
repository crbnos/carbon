// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { useLingui } from "@lingui/react/macro";
import { Suspense } from "react";
import { LuBanknote, LuBookOpen, LuUser } from "react-icons/lu";
import { Await, useParams } from "react-router";
import { Empty } from "~/components";
import {
  RelatedDocument,
  RelatedDocumentGroup,
  RelatedDocumentSkeleton
} from "~/components/DocumentPage";
import { usePermissions, useRouteData } from "~/hooks";
import JournalEntryStatus from "~/modules/accounting/ui/JournalEntries/JournalEntryStatus";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import PaymentStatus from "../Payment/PaymentStatus";

type Reimbursement = Database["public"]["Tables"]["reimbursement"]["Row"];

type ReimbursementPayment = Pick<
  Database["public"]["Tables"]["payment"]["Row"],
  "id" | "paymentId" | "status" | "paymentDate"
>;

type ReimbursementJournal = Pick<
  Database["public"]["Tables"]["journal"]["Row"],
  "id" | "journalEntryId" | "status"
>;

/**
 * The documents around a reimbursement: the employee it is owed to, the
 * journal entry its posting wrote, and the payments that paid it out.
 */
const ReimbursementDocuments = () => {
  const { t } = useLingui();
  const { reimbursementId } = useParams();
  if (!reimbursementId) throw new Error("reimbursementId not found");

  const permissions = usePermissions();
  const [people] = usePeople();
  const routeData = useRouteData<{
    reimbursement: Reimbursement;
    journal: ReimbursementJournal | null;
    relatedItems?: Promise<{ payments: ReimbursementPayment[] }>;
  }>(path.to.reimbursement(reimbursementId));

  const reimbursement = routeData?.reimbursement;
  if (!reimbursement) return null;

  const employee = permissions.can("view", "people")
    ? people.find((person) => person.id === reimbursement.employeeId)
    : undefined;

  const employeeRow = employee ? (
    <RelatedDocument
      to={path.to.person(employee.id)}
      icon={<LuUser />}
      title={employee.name}
      description={t`Employee`}
    />
  ) : null;

  const journal = routeData?.journal;
  const journalRow =
    journal && permissions.can("view", "accounting") ? (
      <RelatedDocument
        to={path.to.journalEntry(journal.id)}
        icon={<LuBookOpen />}
        title={journal.journalEntryId}
        description={t`Journal Entry`}
        status={<JournalEntryStatus status={journal.status} />}
      />
    ) : null;

  const hasRows = Boolean(employeeRow || journalRow);

  return (
    <Suspense
      fallback={
        <RelatedDocumentGroup>
          {employeeRow}
          {journalRow}
          <RelatedDocumentSkeleton />
        </RelatedDocumentGroup>
      }
    >
      <Await resolve={routeData?.relatedItems}>
        {(resolved) => {
          const payments = resolved?.payments ?? [];

          if (!hasRows && payments.length === 0) {
            return <Empty className="py-12" />;
          }

          return (
            <RelatedDocumentGroup>
              {employeeRow}
              {journalRow}
              {payments.map((payment) => (
                <RelatedDocument
                  key={payment.id}
                  to={path.to.payment(payment.id)}
                  icon={<LuBanknote />}
                  title={payment.paymentId}
                  description={t`Payment`}
                  status={<PaymentStatus status={payment.status} />}
                />
              ))}
            </RelatedDocumentGroup>
          );
        }}
      </Await>
    </Suspense>
  );
};

export default ReimbursementDocuments;
