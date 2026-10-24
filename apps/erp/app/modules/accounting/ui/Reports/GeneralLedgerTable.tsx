// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { HStack } from "@carbon/react";
import { toDisplayCredit, toDisplayDebit } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuBookmark,
  LuCalendar,
  LuCircleDollarSign,
  LuFileText,
  LuLandmark,
  LuTag
} from "react-icons/lu";
import { DateTime, Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { path } from "~/utils/path";
import {
  journalEntrySourceTypes,
  journalLineDocumentType
} from "../../accounting.models";
import type { AccountClass, GeneralLedgerLine } from "../../types";
import JournalEntryStatus from "../JournalEntries/JournalEntryStatus";

type GeneralLedgerTableProps = {
  data: GeneralLedgerLine[];
  count: number;
  accounts: { id: string; number: string | null; name: string | null }[];
  currencyCode: string;
};

const defaultColumnVisibility = {
  documentType: false
};

function accountLabel(line: GeneralLedgerLine) {
  return [line.account?.number, line.account?.name].filter(Boolean).join(" ");
}

// `amount` is signed by the account's natural balance, so debit and credit
// depend on the account's class
function debitOf(line: GeneralLedgerLine) {
  return toDisplayDebit(
    line.amount ?? 0,
    (line.account?.class ?? "Asset") as AccountClass
  );
}

function creditOf(line: GeneralLedgerLine) {
  return toDisplayCredit(
    line.amount ?? 0,
    (line.account?.class ?? "Asset") as AccountClass
  );
}

const GeneralLedgerTable = memo(
  ({ data, count, accounts, currencyCode }: GeneralLedgerTableProps) => {
    const { t } = useLingui();
    const currencyFormatter = useCurrencyFormatter({ currency: currencyCode });

    const columns = useMemo<ColumnDef<GeneralLedgerLine>[]>(
      () => [
        {
          accessorKey: "postingDate",
          header: t`Date`,
          cell: ({ row }) => (
            <DateTime value={row.original.postingDate} variant="date" />
          ),
          meta: {
            mobile: "P2",
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "journalEntryId",
          header: t`Journal Entry`,
          cell: ({ row }) => (
            <HStack spacing={2}>
              <Hyperlink
                to={path.to.journalEntryDetails(row.original.journalId!)}
              >
                {row.original.journalEntryId}
              </Hyperlink>
              {row.original.status !== "Posted" && row.original.status && (
                <JournalEntryStatus status={row.original.status} />
              )}
            </HStack>
          ),
          meta: {
            mobile: "P1",
            icon: <LuBookmark />
          }
        },
        {
          accessorKey: "accountId",
          header: t`Account`,
          cell: ({ row }) => accountLabel(row.original) || "—",
          meta: {
            mobile: "P3",
            icon: <LuLandmark />,
            sortBy: "account.number",
            exportValue: accountLabel,
            filter: {
              type: "static",
              isArray: true,
              options: accounts.map((account) => ({
                label: [account.number, account.name].filter(Boolean).join(" "),
                value: account.id
              }))
            }
          }
        },
        {
          accessorKey: "description",
          header: t`Description`,
          cell: ({ row }) => (
            <span className="line-clamp-1 max-w-[320px]">
              {row.original.description ??
                row.original.journalDescription ??
                "—"}
            </span>
          ),
          meta: {
            icon: <LuFileText />,
            exportValue: (row) =>
              row.description ?? row.journalDescription ?? null
          }
        },
        {
          accessorKey: "sourceType",
          header: t`Source`,
          cell: ({ row }) => <Enumerable value={row.original.sourceType} />,
          meta: {
            icon: <LuTag />,
            filter: {
              type: "static",
              isArray: true,
              options: journalEntrySourceTypes.map((v) => ({
                label: <Enumerable value={v} />,
                value: v
              }))
            }
          }
        },
        {
          accessorKey: "documentType",
          header: t`Document Type`,
          cell: ({ row }) => <Enumerable value={row.original.documentType} />,
          meta: {
            icon: <LuTag />,
            filter: {
              type: "static",
              isArray: true,
              options: journalLineDocumentType.map((v) => ({
                label: <Enumerable value={v} />,
                value: v
              }))
            }
          }
        },
        {
          id: "debit",
          header: t`Debit`,
          cell: ({ row }) => {
            const debit = debitOf(row.original);
            return debit !== 0 ? currencyFormatter.format(debit) : "";
          },
          meta: {
            icon: <LuCircleDollarSign />,
            exportValue: debitOf
          }
        },
        {
          id: "credit",
          header: t`Credit`,
          cell: ({ row }) => {
            const credit = creditOf(row.original);
            return credit !== 0 ? currencyFormatter.format(credit) : "";
          },
          meta: {
            icon: <LuCircleDollarSign />,
            exportValue: creditOf
          }
        }
      ],
      [accounts, currencyFormatter, t]
    );

    return (
      <Table<GeneralLedgerLine>
        data={data}
        columns={columns}
        count={count}
        defaultColumnVisibility={defaultColumnVisibility}
        title={t`General Ledger`}
        // The page's Download exports every line of the period, not one page
        withCsvExport={false}
      />
    );
  }
);

GeneralLedgerTable.displayName = "GeneralLedgerTable";
export default GeneralLedgerTable;
