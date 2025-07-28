import { Card, CardContent, CardHeader, CardTitle, cn } from "@carbon/react";
import { Outlet, useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { ItemThumbnail } from "~/components";
import {
  EditableList,
  EditableNumber,
} from "~/components/Editable";
import { useShelves } from "~/components/Form/Shelf";
import Grid from "~/components/Grid";
import type { WarehouseTransfer, WarehouseTransferLine } from "../../types";
import { useItems } from "~/stores";
import { getItemReadableId } from "~/utils/items";
import useWarehouseTransferLines from "./useWarehouseTransferLines";

type WarehouseTransferLinesProps = {
  warehouseTransferLines: WarehouseTransferLine[];
  transferId: string;
  warehouseTransfer: WarehouseTransfer;
  compact?: boolean;
};

type TransferLine = Pick<
  WarehouseTransferLine,
  | "id"
  | "itemId"
  | "quantity"
  | "fromShelfId"
  | "toShelfId"
  | "unitOfMeasureCode"
  | "notes"
  | "customFields"
> & {
  itemReadableId: string;
  fromShelf?: { id: string; name: string } | null;
  toShelf?: { id: string; name: string } | null;
};

const WarehouseTransferLines = ({
  warehouseTransferLines,
  transferId,
  warehouseTransfer,
  compact = false,
}: WarehouseTransferLinesProps) => {
  const navigate = useNavigate();
  const [items] = useItems();
  const { canEdit, onCellEdit } = useWarehouseTransferLines(warehouseTransfer);

  const { options: fromShelfOptions } = useShelves(warehouseTransfer.fromLocationId);
  const { options: toShelfOptions } = useShelves(warehouseTransfer.toLocationId);

  const linesWithReadableIds: TransferLine[] = warehouseTransferLines
    .map((line) => ({
      id: line.id,
      itemId: line.itemId,
      quantity: line.quantity,
      fromShelfId: line.fromShelfId,
      toShelfId: line.toShelfId,
      unitOfMeasureCode: line.unitOfMeasureCode,
      notes: line.notes,
      customFields: line.customFields,
      itemReadableId: getItemReadableId(items, line.itemId) ?? "",
      fromShelf: line.fromShelf,
      toShelf: line.toShelf,
    }))
    .sort((a, b) => a.itemReadableId.localeCompare(b.itemReadableId));

  const columns = useMemo<ColumnDef<TransferLine>[]>(() => {
    const defaultColumns: ColumnDef<TransferLine>[] = [
      {
        accessorKey: "itemId",
        header: "Item",
        cell: ({ row }) => {
          const item = items.find((p) => p.id === row.original.itemId);
          return (
            <div className="flex items-center space-x-3">
              <ItemThumbnail
                size="sm"
                thumbnailPath={item?.thumbnailPath}
                type={(item?.type as "Part") ?? "Part"}
              />
              <div className="max-w-[280px]">
                <div className="font-medium truncate">{item?.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {item?.readableIdWithRevision}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "quantity",
        header: "Quantity",
        cell: (item) => Number(item.getValue<number>()).toLocaleString(),
      },
      {
        accessorKey: "fromShelfId",
        header: "From Shelf",
        cell: ({ row }) => row.original.fromShelf?.name || "N/A",
      },
      {
        accessorKey: "toShelfId",
        header: "To Shelf", 
        cell: ({ row }) => row.original.toShelf?.name || "N/A",
      },
      {
        accessorKey: "unitOfMeasureCode",
        header: "UoM",
        cell: (item) => item.getValue(),
      },
    ];
    return defaultColumns;
  }, [items]);

  const editableComponents = useMemo(
    () => ({
      quantity: EditableNumber(onCellEdit),
      fromShelfId: EditableList(onCellEdit, fromShelfOptions),
      toShelfId: EditableList(onCellEdit, toShelfOptions),
    }),
    [onCellEdit, fromShelfOptions, toShelfOptions]
  );

  return (
    <>
      <Card className={cn(compact && "border-none p-0 dark:shadow-none")}>
        <CardHeader className={cn(compact && "px-0")}>
          <CardTitle>Transfer Lines</CardTitle>
        </CardHeader>
        <CardContent className={cn(compact && "px-0")}>
          <Grid<TransferLine>
            contained={false}
            data={linesWithReadableIds}
            columns={columns}
            canEdit={canEdit}
            editableComponents={editableComponents}
            onNewRow={canEdit ? () => navigate("new") : undefined}
          />
        </CardContent>
      </Card>
      <Outlet />
    </>
  );
};


export default WarehouseTransferLines;