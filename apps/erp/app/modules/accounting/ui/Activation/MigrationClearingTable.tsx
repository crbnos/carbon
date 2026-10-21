// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  isMigrationClearingZero,
  type JournalLineDocumentType,
  type MigrationClearingRow,
  type OpenItemType
} from "@carbon/database/accounting-cutover";
import { useAction } from "@carbon/query";
import {
  Button,
  cn,
  IconButton,
  Table,
  Tbody,
  Td,
  Tfoot,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { Link } from "react-router";
import { useCurrencyFormatter, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  accountLabel,
  activationStepPath,
  useAccountsById
} from "./ActivationSteps";

/** One item behind a control account's Carbon total. */
export type MigrationClearingItem = {
  key: string;
  accountId: string;
  openItemType: OpenItemType;
  documentType: JournalLineDocumentType | null;
  documentId: string | null;
  /** The document's readable number, or the item's description. */
  label: string;
  partyName: string | null;
  /** Debit-signed, as the table's amounts. */
  amount: number;
  /** A sales or purchase invoice Carbon does not settle after the cutover,
   *  which the user may ignore. */
  ignorable: boolean;
};

/**
 * Migration Clearing per control account: what the prior system's trial
 * balance says, what Carbon's open items hold, and the difference. Amounts
 * are debit-signed. Each account opens to the items behind its Carbon total;
 * an invoice another system already settled can be ignored, which takes it
 * out of Carbon's total. Every difference stays on Migration Clearing.
 */
export default function MigrationClearingTable({
  cutoverDate,
  rows,
  total,
  items,
  ignoredItems
}: {
  cutoverDate: string;
  rows: MigrationClearingRow[];
  total: number;
  items: MigrationClearingItem[];
  ignoredItems: MigrationClearingItem[];
}) {
  const { t } = useLingui();
  const formatter = useCurrencyFormatter();
  const accountsById = useAccountsById();
  const permissions = usePermissions();
  const canEdit = permissions.can("update", "accounting");
  const action = activationStepPath("trial-balance", cutoverDate);
  const ignore = useAction();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // A control account with nothing on either side tells the reader nothing.
  const shown = rows.filter(
    (row) => row.trialBalance !== 0 || row.carbon !== 0
  );
  const itemsByAccount = new Map<string, MigrationClearingItem[]>();
  for (const item of items) {
    const list = itemsByAccount.get(item.accountId) ?? [];
    list.push(item);
    itemsByAccount.set(item.accountId, list);
  }
  for (const list of itemsByAccount.values()) {
    // The largest amounts drive the difference most.
    list.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  }

  const toggle = (accountId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });

  const setIgnored = (invoiceId: string, ignored: boolean) =>
    ignore.submit(
      {
        intent: "ignore-invoice",
        cutoverDate,
        invoiceId,
        ignored: String(ignored)
      },
      { method: "post", action }
    );

  return (
    <div className="flex w-full flex-col gap-8">
      <Table>
        <Thead>
          <Tr>
            <Th>
              <Trans>Control Account</Trans>
            </Th>
            <Th className="text-right">
              <Trans>Trial Balance</Trans>
            </Th>
            <Th className="text-right">
              <Trans>Carbon</Trans>
            </Th>
            <Th className="text-right">
              <Trans>Difference</Trans>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {shown.length === 0 ? (
            <Tr>
              <Td colSpan={4} className="text-center text-muted-foreground">
                <Trans>No control account has a balance at the cutover.</Trans>
              </Td>
            </Tr>
          ) : (
            shown.flatMap((row) => {
              const accountItems = itemsByAccount.get(row.accountId) ?? [];
              const isOpen = expanded.has(row.accountId);
              const label = accountLabel(accountsById, row.accountId);
              return [
                <Tr key={row.accountId}>
                  <Td>
                    <div className="flex items-center gap-1">
                      {accountItems.length > 0 ? (
                        <IconButton
                          aria-label={
                            isOpen
                              ? t`Hide the items on ${label}`
                              : t`Show the items on ${label}`
                          }
                          icon={isOpen ? <LuChevronDown /> : <LuChevronRight />}
                          variant="ghost"
                          size="sm"
                          onClick={() => toggle(row.accountId)}
                        />
                      ) : (
                        <span className="size-8" />
                      )}
                      <span>{label}</span>
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatter.format(row.trialBalance)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatter.format(row.carbon)}
                  </Td>
                  <Td
                    className={cn(
                      "text-right tabular-nums",
                      !isMigrationClearingZero(row.difference) &&
                        "text-destructive"
                    )}
                  >
                    {formatter.format(row.difference)}
                  </Td>
                </Tr>,
                ...(isOpen
                  ? accountItems.map((item) => (
                      <Tr key={item.key} className="text-muted-foreground">
                        <Td colSpan={2}>
                          <div className="flex items-center gap-2 pl-9">
                            <ItemLink item={item} cutoverDate={cutoverDate} />
                            {item.partyName && <span>{item.partyName}</span>}
                          </div>
                        </Td>
                        <Td className="text-right tabular-nums">
                          {formatter.format(item.amount)}
                        </Td>
                        <Td className="text-right">
                          {item.ignorable && item.documentId && (
                            <Button
                              variant="secondary"
                              size="sm"
                              isDisabled={!canEdit || ignore.isPending}
                              onClick={() => setIgnored(item.documentId!, true)}
                            >
                              <Trans>Ignore</Trans>
                            </Button>
                          )}
                        </Td>
                      </Tr>
                    ))
                  : [])
              ];
            })
          )}
        </Tbody>
        <Tfoot>
          <Tr>
            <Th colSpan={3}>
              <Trans>Migration Clearing</Trans>
            </Th>
            <Th
              className={cn(
                "text-right tabular-nums",
                !isMigrationClearingZero(total) && "text-destructive"
              )}
            >
              {formatter.format(total)}
            </Th>
          </Tr>
        </Tfoot>
      </Table>

      {ignoredItems.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            <Trans>Ignored</Trans>
          </h3>
          <p className="text-sm text-muted-foreground">
            <Trans>
              Settled in the system that kept the books before the cutover.
              Carbon leaves them out of its totals and marks them Paid on the
              day before the cutover when you set up accounting.
            </Trans>
          </p>
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Invoice</Trans>
                </Th>
                <Th>
                  <Trans>Control Account</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Amount</Trans>
                </Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {ignoredItems.map((item) => (
                <Tr key={item.key}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <ItemLink item={item} cutoverDate={cutoverDate} />
                      {item.partyName && (
                        <span className="text-muted-foreground">
                          {item.partyName}
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td>{accountLabel(accountsById, item.accountId)}</Td>
                  <Td className="text-right tabular-nums">
                    {formatter.format(item.amount)}
                  </Td>
                  <Td className="text-right">
                    {item.documentId && (
                      <Button
                        variant="secondary"
                        size="sm"
                        isDisabled={!canEdit || ignore.isPending}
                        onClick={() => setIgnored(item.documentId!, false)}
                      >
                        <Trans>Restore</Trans>
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}
    </div>
  );
}

/** The item's label, linked to its document or to the step it comes from. */
function ItemLink({
  item,
  cutoverDate
}: {
  item: MigrationClearingItem;
  cutoverDate: string;
}) {
  const to = itemHref(item, cutoverDate);
  return to ? (
    <Link to={to} className="text-foreground hover:underline">
      {item.label}
    </Link>
  ) : (
    <span className="text-foreground">{item.label}</span>
  );
}

function itemHref(
  item: MigrationClearingItem,
  cutoverDate: string
): string | null {
  const id = item.documentId;
  switch (item.openItemType) {
    case "Receivable":
    case "Deferred Revenue":
      if (!id) return null;
      return item.documentType === "Invoice"
        ? path.to.salesInvoice(id)
        : path.to.memo(id);
    case "Payable":
      if (!id) return null;
      return item.documentType === "Invoice"
        ? path.to.purchaseInvoice(id)
        : path.to.memo(id);
    case "Unapplied Credit":
    case "Customer Deposit":
      return id ? path.to.payment(id) : null;
    case "Work in Progress":
      return id ? path.to.job(id) : null;
    case "Inventory":
      return activationStepPath("inventory", cutoverDate);
    case "Fixed Asset Cost":
    case "Accumulated Depreciation":
      return activationStepPath("fixed-assets", cutoverDate);
    default:
      return null;
  }
}
