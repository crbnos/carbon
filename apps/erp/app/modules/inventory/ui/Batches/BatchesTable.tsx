import { Badge, MenuIcon, MenuItem, VStack } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { AiOutlinePartition } from "react-icons/ai";
import {
  LuBookMarked,
  LuCalendar,
  LuContainer,
  LuPencil,
  LuTruck,
} from "react-icons/lu";
import { Hyperlink, SupplierAvatar, Table } from "~/components";
import { usePermissions } from "~/hooks";
import type { BatchTableRow } from "~/modules/inventory";
import { useItems, useSuppliers } from "~/stores";
import { path } from "~/utils/path";

type BatchesTableProps = {
  data: BatchTableRow[];
  count: number;
};

const BatchesTable = memo(({ data, count }: BatchesTableProps) => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [items] = useItems();
  const [suppliers] = useSuppliers();

  const columns = useMemo<ColumnDef<BatchTableRow>[]>(() => {
    const result: ColumnDef<BatchTableRow>[] = [
      {
        accessorKey: "batchId",
        header: "Batch ID",
        cell: ({ row }) => (
          <Hyperlink to={path.to.batch(row.original.id!)}>
            {row.original.number}
          </Hyperlink>
        ),
        meta: {
          icon: <LuBookMarked />,
        },
      },
      {
        accessorKey: "itemId",
        header: "Item",
        cell: ({ row }) => (
          <VStack spacing={0}>
            <span className="text-sm font-medium">{row.original.itemName}</span>
            <span className="text-sm text-muted-foreground">
              {row.original.itemReadableId}
            </span>
          </VStack>
        ),
        meta: {
          icon: <AiOutlinePartition />,
          filter: {
            type: "static",
            options: items.map((item) => ({
              value: item.id,
              label: item.readableId,
              helperText: item.name,
            })),
          },
        },
      },
      {
        accessorKey: "source",
        header: "Source",
        cell: ({ row }) =>
          row.original.source === "Purchased" ? (
            <Badge variant="green">Purchased</Badge>
          ) : (
            <Badge variant="blue">Manufactured</Badge>
          ),
        meta: {
          icon: <LuTruck />,
          filter: {
            type: "static",
            options: [
              { value: "Purchased", label: "Purchased" },
              { value: "Manufactured", label: "Manufactured" },
            ],
          },
        },
      },
      {
        accessorKey: "supplierId",
        header: "Supplier",
        cell: ({ row }) => (
          <SupplierAvatar supplierId={row.original.supplierId} />
        ),
        meta: {
          icon: <LuContainer />,
          filter: {
            type: "static",
            options: suppliers.map((supplier) => ({
              value: supplier.id,
              label: supplier.name,
            })),
          },
        },
      },
      {
        accessorKey: "manufacturingDate",
        header: "Manufactured Date",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />,
        },
      },
      {
        accessorKey: "expirationDate",
        header: "Expiry Date",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />,
        },
      },
    ];

    return result;
  }, [items, suppliers]);

  const renderContextMenu = useCallback(
    (row: BatchTableRow) => {
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "inventory")}
            onClick={() => {
              navigate(`${path.to.batch(row.id!)}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            View Batch
          </MenuItem>
        </>
      );
    },
    [navigate, permissions]
  );

  return (
    <>
      <Table<BatchTableRow>
        data={data}
        columns={columns}
        count={count}
        defaultColumnPinning={{
          left: ["batchId"],
        }}
        renderContextMenu={renderContextMenu}
        title="Batches"
        table="batchNumber"
        withSavedView
      />
    </>
  );
});

BatchesTable.displayName = "BatchesTable";
export default BatchesTable;
