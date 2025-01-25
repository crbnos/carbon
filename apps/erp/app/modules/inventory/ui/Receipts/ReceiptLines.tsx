import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Combobox,
  HStack,
  NumberField,
  NumberInput,
  VStack,
} from "@carbon/react";
import { Outlet, useFetcher, useFetchers, useParams } from "@remix-run/react";
import { useCallback } from "react";
import { Enumerable } from "~/components/Enumerable";
import { useShelves } from "~/components/Form/Shelf";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { TrackingTypeIcon } from "~/components/Icons";
import { useRouteData } from "~/hooks";
import type { Receipt, ReceiptLine } from "~/modules/inventory";
import type { action } from "~/routes/x+/receipt+/lines.update";
import { useItems } from "~/stores";
import { path } from "~/utils/path";

const ReceiptLines = () => {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const fetcher = useFetcher<typeof action>();

  const routeData = useRouteData<{
    receipt: Receipt;
    receiptLines: ReceiptLine[];
  }>(path.to.receipt(receiptId));

  const receiptsById = new Map<string, ReceiptLine>(
    routeData?.receiptLines.map((line) => [line.id, line])
  );
  const pendingItems = usePendingItems();

  for (let pendingItem of pendingItems) {
    let item = receiptsById.get(pendingItem.id);
    let merged = item ? { ...item, ...pendingItem } : pendingItem;
    receiptsById.set(pendingItem.id, merged as ReceiptLine);
  }

  const receiptLines = Array.from(receiptsById.values());

  const onUpdateReceiptLine = useCallback(
    async ({
      lineId,
      field,
      value,
    }:
      | {
          lineId: string;
          field: "receivedQuantity";
          value: number;
        }
      | {
          lineId: string;
          field: "shelfId";
          value: string;
        }) => {
      if (value === receiptLines.find((l) => l.id === lineId)?.[field]) {
        return;
      }
      const formData = new FormData();

      formData.append("ids", lineId);
      formData.append("field", field);
      formData.append("value", value.toString());
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateReceiptLine,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const isPosted = routeData?.receipt.status === "Posted";

  return (
    <>
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Receipt Lines</CardTitle>
          </CardHeader>
        </HStack>

        <CardContent>
          <div className="border rounded-lg">
            {receiptLines.map((line, index) => (
              <ReceiptLineItem
                key={line.id}
                line={line}
                isReadOnly={isPosted}
                onUpdate={onUpdateReceiptLine}
                className={
                  index === receiptLines.length - 1 ? "border-none" : ""
                }
              />
            ))}
          </div>
        </CardContent>
      </Card>
      <Outlet />
    </>
  );
};

function ReceiptLineItem({
  line,
  className,
  isReadOnly,
  onUpdate,
}: {
  line: ReceiptLine;
  className?: string;
  isReadOnly: boolean;
  onUpdate: ({
    lineId,
    field,
    value,
  }:
    | {
        lineId: string;
        field: "receivedQuantity";
        value: number;
      }
    | {
        lineId: string;
        field: "shelfId";
        value: string;
      }) => Promise<void>;
}) {
  const [items] = useItems();
  const item = items.find((p) => p.id === line.itemId);
  const unitsOfMeasure = useUnitOfMeasure();

  return (
    <div className={cn("border-b p-6", className)}>
      <div className="flex flex-1 justify-between items-center w-full">
        <HStack spacing={4} className="w-1/2">
          <HStack spacing={4} className="flex-1">
            <div className="bg-muted border rounded-full flex items-center justify-center p-2">
              <TrackingTypeIcon type={item?.itemTrackingType ?? "Inventory"} />
            </div>
            <VStack spacing={0}>
              <span className="text-sm font-medium">{item?.name}</span>
              <span className="text-xs text-muted-foreground line-clamp-2">
                {item?.readableId}
              </span>
              <div className="mt-2">
                <Enumerable
                  value={
                    unitsOfMeasure?.find((u) => u.value === line.unitOfMeasure)
                      ?.label ?? null
                  }
                />
              </div>
            </VStack>
            <span className="text-base text-muted-foreground">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">
                  Received
                </label>

                <NumberField
                  value={line.receivedQuantity}
                  onChange={(value) => {
                    onUpdate({
                      lineId: line.id,
                      field: "receivedQuantity",
                      value,
                    });
                  }}
                >
                  <NumberInput
                    className="disabled:bg-transparent disabled:opacity-100 min-w-[100px]"
                    isDisabled={isReadOnly}
                    size="sm"
                    min={0}
                  />
                </NumberField>
              </div>
              {line.outstandingQuantity < line.receivedQuantity && (
                <span className="text-xs text-red-500">
                  {line.outstandingQuantity - line.receivedQuantity} previously
                  received
                </span>
              )}
            </span>
          </HStack>
        </HStack>
        <div className="flex items-center justify-end gap-2">
          <Shelf
            locationId={line.locationId}
            shelfId={line.shelfId}
            isReadOnly={isReadOnly}
            onChange={(shelf) => {
              onUpdate({
                lineId: line.id,
                field: "shelfId",
                value: shelf,
              });
            }}
          />
        </div>
      </div>
    </div>
  );
}

function Shelf({
  locationId,
  shelfId,
  isReadOnly,
  onChange,
}: {
  locationId: string | null;
  shelfId: string | null;
  isReadOnly: boolean;
  onChange: (shelf: string) => void;
}) {
  const { options } = useShelves(locationId ?? undefined);

  if (!locationId) return null;

  return (
    <div className="flex flex-col items-start gap-1 min-w-[140px]">
      <label className="text-xs text-muted-foreground">Shelf</label>
      <Combobox
        value={shelfId ?? undefined}
        onChange={(newValue) => {
          onChange(newValue);
        }}
        options={options}
        isReadOnly={isReadOnly}
        inline={(value, options) => {
          const option = options.find((o) => o.value === value);
          return option?.label ?? "";
        }}
      />
    </div>
  );
}

const usePendingItems = () => {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };

  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return fetcher.formAction === path.to.bulkUpdateReceiptLine;
    })
    .reduce<{ id: string; [key: string]: string | null }[]>((acc, fetcher) => {
      const lineId = fetcher.formData.get("ids") as string;
      const field = fetcher.formData.get("field") as string;
      const value = fetcher.formData.get("value") as string;

      if (lineId && field && value) {
        const newItem: { id: string; [key: string]: string | null } = {
          id: lineId,
          [field]: value,
        };
        return [...acc, newItem];
      }
      return acc;
    }, []);
};

export default ReceiptLines;
