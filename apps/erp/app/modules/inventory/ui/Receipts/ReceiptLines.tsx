import { useCarbon } from "@carbon/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Combobox,
  HStack,
  Input,
  NumberField,
  NumberInput,
  toast,
  VStack,
} from "@carbon/react";
import {
  Await,
  Outlet,
  useFetcher,
  useFetchers,
  useParams,
  useRevalidator,
  useSubmit,
} from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { Suspense, useCallback, useState } from "react";
import { LuBarcode, LuGroup } from "react-icons/lu";
import { Enumerable } from "~/components/Enumerable";
import FileDropzone from "~/components/FileDropzone";
import { useShelves } from "~/components/Form/Shelf";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { TrackingTypeIcon } from "~/components/Icons";
import { useRouteData, useUser } from "~/hooks";
import type { Receipt, ReceiptLine } from "~/modules/inventory";
import type { action } from "~/routes/x+/receipt+/lines.update";
import { useItems } from "~/stores";
import type { StorageItem } from "~/types";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

const ReceiptLines = () => {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const fetcher = useFetcher<typeof action>();
  const { upload, deleteFile } = useReceiptFiles(receiptId);
  const routeData = useRouteData<{
    receipt: Receipt;
    receiptLines: ReceiptLine[];
    receiptFiles: PostgrestResponse<StorageItem>;
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
  const [serialNumbersByLineId, setSerialNumbersByLineId] = useState<
    Record<string, string[]>
  >(() => {
    return receiptLines.reduce(
      (acc, line) => ({
        ...acc,
        [line.id]: Array(line.receivedQuantity).fill(""),
      }),
      {}
    );
  });

  const [lotNumberByLineId, setLotNumberByLineId] = useState<
    Record<string, string>
  >(() => {
    return receiptLines.reduce(
      (acc, line) => ({
        ...acc,
        [line.id]: "",
      }),
      {}
    );
  });

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
                files={routeData?.receiptFiles}
                className={
                  index === receiptLines.length - 1 ? "border-none" : ""
                }
                serialNumbers={serialNumbersByLineId[line.id] || []}
                onSerialNumbersChange={(newSerialNumbers) => {
                  setSerialNumbersByLineId((prev) => ({
                    ...prev,
                    [line.id]: newSerialNumbers,
                  }));
                }}
                lotNumber={lotNumberByLineId[line.id] || ""}
                onLotNumberChange={(newLotNumber) => {
                  setLotNumberByLineId((prev) => ({
                    ...prev,
                    [line.id]: newLotNumber,
                  }));
                }}
                upload={(files) => upload(files, line.id)}
                deleteFile={(file) => deleteFile(file, line.id)}
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
  files,
  lotNumber,
  serialNumbers,
  onLotNumberChange,
  onSerialNumbersChange,
  upload,
  deleteFile,
}: {
  line: ReceiptLine;
  className?: string;
  isReadOnly: boolean;
  files?: PostgrestResponse<StorageItem>;
  lotNumber: string;
  serialNumbers: string[];
  onLotNumberChange: (lotNumber: string) => void;
  onSerialNumbersChange: (serialNumbers: string[]) => void;
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
  upload: (files: File[]) => Promise<void>;
  deleteFile: (file: StorageItem) => Promise<void>;
}) {
  const [items] = useItems();
  const item = items.find((p) => p.id === line.itemId);
  const unitsOfMeasure = useUnitOfMeasure();

  return (
    <div className={cn("flex flex-col border-b p-6 gap-6", className)}>
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
            <VStack spacing={1}>
              <label className="text-xs text-muted-foreground">Received</label>

              <NumberField
                value={line.receivedQuantity}
                onChange={(value) => {
                  onUpdate({
                    lineId: line.id,
                    field: "receivedQuantity",
                    value,
                  });
                  // Adjust serial numbers array size while preserving existing values
                  if (value > serialNumbers.length) {
                    onSerialNumbersChange([
                      ...serialNumbers,
                      ...Array(value - serialNumbers.length).fill(""),
                    ]);
                  } else if (value < serialNumbers.length) {
                    onSerialNumbersChange(serialNumbers.slice(0, value));
                  }
                }}
              >
                <NumberInput
                  className="disabled:bg-transparent disabled:opacity-100 min-w-[100px]"
                  isDisabled={isReadOnly}
                  size="sm"
                  min={0}
                />
              </NumberField>
            </VStack>
          </HStack>
        </HStack>
        <div className="flex flex-grow items-center justify-between gap-2 pl-4">
          <VStack spacing={1}>
            <label className="text-xs text-muted-foreground">Ordered</label>
            <span className="text-sm py-1.5">{line.orderQuantity}</span>
          </VStack>
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
      {line.requiresLotTracking && (
        <div className="flex flex-col gap-2 p-4 border rounded-lg">
          <label className="text-xs text-muted-foreground flex items-center gap-2">
            <LuGroup /> Lot Number
          </label>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-4 gap-y-3">
            <Input
              key={`${line.id}-lot`}
              placeholder={`Lot number`}
              disabled={isReadOnly}
              value={lotNumber}
              onChange={(e) => {
                onLotNumberChange(e.target.value);
              }}
            />
          </div>
        </div>
      )}
      {line.requiresSerialTracking && (
        <div className="flex flex-col gap-2 p-4 border rounded-lg">
          <label className="text-xs text-muted-foreground flex items-center gap-2">
            <LuBarcode /> Serial Numbers
          </label>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-4 gap-y-3">
            {serialNumbers.map((serialNumber, index) => (
              <Input
                key={`${line.id}-${index}-serial`}
                placeholder={`Serial ${index + 1}`}
                disabled={isReadOnly}
                value={serialNumber}
                onChange={(e) => {
                  const newSerialNumbers = [...serialNumbers];
                  newSerialNumbers[index] = e.target.value;
                  onSerialNumbersChange(newSerialNumbers);
                }}
              />
            ))}
          </div>

          <input
            type="hidden"
            name={`serialNumbers-${line.id}`}
            value={JSON.stringify(serialNumbers)}
          />
        </div>
      )}
      {(line.requiresLotTracking || line.requiresSerialTracking) && (
        <>
          <Suspense fallback={null}>
            <Await resolve={files}>
              {(resolvedFiles) => {
                const lineFiles = resolvedFiles?.data?.filter(
                  (file) => file.bucket === line.id
                );
                return Array.isArray(lineFiles) && lineFiles.length > 0 ? (
                  <pre className="text-xs text-muted-foreground">
                    {lineFiles.map((file) => file.name).join("\n")}
                  </pre>
                ) : null;
              }}
            </Await>
          </Suspense>
          <FileDropzone onDrop={upload} />
        </>
      )}
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

function useReceiptFiles(receiptId: string) {
  const { company } = useUser();
  const { carbon } = useCarbon();

  const getPath = useCallback(
    ({ name }: { name: string }, lineId: string) => {
      return `${company.id}/inventory/${lineId}/${stripSpecialCharacters(
        name
      )}`;
    },
    [company.id]
  );

  const submit = useSubmit();
  const revalidator = useRevalidator();
  const upload = useCallback(
    async (files: File[], lineId: string) => {
      if (!carbon) {
        toast.error("Carbon client not available");
        return;
      }

      for (const file of files) {
        const fileName = getPath({ name: file.name }, lineId);
        toast.info(`Uploading ${file.name}`);
        const fileUpload = await carbon.storage
          .from("private")
          .upload(fileName, file, {
            cacheControl: `${12 * 60 * 60}`,
            upsert: true,
          });

        if (fileUpload.error) {
          toast.error(`Failed to upload file: ${file.name}`);
        } else if (fileUpload.data?.path) {
          toast.success(`Uploaded: ${file.name}`);
          const formData = new FormData();
          formData.append("path", fileUpload.data.path);
          formData.append("name", file.name);
          formData.append("size", Math.round(file.size / 1024).toString());
          formData.append("sourceDocument", "Receipt");
          formData.append("sourceDocumentId", receiptId);

          submit(formData, {
            method: "post",
            action: path.to.newDocument,
            navigate: false,
            fetcherKey: `${lineId}:${file.name}`,
          });
        }
      }
      revalidator.revalidate();
    },
    [carbon, revalidator, getPath, receiptId, submit]
  );

  const deleteFile = useCallback(
    async (file: StorageItem, lineId: string) => {
      const fileDelete = await carbon?.storage
        .from("private")
        .remove([getPath(file, lineId)]);

      if (!fileDelete || fileDelete.error) {
        toast.error(fileDelete?.error?.message || "Error deleting file");
        return;
      }

      toast.success(`${file.name} deleted successfully`);
    },
    [getPath, carbon?.storage]
  );

  return { upload, deleteFile };
}
