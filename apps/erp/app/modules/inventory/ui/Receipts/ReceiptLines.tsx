import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Combobox,
  HStack,
  NumberField,
  NumberInput,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack,
} from "@carbon/react";
import { Outlet, useFetcher, useFetchers, useParams } from "@remix-run/react";
import { useCallback } from "react";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useShelves } from "~/components/Form/Shelf";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
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

  const [items] = useItems();
  const unitsOfMeasure = useUnitOfMeasure();
  const locations = useLocations();

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
          <Table>
            <Thead>
              <Tr>
                <Th>Part</Th>
                <Th>Received</Th>
                <Th>Shelf</Th>
                <Th>Location</Th>
                <Th>UoM</Th>
                <Th>Ordered</Th>
                <Th>Outstanding</Th>
              </Tr>
            </Thead>
            <Tbody>
              {receiptLines.map((line) => (
                <Tr key={line.id}>
                  <Td>
                    <VStack spacing={0}>
                      <span>
                        {items.find((p) => p.id === line.itemId)?.readableId}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {items.find((p) => p.id === line.itemId)?.name}
                      </span>
                    </VStack>
                  </Td>

                  <Td>
                    <ReceivedQuantity
                      value={line.receivedQuantity}
                      isReadOnly={isPosted}
                      onChange={(value) => {
                        onUpdateReceiptLine({
                          lineId: line.id,
                          field: "receivedQuantity",
                          value,
                        });
                      }}
                    />
                  </Td>
                  <Td>
                    <Shelf
                      locationId={line.locationId}
                      shelfId={line.shelfId}
                      isReadOnly={isPosted}
                      onChange={(shelf) => {
                        onUpdateReceiptLine({
                          lineId: line.id,
                          field: "shelfId",
                          value: shelf,
                        });
                      }}
                    />
                  </Td>
                  <Td>
                    <Enumerable
                      value={
                        locations?.find((l) => l.value === line.locationId)
                          ?.label ?? null
                      }
                    />
                  </Td>

                  <Td>
                    <Enumerable
                      value={
                        unitsOfMeasure?.find(
                          (u) => u.value === line.unitOfMeasure
                        )?.label ?? null
                      }
                    />
                  </Td>
                  <Td>{line.orderQuantity}</Td>
                  <Td>{line.outstandingQuantity}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </CardContent>
      </Card>
      <Outlet />
    </>
  );
};

function ReceivedQuantity({
  value,
  onChange,
  isReadOnly,
}: {
  value: number;
  onChange: (value: number) => void;
  isReadOnly: boolean;
}) {
  return (
    <NumberField
      value={value}
      onChange={(value) => {
        onChange(value);
      }}
    >
      <NumberInput
        className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100 min-w-[100px]"
        isDisabled={isReadOnly}
        size="sm"
        min={0}
      />
    </NumberField>
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
    <div className="min-w-[140px]">
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
