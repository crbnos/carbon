import { VStack } from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { LuHash, LuPackage, LuMapPin } from "react-icons/lu";
import { Table } from "~/components";
import type { WarehouseTransferLine } from "../../types";

type WarehouseTransferLinesProps = {
  warehouseTransferLines: WarehouseTransferLine[];
  transferId: string;
};

const WarehouseTransferLines = ({ warehouseTransferLines }: WarehouseTransferLinesProps) => {
  const columns = useMemo<ColumnDef<WarehouseTransferLine>[]>(() => [
    {
      accessorKey: "itemReadableId",
      header: "Item",
      cell: ({ row }) => row.original.item?.readableIdWithRevision || row.original.itemReadableId || "N/A",
      meta: {
        icon: <LuPackage />,
      },
    },
    {
      id: "itemName",
      header: "Item Name",
      cell: ({ row }) => row.original.item?.name || "N/A",
      meta: {
        icon: <LuHash />,
      },
    },
    {
      accessorKey: "quantity",
      header: "Quantity",
      cell: ({ row }) => {
        const quantity = Number(row.original.quantity);
        return quantity.toLocaleString();
      },
      meta: {
        icon: <LuHash />,
      },
    },
    {
      accessorKey: "shippedQuantity",
      header: "Shipped",
      cell: ({ row }) => {
        const quantity = Number(row.original.shippedQuantity || 0);
        return quantity.toLocaleString();
      },
      meta: {
        icon: <LuHash />,
      },
    },
    {
      accessorKey: "receivedQuantity",
      header: "Received",
      cell: ({ row }) => {
        const quantity = Number(row.original.receivedQuantity || 0);
        return quantity.toLocaleString();
      },
      meta: {
        icon: <LuHash />,
      },
    },
    {
      id: "fromShelf",
      header: "From Shelf",
      cell: ({ row }) => row.original.fromShelf?.name || "N/A",
      meta: {
        icon: <LuMapPin />,
      },
    },
    {
      id: "toShelf",
      header: "To Shelf", 
      cell: ({ row }) => row.original.toShelf?.name || "N/A",
      meta: {
        icon: <LuMapPin />,
      },
    },
    {
      accessorKey: "unitOfMeasureCode",
      header: "UoM",
      cell: ({ row }) => row.original.unitOfMeasureCode || "N/A",
      meta: {
        icon: <LuHash />,
      },
    },
    {
      accessorKey: "notes",
      header: "Notes",
      cell: ({ row }) => row.original.notes || "",
      meta: {
        icon: <LuHash />,
      },
    },
  ], []);

  return (
    <VStack spacing={4} className="w-full">
      <Table<WarehouseTransferLine>
        data={warehouseTransferLines}
        columns={columns}
        count={warehouseTransferLines.length}
        title="Transfer Lines"
        defaultColumnVisibility={{
          notes: false,
        }}
      />
    </VStack>
  );
};

export default WarehouseTransferLines;