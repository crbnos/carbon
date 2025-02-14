import { useCarbon } from "@carbon/auth";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Combobox,
  DatePicker,
  Heading,
  HStack,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  NumberField,
  NumberInput,
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure,
  VStack,
} from "@carbon/react";
import { ValidatedForm, Number, Submit } from "@carbon/form";
import { type CalendarDate, parseDate } from "@internationalized/date";
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
import { Suspense, useCallback, useEffect, useState } from "react";
import {
  LuBarcode,
  LuCalendar,
  LuCircleAlert,
  LuGroup,
  LuSplit,
  LuX,
} from "react-icons/lu";
import { DocumentPreview, Empty } from "~/components";
import DocumentIcon from "~/components/DocumentIcon";
import { Enumerable } from "~/components/Enumerable";
import FileDropzone from "~/components/FileDropzone";
import { useShelves } from "~/components/Form/Shelf";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { TrackingTypeIcon } from "~/components/Icons";
import { useRouteData, useUser } from "~/hooks";
import {
  splitValidator,
  type BatchProperty,
  type ItemTracking,
  type Receipt,
  type ReceiptLine,
} from "~/modules/inventory";
import { getDocumentType } from "~/modules/shared/shared.service";
import type { action as receiptLinesUpdateAction } from "~/routes/x+/receipt+/lines.update";
import { useItems } from "~/stores";
import type { StorageItem } from "~/types";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";
import BatchPropertiesConfig from "../Batches/BatchPropertiesConfig";
import { BatchPropertiesFields } from "../Batches/BatchPropertiesFields";

const ReceiptLines = () => {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const fetcher = useFetcher<typeof receiptLinesUpdateAction>();
  const { upload, deleteFile, getPath } = useReceiptFiles(receiptId);
  const routeData = useRouteData<{
    receipt: Receipt;
    receiptLines: ReceiptLine[];
    receiptFiles: PostgrestResponse<StorageItem>;
    receiptLineTracking: ItemTracking[];
    batchProperties: PostgrestResponse<BatchProperty>;
  }>(path.to.receipt(receiptId));

  const receiptsById = new Map<string, ReceiptLine>(
    routeData?.receiptLines.map((line) => [line.id, line])
  );
  const pendingReceiptLines = usePendingReceiptLines();

  for (let pendingReceiptLine of pendingReceiptLines) {
    let item = receiptsById.get(pendingReceiptLine.id);
    let merged = item ? { ...item, ...pendingReceiptLine } : pendingReceiptLine;
    receiptsById.set(pendingReceiptLine.id, merged as ReceiptLine);
  }

  const receiptLines = Array.from(receiptsById.values());

  const [serialNumbersByLineId, setSerialNumbersByLineId] = useState<
    Record<string, { index: number; number: string }[]>
  >(() => {
    return receiptLines.reduce(
      (acc, line) => ({
        ...acc,
        [line.id]: Array.from({ length: line.receivedQuantity }, (_, index) => {
          const serialNumber = routeData?.receiptLineTracking.find(
            (t) =>
              t.sourceDocumentLineId === line.id &&
              t.serialNumber !== null &&
              t.index === index
          )?.serialNumber;
          return {
            index,
            number: serialNumber?.number ?? "",
          };
        }),
      }),
      {}
    );
  });

  useEffect(() => {
    setSerialNumbersByLineId(
      receiptLines.reduce(
        (acc, line) => ({
          ...acc,
          [line.id]: Array.from(
            { length: line.receivedQuantity },
            (_, index) => {
              const serialNumber = routeData?.receiptLineTracking.find(
                (t) =>
                  t.sourceDocumentLineId === line.id &&
                  t.serialNumber !== null &&
                  t.index === index
              )?.serialNumber;
              return {
                index,
                number: serialNumber?.number ?? "",
              };
            }
          ),
        }),
        {}
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeData?.receipt?.sourceDocumentId]);

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
            {receiptLines.length === 0 ? (
              <Empty className="py-6" />
            ) : (
              receiptLines.map((line, index) => (
                <ReceiptLineItem
                  key={line.id}
                  line={line}
                  receipt={routeData?.receipt}
                  isReadOnly={isPosted}
                  onUpdate={onUpdateReceiptLine}
                  files={routeData?.receiptFiles}
                  className={
                    index === receiptLines.length - 1 ? "border-none" : ""
                  }
                  serialNumbers={serialNumbersByLineId[line.id] || []}
                  getPath={(file) => getPath(file, line.id)}
                  onSerialNumbersChange={(newSerialNumbers) => {
                    setSerialNumbersByLineId((prev) => ({
                      ...prev,
                      [line.id]: newSerialNumbers,
                    }));
                  }}
                  batchProperties={routeData?.batchProperties}
                  batchNumber={
                    routeData?.receiptLineTracking.find(
                      (t) =>
                        t.sourceDocumentLineId === line.id &&
                        t.batchNumber !== null
                    )?.batchNumber ?? {
                      id: "",
                      number: "",
                      manufacturingDate: null,
                      expirationDate: null,
                      properties: {},
                    }
                  }
                  upload={(files) => upload(files, line.id)}
                  deleteFile={(file) => deleteFile(file, line.id)}
                />
              ))
            )}
          </div>
        </CardContent>
      </Card>
      <Outlet />
    </>
  );
};

function ReceiptLineItem({
  line,
  receipt,
  className,
  isReadOnly,
  onUpdate,
  files,
  batchProperties,
  batchNumber,
  serialNumbers,
  getPath,
  onSerialNumbersChange,
  upload,
  deleteFile,
}: {
  line: ReceiptLine;
  receipt?: Receipt;
  className?: string;
  isReadOnly: boolean;
  files?: PostgrestResponse<StorageItem>;
  batchProperties?: PostgrestResponse<BatchProperty>;
  batchNumber: {
    id: string;
    number: string;
    manufacturingDate?: string | null;
    expirationDate?: string | null;
    properties?: any;
  };
  serialNumbers: { index: number; number: string }[];
  getPath: (file: StorageItem) => string;
  onSerialNumbersChange: (
    serialNumbers: { index: number; number: string }[]
  ) => void;
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
  const splitDisclosure = useDisclosure();

  return (
    <div className={cn("flex flex-col border-b p-6 gap-6 relative", className)}>
      <div className="absolute top-4 right-6">
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              aria-label="Split shipment line"
              icon={<LuSplit />}
              variant="ghost"
              size="sm"
              onClick={splitDisclosure.onOpen}
            />
          </TooltipTrigger>
          <TooltipContent>Split shipment line</TooltipContent>
        </Tooltip>
      </div>
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
                      ...Array.from(
                        { length: value - serialNumbers.length },
                        () => ({
                          index: serialNumbers.length,
                          number: "",
                        })
                      ),
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
          <HStack spacing={4}>
            <VStack spacing={1} className="text-center items-center">
              <label className="text-xs text-muted-foreground">Ordered</label>
              <span className="text-sm py-1.5">{line.orderQuantity}</span>
            </VStack>

            <VStack spacing={1} className="text-center items-center">
              <label className="text-xs text-muted-foreground">
                Outstanding
              </label>
              <HStack className="justify-center">
                <span className="text-sm py-1.5">
                  {line.outstandingQuantity}
                </span>

                {line.receivedQuantity > line.outstandingQuantity && (
                  <Tooltip>
                    <TooltipTrigger>
                      <LuCircleAlert className="text-red-500" />
                    </TooltipTrigger>
                    <TooltipContent>
                      There are more received than ordered
                    </TooltipContent>
                  </Tooltip>
                )}
              </HStack>
            </VStack>
          </HStack>
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
      {line.requiresBatchTracking && (
        <>
          <BatchForm
            receipt={receipt}
            line={line}
            isReadOnly={isReadOnly}
            initialValues={batchNumber}
            batchProperties={batchProperties}
          />
        </>
      )}
      {line.requiresSerialTracking && (
        <SerialForm
          receipt={receipt}
          line={line}
          serialNumbers={serialNumbers}
          isReadOnly={isReadOnly}
          onSerialNumbersChange={onSerialNumbersChange}
        />
      )}
      {(line.requiresBatchTracking || line.requiresSerialTracking) && (
        <>
          <Suspense fallback={null}>
            <Await resolve={files}>
              {(resolvedFiles) => {
                const lineFiles = resolvedFiles?.data?.filter(
                  (file) => file.bucket === line.id
                );
                return Array.isArray(lineFiles) && lineFiles.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {lineFiles.map((file) => {
                      const documentType = getDocumentType(file.name);
                      const isPreviewable = ["PDF", "Image"].includes(
                        documentType
                      );

                      return (
                        <HStack key={file.id}>
                          <DocumentIcon type={documentType} />
                          <span className="font-medium text-sm">
                            {isPreviewable ? (
                              <DocumentPreview
                                bucket="private"
                                pathToFile={getPath(file)}
                                // @ts-ignore
                                type={getDocumentType(file.name)}
                              >
                                {file.name}
                              </DocumentPreview>
                            ) : (
                              file.name
                            )}
                          </span>
                          <IconButton
                            icon={<LuX />}
                            aria-label="Delete file"
                            variant="ghost"
                            onClick={() => deleteFile(file)}
                          />
                        </HStack>
                      );
                    })}
                  </div>
                ) : null;
              }}
            </Await>
          </Suspense>
          <FileDropzone onDrop={upload} />
          {splitDisclosure.isOpen && (
            <SplitReceiptLineModal
              line={line}
              onClose={splitDisclosure.onClose}
            />
          )}
        </>
      )}
    </div>
  );
}

function BatchForm({
  line,
  receipt,
  batchProperties,
  initialValues,
  isReadOnly,
}: {
  line: ReceiptLine;
  receipt?: Receipt;
  isReadOnly: boolean;
  batchProperties?: PostgrestResponse<BatchProperty>;
  initialValues?: {
    id: string;
    number: string;
    manufacturingDate?: string | null;
    expirationDate?: string | null;
    properties?: any;
  };
}) {
  const submit = useSubmit();
  const [values, setValues] = useState<{
    number: string;
    manufacturingDate?: CalendarDate;
    expirationDate?: CalendarDate;
    properties: any;
  }>(
    initialValues
      ? {
          number: initialValues.number,
          manufacturingDate: initialValues.manufacturingDate
            ? parseDate(initialValues.manufacturingDate)
            : undefined,
          expirationDate: initialValues.expirationDate
            ? parseDate(initialValues.expirationDate)
            : undefined,
          properties: initialValues.properties ?? {},
        }
      : {
          number: "",
          manufacturingDate: undefined,
          expirationDate: undefined,
          properties: {},
        }
  );

  const { carbon } = useCarbon();
  const updateBatchNumber = async (newValues: typeof values, isNew = false) => {
    if (!receipt?.id || !newValues.number.trim()) return;

    const batchMatch = isNew
      ? (await carbon
          ?.from("batchNumber")
          .select("*")
          .eq("number", newValues.number.trim())
          .eq("itemId", line.itemId)
          .eq("companyId", receipt.companyId)
          .maybeSingle()) ?? { data: null }
      : { data: null };

    let valuesToSubmit = newValues;

    if (batchMatch.data) {
      valuesToSubmit = {
        ...newValues,
        manufacturingDate: batchMatch.data.manufacturingDate
          ? parseDate(batchMatch.data.manufacturingDate)
          : undefined,
        expirationDate: batchMatch.data.expirationDate
          ? parseDate(batchMatch.data.expirationDate)
          : undefined,
        properties: batchMatch.data.properties ?? {},
      };

      // Just update the local state without triggering another database write
      setValues(valuesToSubmit);
    }

    const formData = new FormData();
    formData.append("itemId", line.itemId);
    formData.append("receiptId", receipt.id);
    formData.append("receiptLineId", line.id);
    formData.append("trackingType", "batch");
    formData.append("batchNumber", valuesToSubmit.number.trim());
    if (
      valuesToSubmit.manufacturingDate &&
      valuesToSubmit.manufacturingDate.year >= 1900
    ) {
      formData.append(
        "manufacturingDate",
        valuesToSubmit.manufacturingDate.toString()
      );
    } else {
      formData.append("manufacturingDate", "");
    }
    if (
      valuesToSubmit.expirationDate &&
      valuesToSubmit.expirationDate.year >= 1900
    ) {
      formData.append(
        "expirationDate",
        valuesToSubmit.expirationDate.toString()
      );
    } else {
      formData.append("expirationDate", "");
    }

    formData.append("properties", JSON.stringify(valuesToSubmit.properties));
    formData.append("quantity", line.receivedQuantity.toString());

    submit(formData, {
      method: "post",
      action: path.to.receiptLinesTracking(receipt.id),
      navigate: false,
    });
  };

  const handleDateChange = (
    field: "manufacturingDate" | "expirationDate",
    newDate: CalendarDate | null
  ) => {
    const newValues = {
      ...values,
      [field]: newDate ?? null,
    };
    setValues(newValues);
    updateBatchNumber(newValues);
  };

  const handlePropertiesChange = (newProperties: any) => {
    const newValues = {
      ...values,
      properties: newProperties,
    };
    setValues(newValues);
    updateBatchNumber(newValues);
  };

  const propertiesDisclosure = useDisclosure();

  return (
    <div className="flex flex-col gap-6 w-full p-6 border rounded-lg">
      <div className="flex justify-between items-center gap-4">
        <Heading size="h4">Batch Properties</Heading>
        <Button
          variant="secondary"
          size="sm"
          onClick={propertiesDisclosure.onOpen}
        >
          Edit Properties
        </Button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 ">
        <div className="flex flex-col gap-2 w-full">
          <label className="text-xs text-muted-foreground flex items-center gap-2">
            <LuGroup /> Batch Number
          </label>

          <Input
            placeholder={`Batch number`}
            disabled={isReadOnly}
            value={values.number}
            onChange={(e) => {
              setValues((prev) => ({
                ...prev,
                number: e.target.value,
              }));
            }}
            onBlur={() => {
              updateBatchNumber(values, true);
            }}
          />
        </div>

        <div className="flex flex-col gap-2 w-full">
          <label className="text-xs text-muted-foreground flex items-center gap-2">
            <LuCalendar /> Manufactured Date
          </label>

          <DatePicker
            value={values.manufacturingDate}
            isDisabled={isReadOnly}
            onChange={(newDate) => {
              handleDateChange("manufacturingDate", newDate);
            }}
          />
        </div>

        <div className="flex flex-col gap-2 w-full">
          <label className="text-xs text-muted-foreground flex items-center gap-2">
            <LuCalendar /> Expiration Date
          </label>

          <DatePicker
            value={values.expirationDate}
            isDisabled={isReadOnly}
            onChange={(newDate) => {
              handleDateChange("expirationDate", newDate);
            }}
            minValue={values.manufacturingDate}
          />
        </div>

        <Suspense fallback={null}>
          <Await resolve={batchProperties}>
            {(resolvedBatchProperties) => {
              return (
                <BatchPropertiesFields
                  itemId={line.itemId}
                  properties={
                    resolvedBatchProperties?.data?.filter(
                      (p) => p.itemId === line.itemId
                    ) ?? []
                  }
                  values={values.properties}
                  onChange={(newProperties) => {
                    handlePropertiesChange(newProperties);
                  }}
                />
              );
            }}
          </Await>
        </Suspense>
      </div>
      {propertiesDisclosure.isOpen && (
        <Suspense fallback={null}>
          <Await resolve={batchProperties}>
            {(resolvedBatchProperties) => {
              return (
                <BatchPropertiesConfig
                  itemId={line.itemId}
                  properties={resolvedBatchProperties?.data ?? []}
                  type="modal"
                  onClose={propertiesDisclosure.onClose}
                />
              );
            }}
          </Await>
        </Suspense>
      )}
    </div>
  );
}

function SerialForm({
  line,
  receipt,
  serialNumbers,
  isReadOnly,
  onSerialNumbersChange,
}: {
  line: ReceiptLine;
  receipt?: Receipt;
  serialNumbers: { index: number; number: string }[];
  isReadOnly: boolean;
  onSerialNumbersChange: (
    serialNumbers: { index: number; number: string }[]
  ) => void;
}) {
  const [errors, setErrors] = useState<Record<number, string>>({});

  // Check for duplicates within the current form
  const validateSerialNumber = useCallback(
    (serialNumber: string, currentIndex: number) => {
      const trimmedNumber = serialNumber.trim();
      if (!trimmedNumber) return null;

      const isDuplicate = serialNumbers.some(
        (sn, idx) => idx !== currentIndex && sn.number.trim() === trimmedNumber
      );

      return isDuplicate ? "Duplicate serial number" : null;
    },
    [serialNumbers]
  );

  const updateSerialNumber = useCallback(
    async (serialNumber: { index: number; number: string }) => {
      if (!receipt?.id || !serialNumber.number.trim()) return;

      const error = validateSerialNumber(
        serialNumber.number,
        serialNumber.index
      );
      if (error) {
        setErrors((prev) => ({ ...prev, [serialNumber.index]: error }));
        return;
      }

      const formData = new FormData();
      formData.append("itemId", line.itemId);
      formData.append("receiptId", receipt.id);
      formData.append("receiptLineId", line.id);
      formData.append("trackingType", "serial");
      formData.append("index", serialNumber.index.toString());
      formData.append("serialNumber", serialNumber.number.trim());

      try {
        const response = await fetch(path.to.receiptLinesTracking(receipt.id), {
          method: "POST",
          body: formData,
        });

        if (response.ok) {
          // Clear error if submission was successful
          setErrors((prev) => {
            const newErrors = { ...prev };
            delete newErrors[serialNumber.index];
            return newErrors;
          });
        } else {
          setErrors((prev) => ({
            ...prev,
            [serialNumber.index]: "Serial number already exists",
          }));
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("duplicate")) {
          setErrors((prev) => ({
            ...prev,
            [serialNumber.index]: "Serial number already exists for this item",
          }));
        }
      }
    },
    [line.id, line.itemId, receipt?.id, validateSerialNumber]
  );

  return (
    <div className="flex flex-col gap-2 p-6 border rounded-lg">
      <label className="text-xs text-muted-foreground flex items-center gap-2">
        <LuBarcode /> Serial Numbers
      </label>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-4 gap-y-3">
        {serialNumbers.map((serialNumber, index) => (
          <div
            key={`${line.id}-${index}-serial`}
            className="flex flex-col gap-1"
          >
            <Input
              placeholder={`Serial ${index + 1}`}
              disabled={isReadOnly}
              value={serialNumber.number}
              onChange={(e) => {
                const newValue = e.target.value;
                const error = validateSerialNumber(newValue, index);

                setErrors((prev) => {
                  const newErrors = { ...prev };
                  if (error) {
                    newErrors[index] = error;
                  } else {
                    delete newErrors[index];
                  }
                  return newErrors;
                });

                const newSerialNumbers = [...serialNumbers];
                newSerialNumbers[index] = {
                  index,
                  number: newValue,
                };
                onSerialNumbersChange(newSerialNumbers);
              }}
              onBlur={() => {
                if (serialNumber.number.trim()) {
                  updateSerialNumber(serialNumber);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (serialNumber.number.trim()) {
                    updateSerialNumber(serialNumber);
                  }
                  const nextInput = e.currentTarget
                    .closest("div")
                    ?.querySelector(`input[placeholder="Serial ${index + 2}"]`);
                  if (nextInput) {
                    (nextInput as HTMLElement).focus();
                  }
                }
              }}
              className={cn(errors[index] && "border-destructive")}
            />
            {errors[index] && (
              <span className="text-xs text-destructive">{errors[index]}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SplitReceiptLineModal({
  line,
  onClose,
}: {
  line: ReceiptLine;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ success: boolean }>();
  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    }
  }, [fetcher.data?.success, onClose]);

  return (
    <Modal open onOpenChange={onClose}>
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.receiptLineSplit}
          validator={splitValidator}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>Split Receipt Line</ModalTitle>
            <ModalDescription>
              Select the quantity that you'd like to split into a new line.
            </ModalDescription>
          </ModalHeader>

          <ModalBody>
            <input type="hidden" name="documentId" value={line.receiptId} />
            <input type="hidden" name="documentLineId" value={line.id} />
            <input
              type="hidden"
              name="locationId"
              value={line.locationId ?? ""}
            />
            <Number
              name="quantity"
              label="Quantity"
              maxValue={line.orderQuantity - 0.0001}
              minValue={0.0001}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Submit>Split Line</Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
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
    <div className="flex flex-col items-start gap-1 min-w-[140px] text-sm">
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

const usePendingReceiptLines = () => {
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
      revalidator.revalidate();
    },
    [getPath, carbon?.storage, revalidator]
  );

  return { upload, deleteFile, getPath };
}
