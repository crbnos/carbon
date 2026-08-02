import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { memo, useMemo } from "react";
import {
  LuBuilding2,
  LuCircleDollarSign,
  LuFileText,
  LuGitCompareArrows,
  LuStar
} from "react-icons/lu";
import { Table } from "~/components";
import {
  intercompanyDifferenceKinds,
  intercompanyTransactionStatuses
} from "../../accounting.models";
import IntercompanyDifferenceKind from "./IntercompanyDifferenceKind";
import IntercompanyTransactionStatus from "./IntercompanyTransactionStatus";

type IntercompanyTransaction = {
  id: string;
  sourceCompanyId: string;
  targetCompanyId: string;
  amount: number;
  currencyCode: string;
  description: string | null;
  status: string;
  documentType: string | null;
  differenceKind: string | null;
  matchedDifference: number | null;
  createdAt: string;
  sourceCompany: { name: string } | null;
  targetCompany: { name: string } | null;
};

type IntercompanyTransactionTableProps = {
  data: IntercompanyTransaction[];
  count: number;
  primaryAction?: ReactNode;
};

const IntercompanyTransactionTable = memo(
  ({ data, count, primaryAction }: IntercompanyTransactionTableProps) => {
    const { t } = useLingui();
    const columns = useMemo<ColumnDef<IntercompanyTransaction>[]>(() => {
      const defaultColumns: ColumnDef<IntercompanyTransaction>[] = [
        {
          accessorKey: "sourceCompany",
          header: t`Source`,
          cell: ({ row }) => row.original.sourceCompany?.name ?? "—",
          meta: {
            icon: <LuBuilding2 />
          }
        },
        {
          accessorKey: "targetCompany",
          header: t`Target`,
          cell: ({ row }) => row.original.targetCompany?.name ?? "—",
          meta: {
            icon: <LuBuilding2 />
          }
        },
        {
          accessorKey: "amount",
          header: t`Amount`,
          cell: ({ row }) => {
            const formatted = new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: row.original.currencyCode || "USD"
            }).format(row.original.amount);
            return formatted;
          },
          meta: {
            icon: <LuCircleDollarSign />
          }
        },
        {
          accessorKey: "description",
          header: t`Description`,
          cell: ({ row }) => (
            <div className="max-w-[240px] truncate">
              {row.original.description || row.original.documentType || "—"}
            </div>
          ),
          meta: {
            icon: <LuFileText />
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <IntercompanyTransactionStatus
              status={
                row.original
                  .status as (typeof intercompanyTransactionStatuses)[number]
              }
            />
          ),
          meta: {
            filter: {
              type: "static",
              options: intercompanyTransactionStatuses.map((v) => ({
                label: v,
                value: v
              }))
            },
            icon: <LuStar />
          }
        },
        {
          accessorKey: "differenceKind",
          header: t`Difference`,
          cell: ({ row }) => {
            if (!row.original.differenceKind) return "—";
            const diff = row.original.matchedDifference;
            return (
              <div className="flex items-center gap-2">
                <IntercompanyDifferenceKind
                  differenceKind={
                    row.original
                      .differenceKind as (typeof intercompanyDifferenceKinds)[number]
                  }
                />
                {diff != null ? (
                  <span className="text-xs text-muted-foreground">
                    {new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: row.original.currencyCode || "USD"
                    }).format(diff)}
                  </span>
                ) : null}
              </div>
            );
          },
          meta: {
            filter: {
              type: "static",
              options: intercompanyDifferenceKinds.map((v) => ({
                label: v,
                value: v
              }))
            },
            icon: <LuGitCompareArrows />
          }
        },
        {
          accessorKey: "createdAt",
          header: t`Created`,
          cell: ({ row }) =>
            new Date(row.original.createdAt).toLocaleDateString()
        }
      ];
      return defaultColumns;
    }, [t]);

    return (
      <Table<IntercompanyTransaction>
        data={data}
        columns={columns}
        count={count}
        primaryAction={primaryAction}
        title={t`Intercompany Transactions`}
      />
    );
  }
);

IntercompanyTransactionTable.displayName = "IntercompanyTransactionTable";
export default IntercompanyTransactionTable;
