// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type { ReactElement, ReactNode } from "react";
import {
  LuBookOpen,
  LuContainer,
  LuCreditCard,
  LuReceiptText,
  LuSquareUser,
  LuUser,
  LuWallet
} from "react-icons/lu";
import { RelatedDocument } from "~/components/DocumentPage";
import { usePermissions } from "~/hooks";
import JournalEntryStatus from "~/modules/accounting/ui/JournalEntries/JournalEntryStatus";
import { useCustomers, usePeople, useSuppliers } from "~/stores";
import { path } from "~/utils/path";
import type { getSettlementRelatedItems } from "../../invoicing.service";
import type { PurchaseInvoiceStatus } from "../../types";
import MemoStatus from "../Memo/MemoStatus";
import PurchaseInvoicingStatus from "../PurchaseInvoice/PurchaseInvoicingStatus";
import ReimbursementStatus from "../Reimbursement/ReimbursementStatus";
import SalesInvoiceStatus from "../SalesInvoice/SalesInvoiceStatus";

export type SettlementRelatedItems = Awaited<
  ReturnType<typeof getSettlementRelatedItems>
>;

type Counterparty = {
  to: string;
  icon: ReactNode;
  label: string;
  name: string;
};

/**
 * Who a payment or memo is with — its customer, supplier or employee — when
 * the user may open them.
 */
export function useCounterparty(party?: {
  customerId?: string | null;
  supplierId?: string | null;
  employeeId?: string | null;
}): Counterparty | null {
  const { t } = useLingui();
  const permissions = usePermissions();
  const [customers] = useCustomers();
  const [suppliers] = useSuppliers();
  const [people] = usePeople();
  if (!party) return null;

  if (party.customerId) {
    const customer = customers.find((c) => c.id === party.customerId);
    if (!customer || !permissions.can("view", "sales")) return null;
    return {
      to: path.to.customer(customer.id),
      icon: <LuSquareUser />,
      label: t`Customer`,
      name: customer.name
    };
  }

  if (party.supplierId) {
    const supplier = suppliers.find((s) => s.id === party.supplierId);
    if (!supplier || !permissions.can("view", "purchasing")) return null;
    return {
      to: path.to.supplier(supplier.id),
      icon: <LuContainer />,
      label: t`Supplier`,
      name: supplier.name
    };
  }

  if (party.employeeId) {
    const person = people.find((p) => p.id === party.employeeId);
    if (!person || !permissions.can("view", "people")) return null;
    return {
      to: path.to.person(person.id),
      icon: <LuUser />,
      label: t`Employee`,
      name: person.name
    };
  }

  return null;
}

/**
 * The documents a payment or memo settles, the credits a payment draws, and
 * the journal entry its posting wrote — one row each, with its status.
 */
export function useSettlementRows(
  related?: SettlementRelatedItems
): ReactElement[] {
  const { t } = useLingui();
  const permissions = usePermissions();

  const rows: ReactElement[] = [];
  if (!related) return rows;

  for (const invoice of related.salesInvoices) {
    if (!invoice.id) continue;
    rows.push(
      <RelatedDocument
        key={`salesInvoice:${invoice.id}`}
        to={path.to.salesInvoice(invoice.id)}
        icon={<LuCreditCard />}
        title={invoice.invoiceId ?? ""}
        description={t`Sales Invoice`}
        status={<SalesInvoiceStatus status={invoice.status} />}
      />
    );
  }

  for (const invoice of related.purchaseInvoices) {
    if (!invoice.id) continue;
    rows.push(
      <RelatedDocument
        key={`purchaseInvoice:${invoice.id}`}
        to={path.to.purchaseInvoice(invoice.id)}
        icon={<LuReceiptText />}
        title={invoice.invoiceId ?? ""}
        description={t`Purchase Invoice`}
        status={
          <PurchaseInvoicingStatus
            status={invoice.status as PurchaseInvoiceStatus | null}
          />
        }
      />
    );
  }

  for (const memo of related.memos) {
    rows.push(
      <RelatedDocument
        key={`memo:${memo.id}`}
        to={path.to.memo(memo.id)}
        icon={<LuCreditCard />}
        title={memo.memoId}
        description={t`Memo`}
        status={<MemoStatus status={memo.status} />}
      />
    );
  }

  for (const reimbursement of related.reimbursements) {
    rows.push(
      <RelatedDocument
        key={`reimbursement:${reimbursement.id}`}
        to={path.to.reimbursement(reimbursement.id)}
        icon={<LuWallet />}
        title={reimbursement.reimbursementId}
        description={t`Reimbursement`}
        status={<ReimbursementStatus status={reimbursement.status} />}
      />
    );
  }

  for (const credit of related.credits) {
    rows.push(
      <RelatedDocument
        key={`credit:${credit.id}`}
        to={path.to.memo(credit.id)}
        icon={<LuCreditCard />}
        title={credit.memoId}
        description={t`Credit applied`}
        status={<MemoStatus status={credit.status} />}
      />
    );
  }

  if (related.journal && permissions.can("view", "accounting")) {
    rows.push(
      <RelatedDocument
        key={`journal:${related.journal.id}`}
        to={path.to.journalEntry(related.journal.id)}
        icon={<LuBookOpen />}
        title={related.journal.journalEntryId}
        description={t`Journal Entry`}
        status={<JournalEntryStatus status={related.journal.status} />}
      />
    );
  }

  return rows;
}
