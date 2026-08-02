import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuBuilding2,
  LuCalendar,
  LuCircleDollarSign,
  LuHash,
  LuStar
} from "react-icons/lu";
import { Hyperlink, Table } from "~/components";
import { useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import { nettingStatementStatuses } from "../../accounting.models";
import NettingStatementStatus from "./NettingStatementStatus";

type NettingStatement = {
  id: string;
  statementId: string;
  currencyCode: string;
  nettedAmount: number;
  residualAmount: number;
  status: string;
  createdAt: string;
  companyA: { name: string } | null;
  companyB: { name: string } | null;
};

type NettingStatementsTableProps = {
  data: NettingStatement[];
  count: number;
};

const NettingStatementsTable = memo(
  ({ data, count }: NettingStatementsTableProps) => {
    const { t } = useLingui();
    const [params] = useUrlParams();

    const columns = useMemo<ColumnDef<NettingStatement>[]>(() => {
      return [
        {
          accessorKey: "statementId",
          header: t`Statement`,
          cell: ({ row }) => (
            <Hyperlink
              to={`${path.to.intercompanyNettingStatement(row.original.id)}?${params.toString()}`}
            >
              {row.original.statementId}
            </Hyperlink>
          ),
          meta: {
            icon: <LuHash />
          }
        },
        {
          accessorKey: "companyA",
          header: t`Company A`,
          cell: ({ row }) => row.original.companyA?.name ?? "—",
          meta: {
            icon: <LuBuilding2 />
          }
        },
        {
          accessorKey: "companyB",
          header: t`Company B`,
          cell: ({ row }) => row.original.companyB?.name ?? "—",
          meta: {
            icon: <LuBuilding2 />
          }
        },
        {
          accessorKey: "nettedAmount",
          header: t`Netted`,
          cell: ({ row }) =>
            new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: row.original.currencyCode || "USD"
            }).format(row.original.nettedAmount),
          meta: {
            icon: <LuCircleDollarSign />
          }
        },
        {
          accessorKey: "residualAmount",
          header: t`Residual`,
          cell: ({ row }) =>
            new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: row.original.currencyCode || "USD"
            }).format(row.original.residualAmount),
          meta: {
            icon: <LuCircleDollarSign />
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <NettingStatementStatus
              status={
                row.original.status as (typeof nettingStatementStatuses)[number]
              }
            />
          ),
          meta: {
            filter: {
              type: "static",
              options: nettingStatementStatuses.map((v) => ({
                label: v,
                value: v
              }))
            },
            icon: <LuStar />
          }
        },
        {
          accessorKey: "createdAt",
          header: t`Created`,
          cell: ({ row }) =>
            new Date(row.original.createdAt).toLocaleDateString(),
          meta: {
            icon: <LuCalendar />
          }
        }
      ];
    }, [t, params]);

    return (
      <Table<NettingStatement>
        data={data}
        columns={columns}
        count={count}
        title={t`Netting Statements`}
      />
    );
  }
);

NettingStatementsTable.displayName = "NettingStatementsTable";
export default NettingStatementsTable;
