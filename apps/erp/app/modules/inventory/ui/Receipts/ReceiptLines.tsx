import { useCarbon } from "@carbon/auth";
import { Number, Submit, ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import type { TrackedEntityAttributes } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  LuCalendar,
  LuChevronDown,
  LuCircleAlert,
  LuEllipsisVertical,
  LuGroup,
  LuSplit,
  LuTrash,
  LuX
} from "react-icons/lu";
import {
  Await,
  Outlet,
  useFetcher,
  useFetchers,
  useParams,
  useRevalidator,
  useSubmit
} from "react-router";
import {
  DocumentPreview,
  Empty,
  ItemThumbnail,
  PrintButton
} from "~/components";
import DocumentIcon from "~/components/DocumentIcon";
import { Enumerable } from "~/components/Enumerable";
import FileDropzone from "~/components/FileDropzone";
import StorageUnit from "~/components/Form/StorageUnit";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { ConfirmDelete } from "~/components/Modals";
import { useRouteData, useUser } from "~/hooks";
import type {
  BatchProperty,
  ItemTracking,
  Receipt,
  ReceiptLine
} from "~/modules/inventory";
import { splitValidator } from "~/modules/inventory";
import { getDocumentType } from "~/modules/shared/shared.service";
import { useItems } from "~/stores";
import type { StorageItem } from "~/types";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";
import BatchPropertiesConfig from "../Batches/BatchPropertiesConfig";
import { BatchPropertiesFields } from "../Batches/BatchPropertiesFields";
import { getTrackingPropertyValues } from "../Batches/tracking-properties";

const ReceiptLines = () => {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const fetcher = useFetcher();

  const { upload, deleteFile, getPath } = useReceiptFiles(receiptId);
  const routeData = useRouteData<{
    receipt: Receipt;
    receiptLines: ReceiptLine[];
    fixedAssetLines: {
      id: string;
      purchaseOrderLineId: string;
      assetId: string;
      assetName: string | null;
      assetReadableId: string | null;
      description: string | null;
      received: boolean;
      serialNumber: string | null;
    }[];
    receiptFiles: PostgrestResponse<StorageItem>;
    receiptLineTracking: ItemTracking[];
    batchProperties: PostgrestResponse<BatchProperty>;
    itemShelfLife: PostgrestResponse<{
      itemId: string;
      mode: string;
      days: number | null;
    }>;
  }>(path.to.receipt(receiptId));

  const receiptsById = new Map<string, ReceiptLine>(
    // @ts-expect-error
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
    return receiptLines.reduce((acc, line) => {
      if (!line.requiresSerialTracking) return acc;

      const trackedEntitiesForLine = routeData?.receiptLineTracking.filter(
        (t) => {
          const attributes = t.attributes as TrackedEntityAttributes;
          return attributes["Receipt Line"] === line.id;
        }
      );

      if (!trackedEntitiesForLine) return acc;
      return {
        ...acc,
        [line.id!]: Array.from(
          { length: line.receivedQuantity ?? 0 },
          (_, index) => {
            const serialNumberEntity = trackedEntitiesForLine.find((t) => {
              const attributes = t.attributes as TrackedEntityAttributes;
              return attributes["Receipt Line Index"] === index;
            });

            const serialNumber = serialNumberEntity?.readableId || "";

            return {
              index,
              number: serialNumber
            };
          }
        )
      };
    }, {});
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    setSerialNumbersByLineId(
      receiptLines.reduce((acc, line) => {
        if (!line.requiresSerialTracking) return acc;

        const trackedEntitiesForLine = routeData?.receiptLineTracking.filter(
          (t) => {
            const attributes = t.attributes as TrackedEntityAttributes;
            return attributes["Receipt Line"] === line.id;
          }
        );

        if (!trackedEntitiesForLine) return acc;
        return {
          ...acc,
          [line.id!]: Array.from(
            { length: line.receivedQuantity ?? 0 },
            (_, index) => {
              const serialNumberEntity = trackedEntitiesForLine.find((t) => {
                const attributes = t.attributes as TrackedEntityAttributes;
                return attributes["Receipt Line Index"] === index;
              });

              const serialNumber = serialNumberEntity?.readableId || "";

              return {
                index,
                number: serialNumber
              };
            }
          )
        };
      }, {})
    );
  }, [routeData?.receipt?.sourceDocumentId, routeData?.receiptLines?.length]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdateReceiptLine = useCallback(
    async ({
      lineId,
      field,
      value
    }:
      | {
          lineId: string;
          field: "receivedQuantity";
          value: number;
        }
      | {
          lineId: string;
          field: "storageUnitId";
          value: string;
        }) => {
      const formData = new FormData();

      formData.append("ids", lineId);
      formData.append("field", field);
      formData.append("value", value.toString());
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateReceiptLine
      });
    },

    []
  );

  const isPosted =
    routeData?.receipt.status === "Posted" ||
    routeData?.receipt.status === "Voided";

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Receipt Lines</Trans>
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="border rounded-lg">
            {receiptLines.length === 0 ? (
              <Empty className="py-6" />
            ) : (
              receiptLines.map((line, index) => {
                const trackingCandidates =
                  routeData?.receiptLineTracking?.filter((t) => {
                    const attributes = t.attributes as TrackedEntityAttributes;
                    return attributes["Receipt Line"] === line.id;
                  }) ?? [];
                const tracking =
                  trackingCandidates.find((t) => t.expirationDate) ??
                  trackingCandidates[0];
                return (
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
                    serialNumbers={serialNumbersByLineId[line.id!] || []}
                    getPath={(file) => getPath(file, line.id!)}
                    onSerialNumbersChange={(newSerialNumbers) => {
                      setSerialNumbersByLineId((prev) => ({
                        ...prev,
                        [line.id!]: newSerialNumbers
                      }));
                    }}
                    batchProperties={routeData?.batchProperties}
                    itemShelfLife={routeData?.itemShelfLife}
                    tracking={tracking}
                    serialTracking={trackingCandidates}
                    upload={(files) => upload(files, line.id!)}
                    deleteFile={(file) => deleteFile(file, line.id!)}
                  />
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
      {routeData?.fixedAssetLines && routeData.fixedAssetLines.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Fixed Assets</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg">
              {routeData.fixedAssetLines.map((line, index) => (
                <ReceiptFixedAssetLineItem
                  key={line.id}
                  line={line}
                  isReadOnly={isPosted}
                  className={
                    index < routeData.fixedAssetLines.length - 1
                      ? "border-b"
                      : ""
                  }
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      <Outlet />
    </>
  );
};

function ReceiptFixedAssetLineItem({
  line,
  isReadOnly,
  className
}: {
  line: {
    id: string;
    purchaseOrderLineId: string;
    assetId: string;
    assetName: string | null;
    assetReadableId: string | null;
    description: string | null;
    received: boolean;
    serialNumber: string | null;
  };
  isReadOnly: boolean;
  className?: string;
}) {
  const fetcher = useFetcher();
  const [serialNumber, setSerialNumber] = useState(line.serialNumber ?? "");

  const updateField = (field: string, value: string) => {
    const formData = new FormData();
    formData.append("id", line.id);
    formData.append("field", field);
    formData.append("value", value);
    fetcher.submit(formData, {
      method: "post",
      action: path.to.receiptFixedAssetLineUpdate
    });
  };

  return (
    <div className={cn("flex items-center gap-4 p-6", className)}>
      <Checkbox
        isChecked={line.received}
        disabled={isReadOnly}
        onCheckedChange={(checked) =>
          updateField("received", String(checked === true))
        }
      />
      <VStack spacing={0} className="flex-1 min-w-0">
        <span className="text-sm font-medium">
          {line.assetName ?? line.description ?? "Fixed Asset"}
        </span>
        {line.assetReadableId && (
          <span className="text-xs text-muted-foreground">
            {line.assetReadableId}
          </span>
        )}
      </VStack>
      <Input
        placeholder="Serial Number"
        value={serialNumber}
        isDisabled={isReadOnly}
        className="w-48"
        onChange={(e) => setSerialNumber(e.target.value)}
        onBlur={() => {
          if (serialNumber !== (line.serialNumber ?? "")) {
            updateField("serialNumber", serialNumber);
          }
        }}
      />
    </div>
  );
}

function ReceiptLineItem({
  line,
  receipt,
  className,
  isReadOnly,
  onUpdate,
  files,
  batchProperties,
  itemShelfLife,
  tracking,
  serialTracking,
  serialNumbers,
  getPath,
  onSerialNumbersChange,
  upload,
  deleteFile
}: {
  line: ReceiptLine;
  receipt?: Receipt;
  className?: string;
  isReadOnly: boolean;
  files?: PostgrestResponse<StorageItem>;
  batchProperties?: PostgrestResponse<BatchProperty>;
  itemShelfLife?: PostgrestResponse<{
    itemId: string;
    mode: string;
    days: number | null;
  }>;
  tracking: ItemTracking | undefined;
  serialTracking: ItemTracking[];
  serialNumbers: { index: number; number: string }[];
  getPath: (file: StorageItem) => string;
  onSerialNumbersChange: (
    serialNumbers: { index: number; number: string }[]
  ) => void;
  onUpdate: ({
    lineId,
    field,
    value
  }:
    | {
        lineId: string;
        field: "receivedQuantity";
        value: number;
      }
    | {
        lineId: string;
        field: "storageUnitId";
        value: string;
      }) => Promise<void>;
  upload: (files: File[]) => Promise<void>;
  deleteFile: (file: StorageItem) => Promise<void>;
}) {
  const { t } = useLingui();
  const [items] = useItems();
  const item = items.find((p) => p.id === line.itemId);
  const unitsOfMeasure = useUnitOfMeasure();
  const splitDisclosure = useDisclosure();
  const deleteDisclosure = useDisclosure();

  const remainingQuantity =
    (line.outstandingQuantity ?? 0) - (line.receivedQuantity ?? 0);
  const isSurplus = remainingQuantity < 0;

  return (
    <div className={cn("flex flex-col border-b p-6 gap-6 relative", className)}>
      <div className="absolute top-3 right-6">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              aria-label={t`Line options`}
              variant="secondary"
              icon={<LuEllipsisVertical />}
              size="sm"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              disabled={isReadOnly}
              onClick={splitDisclosure.onOpen}
            >
              <DropdownMenuIcon icon={<LuSplit />} />
              {t`Split receipt line`}
            </DropdownMenuItem>
            <DropdownMenuItem
              destructive
              disabled={isReadOnly}
              onClick={deleteDisclosure.onOpen}
            >
              <DropdownMenuIcon icon={<LuTrash />} />
              {t`Delete receipt line`}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex flex-1 justify-between items-center w-full">
        <HStack spacing={4} className="w-1/2">
          <HStack spacing={4} className="flex-1">
            <ItemThumbnail
              size="md"
              thumbnailPath={line.thumbnailPath}
              type={(item?.type as "Part") ?? "Part"}
            />
            <VStack spacing={0}>
              <span className="text-sm font-medium">{item?.name}</span>
              <span className="text-xs text-muted-foreground line-clamp-2">
                {item?.readableIdWithRevision}
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
                value={line.receivedQuantity ?? 0}
                onChange={(value) => {
                  // Default to 0 if value is NaN, null, or undefined
                  const safeValue = isNaN(value) || value == null ? 0 : value;
                  onUpdate({
                    lineId: line.id!,
                    field: "receivedQuantity",
                    value: safeValue
                  });
                  // Adjust serial numbers array size while preserving existing values
                  if (safeValue > serialNumbers.length) {
                    onSerialNumbersChange([
                      ...serialNumbers,
                      ...Array.from(
                        { length: safeValue - serialNumbers.length },
                        () => ({
                          index: serialNumbers.length,
                          number: ""
                        })
                      )
                    ]);
                  } else if (safeValue < serialNumbers.length) {
                    onSerialNumbersChange(serialNumbers.slice(0, safeValue));
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
              <span className="text-sm py-1.5">{line.orderQuantity ?? 0}</span>
            </VStack>

            <VStack spacing={1} className="text-center items-center">
              <label className="text-xs text-muted-foreground">
                {isSurplus ? "Surplus" : "Outstanding"}
              </label>
              <HStack className="justify-center">
                <span
                  className={cn("text-sm py-1.5", isSurplus && "text-red-500")}
                >
                  {Math.abs(remainingQuantity)}
                </span>

                {isSurplus && (
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

          <div className="flex flex-col items-start gap-1 min-w-[140px] text-sm">
            <label className="text-xs text-muted-foreground">
              Storage Unit
            </label>
            <StorageUnit
              locationId={line.locationId}
              value={line.storageUnitId}
              isReadOnly={isReadOnly}
              onChange={(storageUnit) => {
                onUpdate({
                  lineId: line.id!,
                  field: "storageUnitId",
                  value: storageUnit?.id ?? ""
                });
              }}
            />
          </div>
        </div>
      </div>
      {line.requiresBatchTracking && (
        <>
          <BatchForm
            receipt={receipt}
            line={line}
            isReadOnly={isReadOnly}
            tracking={tracking}
            batchProperties={batchProperties}
            itemShelfLife={itemShelfLife}
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
          batchProperties={batchProperties}
          itemShelfLife={itemShelfLife}
          serialTracking={serialTracking}
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
                                // @ts-expect-error
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
                            aria-label={t`Delete file`}
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
          {deleteDisclosure.isOpen && (
            <ConfirmDelete
              name="Receipt Line"
              text="Are you sure you want to delete this receipt line?"
              action={path.to.receiptLineDelete(line.id!)}
              onCancel={deleteDisclosure.onClose}
              onSubmit={deleteDisclosure.onClose}
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
  itemShelfLife,
  tracking,
  isReadOnly
}: {
  line: ReceiptLine;
  receipt?: Receipt;
  isReadOnly: boolean;
  batchProperties?: PostgrestResponse<BatchProperty>;
  itemShelfLife?: PostgrestResponse<{
    itemId: string;
    mode: string;
    days: number | null;
  }>;
  tracking: ItemTracking | undefined;
}) {
  const { t } = useLingui();
  const submit = useSubmit();
  const shelfLife = itemShelfLife?.data?.find(
    (sl) => sl.itemId === line.itemId
  );
  const showExpiryField = shelfLife?.mode === "Set on Receipt";
  const [values, setValues] = useState<{
    number: string;
    properties: any;
    expirationDate: string;
  }>(() => {
    if (tracking) {
      const attributes = tracking.attributes as TrackedEntityAttributes;
      return {
        number: tracking.readableId || "",
        expirationDate: tracking.expirationDate ?? "",
        properties: getTrackingPropertyValues(attributes)
      };
    }
    return {
      number: "",
      properties: {},
      expirationDate: ""
    };
  });

  useEffect(() => {
    if (!tracking) return;
    setValues((prev) => {
      const attributes = tracking.attributes as TrackedEntityAttributes;
      const newExpiration = tracking.expirationDate ?? "";
      const newNumber = tracking.readableId || "";
      if (prev.expirationDate === newExpiration && prev.number === newNumber)
        return prev;
      return {
        number: newNumber || prev.number,
        expirationDate: newExpiration || prev.expirationDate,
        properties: getTrackingPropertyValues(attributes)
      };
    });
  }, [tracking]);

  const updateBatchNumber = async (newValues: typeof values, isNew = false) => {
    if (!receipt?.id || !newValues.number.trim()) return;

    let batchMatch = null;
    if (isNew && tracking) {
      batchMatch = tracking.readableId;
    }

    let valuesToSubmit = newValues;

    if (batchMatch) {
      const attributes = tracking?.attributes as TrackedEntityAttributes;
      valuesToSubmit = {
        ...newValues,
        properties: Object.entries(attributes)
          .filter(([key]) => !["Receipt Line"].includes(key))
          .reduce((acc, [key, value]) => ({ ...acc, [key]: value || "" }), {})
      };

      // Just update the local state without triggering another database write
      setValues(valuesToSubmit);
    }

    const formData = new FormData();
    formData.append("itemId", line.itemId!);
    formData.append("receiptId", receipt.id);
    formData.append("receiptLineId", line.id!);
    formData.append("trackingType", "batch");
    if (tracking?.id) {
      formData.append("trackedEntityId", tracking.id);
    }
    formData.append("batchNumber", valuesToSubmit.number.trim());
    const propertiesWithExpiry = valuesToSubmit.expirationDate
      ? {
          ...valuesToSubmit.properties,
          expirationDate: valuesToSubmit.expirationDate
        }
      : valuesToSubmit.properties;
    formData.append("properties", JSON.stringify(propertiesWithExpiry));
    formData.append("quantity", (line.receivedQuantity ?? 0).toString());

    submit(formData, {
      method: "post",
      action: path.to.receiptLinesTracking(receipt.id),
      navigate: false
    });
  };

  const handlePropertiesChange = (newProperties: any) => {
    const newValues = {
      ...values,
      properties: newProperties
    };
    setValues(newValues);
    updateBatchNumber(newValues);
  };

  const propertiesDisclosure = useDisclosure();

  return (
    <div className="flex flex-col gap-6 w-full p-6 border rounded-lg">
      <div className="flex justify-between items-center gap-4">
        <Heading size="h4">Tracking Properties</Heading>
        <div className="flex items-center gap-2">
          {values.number.trim() !== "" && (
            <PrintButton
              sourceDocument="Receipt"
              sourceDocumentId={receipt?.id ?? ""}
              locationId={receipt?.locationId ?? undefined}
              context="receiving"
              fileRoutes={{
                pdf: (id, opts) =>
                  path.to.file.receiptLabelsPdf(id, {
                    ...opts,
                    lineId: line.id!
                  }),
                zpl: (id, opts) =>
                  path.to.file.receiptLabelsZpl(id, {
                    ...opts,
                    lineId: line.id!
                  })
              }}
            />
          )}
          <Button
            variant="secondary"
            leftIcon={<LuGroup />}
            size="md"
            onClick={propertiesDisclosure.onOpen}
          >
            Edit Properties
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 ">
        <div className="flex flex-col gap-2 w-full">
          <label className="text-xs text-muted-foreground flex items-center gap-2">
            <LuGroup /> <Trans>Batch Number</Trans>
            {showExpiryField && (
              <span className="text-destructive-foreground">*</span>
            )}
          </label>

          <Input
            placeholder={`Batch number`}
            isDisabled={isReadOnly}
            value={values.number}
            onChange={(e) => {
              setValues((prev) => ({
                ...prev,
                number: e.target.value
              }));
            }}
            onBlur={() => {
              updateBatchNumber(values, true);
            }}
          />
        </div>

        {showExpiryField && (
          <div className="flex flex-col gap-2 w-full">
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              <LuCalendar /> <Trans>Expiration Date</Trans>
            </label>
            <DatePicker
              isDisabled={isReadOnly}
              value={
                values.expirationDate ? parseDate(values.expirationDate) : null
              }
              onChange={(date) => {
                const next = date?.toString() ?? "";
                const newValues = { ...values, expirationDate: next };
                setValues(newValues);
                if (newValues.number.trim()) {
                  updateBatchNumber(newValues, true);
                } else if (next) {
                  toast.error(
                    t`Enter a batch number before setting the expiration date`
                  );
                }
              }}
            />
          </div>
        )}

        <Suspense fallback={null}>
          <Await resolve={batchProperties}>
            {(resolvedBatchProperties) => {
              return (
                <BatchPropertiesFields
                  itemId={line.itemId!}
                  properties={
                    resolvedBatchProperties?.data?.filter(
                      (p) => p.itemId === line.itemId
                    ) ?? []
                  }
                  isReadOnly={isReadOnly}
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
                  itemId={line.itemId!}
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

// Per-serial custom property values + expiration, keyed by receipt-line index.
type SerialDetail = {
  properties: Record<string, string>;
  expirationDate: string;
};

function seedSerialDetails(
  serialTracking: ItemTracking[],
  count: number
): Record<number, SerialDetail> {
  const details: Record<number, SerialDetail> = {};
  for (let index = 0; index < count; index++) {
    const entity = serialTracking.find((t) => {
      const attributes = t.attributes as TrackedEntityAttributes;
      return attributes["Receipt Line Index"] === index;
    });
    details[index] = {
      properties: entity
        ? getTrackingPropertyValues(
            entity.attributes as TrackedEntityAttributes
          )
        : {},
      expirationDate: entity?.expirationDate ?? ""
    };
  }
  return details;
}

function SerialForm({
  line,
  receipt,
  batchProperties,
  itemShelfLife,
  serialNumbers,
  isReadOnly,
  onSerialNumbersChange,
  serialTracking
}: {
  line: ReceiptLine;
  receipt?: Receipt;
  batchProperties?: PostgrestResponse<BatchProperty>;
  itemShelfLife?: PostgrestResponse<{
    itemId: string;
    mode: string;
    days: number | null;
  }>;
  serialNumbers: { index: number; number: string }[];
  isReadOnly: boolean;
  onSerialNumbersChange: (
    serialNumbers: { index: number; number: string }[]
  ) => void;
  serialTracking: ItemTracking[];
}) {
  const shelfLife = itemShelfLife?.data?.find(
    (sl) => sl.itemId === line.itemId
  );
  const showExpiryField = shelfLife?.mode === "Set on Receipt";
  const containerRef = useRef<HTMLDivElement>(null);

  const [errors, setErrors] = useState<Record<number, string>>({});
  const [details, setDetails] = useState<Record<number, SerialDetail>>(() =>
    seedSerialDetails(serialTracking, serialNumbers.length)
  );

  // Re-seed per-serial property/expiry values from the persisted entities when
  // the tracked-entity set changes (initial load, post-save revalidate, or the
  // received quantity changing). A stable signature avoids a render loop — the
  // parent recomputes `serialTracking`'s identity every render.
  const trackingSignature = useMemo(() => {
    const parts = serialTracking.map((t) => {
      const a = t.attributes as TrackedEntityAttributes;
      return `${a["Receipt Line Index"]}:${t.readableId ?? ""}:${
        t.expirationDate ?? ""
      }:${JSON.stringify(getTrackingPropertyValues(a))}`;
    });
    return `${serialNumbers.length}|${parts.sort().join("|")}`;
  }, [serialTracking, serialNumbers.length]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the stable signature
  useEffect(() => {
    setDetails(seedSerialDetails(serialTracking, serialNumbers.length));
  }, [trackingSignature]);

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

  // Persist one serial (its number + its own properties + expiry). Keyed by
  // index so each unit's values are stored independently on its own entity.
  // `detailOverride` carries a just-edited property/expiry value so we don't
  // read a stale `details[index]` from an un-committed setState.
  const persistSerial = useCallback(
    async (index: number, detailOverride?: SerialDetail) => {
      const number = serialNumbers[index]?.number?.trim();
      if (!receipt?.id || !number) return;

      const error = validateSerialNumber(number, index);
      if (error) {
        setErrors((prev) => ({ ...prev, [index]: error }));
        return;
      }

      const detail = detailOverride ??
        details[index] ?? { properties: {}, expirationDate: "" };

      const formData = new FormData();
      formData.append("itemId", line.itemId!);
      formData.append("receiptId", receipt.id);
      formData.append("receiptLineId", line.id!);
      formData.append("trackingType", "serial");
      formData.append("index", index.toString());
      formData.append("serialNumber", number);
      if (detail.expirationDate) {
        formData.append("expiryDate", detail.expirationDate);
      }
      formData.append("properties", JSON.stringify(detail.properties ?? {}));

      try {
        const response = await fetch(path.to.receiptLinesTracking(receipt.id), {
          method: "POST",
          body: formData
        });

        if (response.ok) {
          setErrors((prev) => {
            const newErrors = { ...prev };
            delete newErrors[index];
            return newErrors;
          });
        } else {
          setErrors((prev) => ({
            ...prev,
            [index]: "Serial number already exists"
          }));
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("duplicate")) {
          setErrors((prev) => ({
            ...prev,
            [index]: "Serial number already exists for this item"
          }));
        }
      }
    },
    [
      serialNumbers,
      details,
      line.id,
      line.itemId,
      receipt?.id,
      validateSerialNumber
    ]
  );

  const updateSerialDetail = useCallback(
    (index: number, patch: Partial<SerialDetail>) => {
      setDetails((prev) => ({
        ...prev,
        [index]: {
          properties: patch.properties ?? prev[index]?.properties ?? {},
          expirationDate:
            patch.expirationDate ?? prev[index]?.expirationDate ?? ""
        }
      }));
    },
    []
  );

  const propertiesDisclosure = useDisclosure();
  const defaultOpen = serialNumbers.length <= 5;

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-6 p-6 border rounded-lg"
    >
      <div className="flex justify-between items-center gap-6">
        <Heading size="h4">Tracking Properties</Heading>
        <div className="flex items-center gap-2">
          <PrintButton
            sourceDocument="Receipt"
            sourceDocumentId={receipt?.id ?? ""}
            locationId={receipt?.locationId ?? undefined}
            context="receiving"
            fileRoutes={{
              pdf: (id, opts) =>
                path.to.file.receiptLabelsPdf(id, {
                  ...opts,
                  lineId: line.id!
                }),
              zpl: (id, opts) =>
                path.to.file.receiptLabelsZpl(id, {
                  ...opts,
                  lineId: line.id!
                })
            }}
          />
          <Button
            variant="secondary"
            leftIcon={<LuGroup />}
            size="md"
            onClick={propertiesDisclosure.onOpen}
          >
            Edit Properties
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {serialNumbers.map((serialNumber, index) => (
          <div
            key={`${line.id}-${index}-serial`}
            className="flex flex-col gap-3 p-4 border rounded-lg"
          >
            <div className="flex flex-col gap-1 max-w-md">
              <label className="text-xs text-muted-foreground flex items-center gap-2">
                <LuGroup /> <Trans>Serial</Trans> {index + 1}
              </label>
              <Input
                data-serial-index={index}
                placeholder={`Serial ${index + 1}`}
                isDisabled={isReadOnly}
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
                    number: newValue
                  };
                  onSerialNumbersChange(newSerialNumbers);
                }}
                onBlur={() => {
                  if (serialNumber.number.trim()) {
                    persistSerial(index);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (serialNumber.number.trim()) {
                      persistSerial(index);
                    }
                    const nextInput = containerRef.current?.querySelector(
                      `input[data-serial-index="${index + 1}"]`
                    );
                    if (nextInput) {
                      (nextInput as HTMLElement).focus();
                    }
                  }
                }}
                className={cn(errors[index] && "border-destructive")}
              />
              {errors[index] && (
                <span className="text-xs text-destructive">
                  {errors[index]}
                </span>
              )}
            </div>

            <Suspense fallback={null}>
              <Await resolve={batchProperties}>
                {(resolvedBatchProperties) => {
                  const defs =
                    resolvedBatchProperties?.data?.filter(
                      (p) => p.itemId === line.itemId
                    ) ?? [];
                  if (defs.length === 0 && !showExpiryField) return null;
                  return (
                    <Collapsible defaultOpen={defaultOpen}>
                      <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground">
                        <LuChevronDown />
                        <Trans>Properties</Trans>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-3">
                          {showExpiryField && (
                            <div className="flex flex-col gap-2 w-full">
                              <label className="text-xs text-muted-foreground flex items-center gap-2">
                                <LuCalendar /> <Trans>Expiration Date</Trans>
                              </label>
                              <DatePicker
                                isDisabled={isReadOnly}
                                value={
                                  details[index]?.expirationDate
                                    ? parseDate(details[index].expirationDate)
                                    : null
                                }
                                onChange={(date) => {
                                  const nextExpiry = date?.toString() ?? "";
                                  updateSerialDetail(index, {
                                    expirationDate: nextExpiry
                                  });
                                  if (serialNumber.number.trim()) {
                                    persistSerial(index, {
                                      properties:
                                        details[index]?.properties ?? {},
                                      expirationDate: nextExpiry
                                    });
                                  }
                                }}
                              />
                            </div>
                          )}
                          <BatchPropertiesFields
                            itemId={line.itemId!}
                            properties={defs}
                            isReadOnly={isReadOnly}
                            values={details[index]?.properties ?? {}}
                            onChange={(newProperties) => {
                              const nextProperties = newProperties as Record<
                                string,
                                string
                              >;
                              updateSerialDetail(index, {
                                properties: nextProperties
                              });
                              if (serialNumber.number.trim()) {
                                persistSerial(index, {
                                  properties: nextProperties,
                                  expirationDate:
                                    details[index]?.expirationDate ?? ""
                                });
                              }
                            }}
                          />
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                }}
              </Await>
            </Suspense>
          </div>
        ))}
      </div>

      {propertiesDisclosure.isOpen && (
        <Suspense fallback={null}>
          <Await resolve={batchProperties}>
            {(resolvedBatchProperties) => {
              return (
                <BatchPropertiesConfig
                  itemId={line.itemId!}
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

function SplitReceiptLineModal({
  line,
  onClose
}: {
  line: ReceiptLine;
  onClose: () => void;
}) {
  const { t } = useLingui();
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
            <input
              type="hidden"
              name="documentId"
              value={line.receiptId ?? ""}
            />
            <input type="hidden" name="documentLineId" value={line.id!} />
            <input
              type="hidden"
              name="locationId"
              value={line.locationId ?? ""}
            />
            <Number
              name="quantity"
              label={t`Quantity`}
              maxValue={line.orderQuantity ?? 0 - 0.0001}
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
          [field]: value
        };
        return [...acc, newItem];
      }
      return acc;
    }, []);
};

export default ReceiptLines;

function useReceiptFiles(receiptId: string) {
  const { t } = useLingui();
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
        toast.error(t`Carbon client not available`);
        return;
      }

      for (const file of files) {
        const fileName = getPath({ name: file.name }, lineId);
        toast.info(`Uploading ${file.name}`);
        const fileUpload = await carbon.storage
          .from("private")
          .upload(fileName, file, {
            cacheControl: `${12 * 60 * 60}`,
            upsert: true
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
            fetcherKey: `${lineId}:${file.name}`
          });
        }
      }
      revalidator.revalidate();
    },
    [carbon, revalidator, getPath, receiptId, submit, t]
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
