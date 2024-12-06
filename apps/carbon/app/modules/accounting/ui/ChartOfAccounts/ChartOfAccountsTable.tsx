import { Button, Checkbox, HStack, cn } from "@carbon/react";
import { Link as RemixLink } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { LuMoreVertical } from "react-icons/lu";
import { Hyperlink } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import Grid from "~/components/Grid";
import { useRealtime } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { Chart } from "~/modules/accounting";

type ChartOfAccountsTableProps = {
  data: Chart[];
};

const ChartOfAccountsTable = memo(({ data }: ChartOfAccountsTableProps) => {
  useRealtime("journal");

  const customColumns = useCustomColumns<Chart>("journal");

  const columns = useMemo<ColumnDef<Chart>[]>(() => {
    const defaultColumns: ColumnDef<Chart>[] = [
      {
        accessorKey: "number",
        header: "Number",
        cell: ({ row }) => {
          const isPosting = row.original.type === "Posting";

          return (
            <HStack>
              <Hyperlink
                to={row.original.id as string}
                className={cn(!isPosting && "font-bold")}
              >
                {row.original.number}
              </Hyperlink>

              <div className="relative w-6 h-6">
                <Button
                  asChild
                  isIcon
                  variant="ghost"
                  className="absolute right-[-3px] top-[-3px] outline-none border-none active:outline-none focus-visible:outline-none"
                  aria-label="Edit account"
                  onClick={(e) => e.stopPropagation()}
                >
                  <RemixLink to={`${row.original.id}`}>
                    <LuMoreVertical />
                  </RemixLink>
                </Button>
              </div>
            </HStack>
          );
        },
      },
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => {
          const isPosting = row.original.type === "Posting";
          return (
            <div
              className={cn(!isPosting && "font-bold")}
              style={{ paddingLeft: `calc(${0.75 * row.original.level}rem)` }}
            >
              {row.original.name}
            </div>
          );
        },
      },
      {
        accessorKey: "netChange",
        header: "Net Change",
        cell: ({ row }) => {
          const hasValue = ["Posting", "End Total", "Total"].includes(
            row.original.type
          );
          return hasValue ? (row.original.netChange ?? 0).toFixed(2) : null;
        },
      },
      {
        accessorKey: "balanceAtDate",
        header: "Balance at Date",
        cell: ({ row }) => {
          const hasValue = ["Posting", "End Total", "Total"].includes(
            row.original.type
          );
          return hasValue ? (row.original.balanceAtDate ?? 0).toFixed(2) : null;
        },
      },
      {
        accessorKey: "balance",
        header: "Balance",
        cell: ({ row }) => {
          const hasValue = ["Posting", "End Total", "Total"].includes(
            row.original.type
          );
          return hasValue ? (row.original.balance ?? 0).toFixed(2) : null;
        },
      },
      {
        accessorKey: "incomeBalance",
        header: "Income/Balance",
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
      },
      {
        accessorKey: "type",
        header: "Account Type",
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
      },
      {
        accessorKey: "totaling",
        header: "Totaling",
        cell: ({ row }) => row.original.totaling ?? "",
      },
      {
        accessorKey: "accountCategory",
        header: "Account Category",
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
      },
      {
        accessorKey: "accountSubCategory",
        header: "Account Subcategory",
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
      },
      {
        accessorKey: "directPosting",
        header: "Direct Posting",
        cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
      },
    ];

    return [...defaultColumns, ...customColumns];
  }, [customColumns]);

  return <Grid<Chart> data={data} columns={columns} withSimpleSorting />;
});

ChartOfAccountsTable.displayName = "ChartOfAccountsTable";
export default ChartOfAccountsTable;
