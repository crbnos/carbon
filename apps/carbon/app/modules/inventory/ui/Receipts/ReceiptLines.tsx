import { useCarbon } from "@carbon/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
} from "@carbon/react";
import { Outlet, useParams } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo } from "react";
import { EditableNumber } from "~/components/Editable";
import Grid from "~/components/Grid";
import { useRealtime, useRouteData } from "~/hooks";
import type { Receipt, ReceiptLine } from "~/modules/inventory";
import { useItems } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

const ReceiptLines = () => {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const { carbon } = useCarbon();
  useRealtime("receiptLine", `receiptId=eq.${receiptId}`);
  const sharedReceiptData = useRouteData<{
    locations: ListItem[];
    shelves: ListItem[];
  }>(path.to.receiptRoot);

  const routeData = useRouteData<{
    receipt: Receipt;
    receiptLines: ReceiptLine[];
  }>(path.to.receipt(receiptId));

  const [items] = useItems();

  const receiptLineColumns = useMemo<ColumnDef<ReceiptLine>[]>(() => {
    return [
      {
        header: "Part",
        cell: ({ row }) => {
          return (
            items.find((p) => p.id === row.original.itemId)?.readableId ?? null
          );
        },
      },
      {
        header: "Name",
        cell: ({ row }) => {
          return items.find((p) => p.id === row.original.itemId)?.name ?? null;
        },
      },
      {
        accessorKey: "receivedQuantity",
        header: "Received Quantity",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "unitOfMeasure",
        header: "Unit of Measure",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "orderQuantity",
        header: "Order Quantity",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "outstandingQuantity",
        header: "Outstanding Quantity",
        cell: (item) => item.getValue(),
      },

      {
        accessorKey: "locationId",
        header: "Location",
        cell: ({ row }) =>
          sharedReceiptData?.locations?.find(
            (l) => l.id === row.original.locationId
          )?.name ?? null,
      },
      {
        accessorKey: "shelfId",
        header: "Shelf",
        cell: ({ row }) => {
          return (
            sharedReceiptData?.shelves?.find(
              (s) => s.id === row.original.shelfId
            )?.name ?? null
          );
        },
      },
    ];
  }, [items, sharedReceiptData?.locations, sharedReceiptData?.shelves]);

  const onCellEdit = useCallback(
    async (id: string, value: unknown, row: ReceiptLine) => {
      if (!carbon) throw new Error("Carbon client not found");
      return await carbon
        .from("receiptLine")
        .update({
          [id]: value,
        })
        .eq("id", row.id);
    },
    [carbon]
  );

  const receiptLineEditableComponents = useMemo(
    () => ({
      receivedQuantity: EditableNumber(onCellEdit),
    }),
    [onCellEdit]
  );

  const isPosted = routeData?.receipt.status === "Posted";

  return (
    <>
      <Card className="w-full h-full min-h-[50vh]">
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Receipt Lines</CardTitle>
          </CardHeader>
        </HStack>

        <CardContent>
          <Grid<ReceiptLine>
            data={routeData?.receiptLines ?? []}
            columns={receiptLineColumns}
            canEdit={!isPosted}
            editableComponents={receiptLineEditableComponents}
          />
        </CardContent>
      </Card>
      <Outlet />
    </>
  );
};

export default ReceiptLines;
