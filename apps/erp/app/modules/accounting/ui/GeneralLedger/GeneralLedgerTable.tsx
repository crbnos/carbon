import { formatDate, toDisplayCredit, toDisplayDebit } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { memo, useMemo } from "react";
import {
  LuBookmark,
  LuCalendar,
  LuCircleDollarSign,
  LuFileText,
  LuTag
} from "react-icons/lu";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import type { AccountClass, GeneralLedgerLine } from "~/modules/accounting";
import { path } from "~/utils/path";

type GeneralLedgerTableProps = {
  data: GeneralLedgerLine[];
  count: number;
  openingBalance: number | null;
  // Running balance is meaningful only for a single account on the first page in
  // posting-date order — otherwise the cumulative seed is unknown.
  showRunningBalance: boolean;
  primaryAction?: ReactNode;
};

// Flat row so the shared Table's CSV export has clean, underscore-free columns.
type Row = {
  id: string;
  postingDate: string;
  entryId: string;
  journalId: string;
  status: string;
  source: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number | null;
};

function formatAmount(value: number): string {
  if (!value) return "-";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

const GeneralLedgerTable = memo(
  ({
    data,
    count,
    openingBalance,
    showRunningBalance,
    primaryAction
  }: GeneralLedgerTableProps) => {
    const { t } = useLingui();

    const rows = useMemo<Row[]>(() => {
      let running = openingBalance ?? 0;
      const result: Row[] = [];
      if (showRunningBalance && openingBalance !== null) {
        result.push({
          id: "__opening__",
          postingDate: "",
          entryId: "",
          journalId: "",
          status: "",
          source: "",
          description: "Opening balance",
          debit: 0,
          credit: 0,
          runningBalance: running
        });
      }
      for (const line of data) {
        const accountClass = (line.account?.class ?? "Asset") as AccountClass;
        // journalLine.amount is class-normal signed (positive = natural direction),
        // so the running natural balance accumulates it directly.
        running += line.amount;
        result.push({
          id: line.id,
          postingDate: line.journal?.postingDate ?? "",
          entryId: line.journal?.journalEntryId ?? "",
          journalId: line.journal?.id ?? "",
          status: line.journal?.status ?? "",
          source: line.journal?.sourceType ?? "",
          description: line.description ?? line.journal?.description ?? "",
          debit: toDisplayDebit(line.amount, accountClass),
          credit: toDisplayCredit(line.amount, accountClass),
          runningBalance: showRunningBalance ? running : null
        });
      }
      return result;
    }, [data, openingBalance, showRunningBalance]);

    const columns = useMemo<ColumnDef<Row>[]>(() => {
      const cols: ColumnDef<Row>[] = [
        {
          accessorKey: "postingDate",
          header: t`Date`,
          cell: ({ row }) =>
            row.original.postingDate
              ? formatDate(row.original.postingDate)
              : "",
          meta: { icon: <LuCalendar /> }
        },
        {
          accessorKey: "entryId",
          header: t`Journal`,
          cell: ({ row }) =>
            row.original.journalId ? (
              <Hyperlink
                to={path.to.journalEntryDetails(row.original.journalId)}
              >
                {row.original.entryId}
              </Hyperlink>
            ) : null,
          meta: { icon: <LuBookmark /> }
        },
        {
          accessorKey: "source",
          header: t`Source`,
          cell: ({ row }) =>
            row.original.source ? (
              <Enumerable value={row.original.source} />
            ) : null,
          meta: { icon: <LuTag /> }
        },
        {
          accessorKey: "description",
          header: t`Description`,
          cell: ({ row }) => (
            <span className="line-clamp-1">{row.original.description}</span>
          ),
          meta: { icon: <LuFileText /> }
        },
        {
          accessorKey: "debit",
          header: t`Debit`,
          cell: ({ row }) => (
            <span className="tabular-nums">
              {formatAmount(row.original.debit)}
            </span>
          ),
          size: 130,
          meta: {
            icon: <LuCircleDollarSign />,
            renderTotal: true,
            formatter: (val) => formatAmount(Number(val))
          }
        },
        {
          accessorKey: "credit",
          header: t`Credit`,
          cell: ({ row }) => (
            <span className="tabular-nums">
              {formatAmount(row.original.credit)}
            </span>
          ),
          size: 130,
          meta: {
            icon: <LuCircleDollarSign />,
            renderTotal: true,
            formatter: (val) => formatAmount(Number(val))
          }
        }
      ];
      if (showRunningBalance) {
        cols.push({
          accessorKey: "runningBalance",
          header: t`Running Balance`,
          cell: ({ row }) => (
            <span className="tabular-nums">
              {row.original.runningBalance != null
                ? formatAmount(row.original.runningBalance)
                : ""}
            </span>
          ),
          size: 150,
          meta: { icon: <LuCircleDollarSign /> }
        });
      }
      return cols;
    }, [showRunningBalance, t]);

    return (
      <Table<Row>
        data={rows}
        columns={columns}
        count={count + (showRunningBalance && openingBalance !== null ? 1 : 0)}
        withSimpleSorting={false}
        title={t`General Ledger`}
        primaryAction={primaryAction}
      />
    );
  }
);

GeneralLedgerTable.displayName = "GeneralLedgerTable";
export default GeneralLedgerTable;
