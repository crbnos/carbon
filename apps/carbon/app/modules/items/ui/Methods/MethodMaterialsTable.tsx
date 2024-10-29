import { Badge, HStack } from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { Hyperlink, MethodIcon, MethodItemTypeIcon, Table } from "~/components";
import { methodItemType, methodType } from "~/modules/shared";
import { useFixtures, useParts } from "~/stores";
import type { MethodMaterial } from "../../types";
import { getPathToMakeMethod } from "./utils";

type MethodMaterialsTableProps = {
  data: MethodMaterial[];
  count: number;
};

const MethodMaterialsTable = memo(
  ({ data, count }: MethodMaterialsTableProps) => {
    const parts = useParts();
    const fixtures = useFixtures();

    const items = useMemo(() => [...parts, ...fixtures], [parts, fixtures]);

    const columns = useMemo<ColumnDef<MethodMaterial>[]>(() => {
      return [
        {
          accessorKey: "makeMethod.item.readableId",
          header: "Method Id",
          cell: ({ row }) => (
            <HStack className="py-1">
              <Hyperlink
                to={getPathToMakeMethod(
                  // @ts-ignore
                  row.original.makeMethod?.item?.type,
                  // @ts-ignore
                  row.original.makeMethod?.item?.id
                )}
                className="max-w-[260px] truncate"
              >
                {/* @ts-ignore */}
                {row.original.makeMethod?.item?.readableId}
              </Hyperlink>
            </HStack>
          ),
        },
        {
          accessorKey: "itemReadableId",
          header: "Material ID",
          cell: (item) => item.getValue(),
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
          accessorKey: "item.name",
          header: "Description",
          cell: ({ row }) => row.original.item?.name,
        },
        {
          accessorKey: "methodType",
          header: "Method Type",
          cell: (item) => (
            <Badge variant="secondary">
              <MethodIcon type={item.getValue<string>()} className="mr-2" />
              <span>{item.getValue<string>()}</span>
            </Badge>
          ),
          meta: {
            filter: {
              type: "static",
              options: methodType.map((value) => ({
                value,
                label: (
                  <Badge variant="secondary">
                    <MethodIcon type={value} className="mr-2" />
                    <span>{value}</span>
                  </Badge>
                ),
              })),
            },
          },
        },
        {
          accessorKey: "itemType",
          header: "Type",
          cell: ({ row }) => (
            <Badge variant="secondary">
              <MethodItemTypeIcon
                type={row.original.itemType}
                className="mr-2"
              />
              <span>{row.original.itemType}</span>
            </Badge>
          ),
          meta: {
            filter: {
              type: "static",
              options: methodItemType.map((type) => ({
                label: (
                  <HStack spacing={2}>
                    <MethodItemTypeIcon type={type} />
                    <span>{type}</span>
                  </HStack>
                ),
                value: type,
              })),
            },
          },
        },

        {
          accessorKey: "unitOfMeasureCode",
          header: "UoM",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "quantity",
          header: "Qty. per Parent",
          cell: (item) => item.getValue(),
        },
      ];
    }, [items]);

    return (
      <Table<MethodMaterial> count={count} columns={columns} data={data} />
    );
  }
);

MethodMaterialsTable.displayName = "MethodMaterialsTable";

export default MethodMaterialsTable;
