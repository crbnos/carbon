import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { operationTypes } from "~/modules/shared";
import { useParts, useTools } from "~/stores";
import type { MethodOperation } from "../../types";
import { getPathToMakeMethod } from "./utils";

type MethodOperationsTableProps = {
  data: MethodOperation[];
  count: number;
};

const MethodOperationsTable = memo(
  ({ data, count }: MethodOperationsTableProps) => {
    const parts = useParts();
    const tools = useTools();

    const items = useMemo(() => [...parts, ...tools], [parts, tools]);

    const columns = useMemo<ColumnDef<MethodOperation>[]>(() => {
      return [
        {
          accessorKey: "description",
          header: "Description",
          cell: ({ row }) => (
            <Hyperlink
              to={getPathToMakeMethod(
                // @ts-ignore
                row.original.makeMethod?.item?.type,
                // @ts-ignore
                row.original.makeMethod?.item?.id
              )}
              className="max-w-[260px] truncate"
            >
              {row.original.description}
            </Hyperlink>
          ),
        },
        {
          accessorKey: "makeMethod.item.readableId",
          header: "Item ID",
          cell: ({ row }) => {
            // @ts-ignore
            return row.original.makeMethod?.item?.readableId;
          },
          meta: {
            filter: {
              type: "static",
              options: items?.map((item) => ({
                value: item.readableId,
                label: item.readableId,
              })),
            },
          },
        },
        {
          accessorKey: "operationType",
          header: "Operation Type",
          cell: (item) => (
            <Enumerable value={item.getValue<string>() ?? null} />
          ),
          meta: {
            filter: {
              type: "static",
              options: operationTypes.map((value) => ({
                value,
                label: <Enumerable value={value ?? null} />,
              })),
            },
          },
        },
        {
          accessorKey: "setupTime",
          header: "Setup Time",
          cell: ({ row }) => {
            return `${row.original.setupTime} ${row.original.setupUnit}`;
          },
        },
        {
          accessorKey: "laborTime",
          header: "Labor Time",
          cell: ({ row }) => {
            return `${row.original.laborTime} ${row.original.laborUnit}`;
          },
        },
        {
          accessorKey: "machineTime",
          header: "Machine Time",
          cell: ({ row }) => {
            return `${row.original.machineTime} ${row.original.machineUnit}`;
          },
        },
      ];
    }, [items]);

    return (
      <Table<MethodOperation> count={count} columns={columns} data={data} />
    );
  }
);

MethodOperationsTable.displayName = "MethodOperationsTable";

export default MethodOperationsTable;
