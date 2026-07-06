import { useCarbon } from "@carbon/auth";
import { Number, Submit, ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Combobox,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputRightElement,
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
  useDisclosure,
  VStack
} from "@carbon/react";
import type { TrackedEntityAttributes } from "@carbon/utils";
import { getItemReadableId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";
import {
  LuCheck,
  LuCircleAlert,
  LuEllipsisVertical,
  LuGroup,
  LuInfo,
  LuQrCode,
  LuSplit,
  LuTrash
} from "react-icons/lu";
import {
  Outlet,
  useFetcher,
  useFetchers,
  useParams,
  useSubmit
} from "react-router";
import { Empty, ItemThumbnail, PrintButton } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useStorageUnits } from "~/components/Form/StorageUnit";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { ConfirmDelete } from "~/components/Modals";
import { useRouteData } from "~/hooks";
import type {
  getBatchNumbersForItem,
  getSerialNumbersForItem,
  ItemTracking,
  Shipment,
  ShipmentLine,
  ShipmentLineTracking
} from "~/modules/inventory";
import { splitValidator } from "~/modules/inventory";
import type { action as shipmentLinesUpdateAction } from "~/routes/x+/shipment+/lines.update";
import { useItems } from "~/stores";
import { path } from "~/utils/path";

const ShipmentLines = () => {
  const { shipmentId } = useParams();
  if (!shipmentId) throw new Error("shipmentId not found");

  const fetcher = useFetcher<typeof shipmentLinesUpdateAction>();
  const [items] = useItems();

  const routeData = useRouteData<{
    shipment: Shipment;
    shipmentLines: ShipmentLine[];
    shipmentLineTracking: ShipmentLineTracking[];
    fixedAssetLines: {
      id: string;
      salesOrderLineId: string;
      assetId: string;
      assetName: string | null;
      assetReadableId: string | null;
      description: string | null;
      shipped: boolean;
      serialNumber: string | null;
    }[];
  }>(path.to.shipment(shipmentId));

  const shipmentsById = new Map<string, ShipmentLine>(
    // @ts-expect-error
    (routeData?.shipmentLines ?? []).map((line) => [line.id, line])
  );
  const pendingShipmentLines = usePendingShipmentLines();

  for (let pendingShipmentLine of pendingShipmentLines) {
    let item = shipmentsById.get(pendingShipmentLine.id);
    let merged = item
      ? { ...item, ...pendingShipmentLine }
      : pendingShipmentLine;
    shipmentsById.set(pendingShipmentLine.id, merged as ShipmentLine);
  }

  const shipmentLines = Array.from(shipmentsById.values()).map((line) => ({
    ...line,
    shippedQuantity: line.shippedQuantity ?? 0
  }));

  const [serialNumbersByLineId, setSerialNumbersByLineId] = useState<
    Record<string, { index: number; id: string }[]>
  >(() => {
    return shipmentLines.reduce((acc, line) => {
      if (!line.requiresSerialTracking) return acc;

      const trackedEntitiesForLine = routeData?.shipmentLineTracking?.filter(
        (t) => {
          const attributes = t.attributes as TrackedEntityAttributes;
          return attributes["Shipment Line"] === line.id;
        }
      );

      if (!trackedEntitiesForLine) return acc;
      return {
        ...acc,
        [line.id!]: Array.from(
          { length: line.shippedQuantity || 0 },
          (_, index) => {
            const serialNumberEntity = trackedEntitiesForLine.find((t) => {
              const attributes = t.attributes as TrackedEntityAttributes;
              return attributes["Shipment Line Index"] === index;
            });

            const serialNumber =
              serialNumberEntity?.readableId || serialNumberEntity?.id || "";

            return {
              index,
              id: serialNumber
            };
          }
        )
      };
    }, {});
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    setSerialNumbersByLineId(
      shipmentLines.reduce((acc, line) => {
        if (!line.requiresSerialTracking) return acc;

        const trackedEntitiesForLine = routeData?.shipmentLineTracking?.filter(
          (t) => {
            const attributes = t.attributes as TrackedEntityAttributes;
            return attributes["Shipment Line"] === line.id;
          }
        );

        if (!trackedEntitiesForLine) return acc;
        return {
          ...acc,
          [line.id!]: Array.from(
            { length: line.shippedQuantity || 0 },
            (_, index) => {
              const serialNumberEntity = trackedEntitiesForLine.find((t) => {
                const attributes = t.attributes as TrackedEntityAttributes;
                return attributes["Shipment Line Index"] === index;
              });

              const serialNumber =
                serialNumberEntity?.readableId || serialNumberEntity?.id || "";

              return {
                index,
                id: serialNumber
              };
            }
          )
        };
      }, {})
    );
  }, [routeData?.shipment?.sourceDocumentId, routeData?.shipmentLines?.length]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdateShipmentLine = useCallback(
    async ({
      lineId,
      field,
      value
    }:
      | {
          lineId: string;
          field: "shippedQuantity";
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
        action: path.to.bulkUpdateShipmentLine
      });
    },

    []
  );

  const isPosted = routeData?.shipment?.status === "Posted";
  const isVoided = routeData?.shipment?.status === "Voided";
  const isReadOnly = isPosted || isVoided;

  return (
    <>
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>
              <Trans>Shipment Lines</Trans>
            </CardTitle>
          </CardHeader>
        </HStack>

        <CardContent>
          <div className="border rounded-lg">
            {shipmentLines.length === 0 ? (
              <Empty className="py-6" />
            ) : (
              shipmentLines
                .map((line) => ({
                  ...line,
                  itemReadableId: getItemReadableId(items, line.itemId) ?? ""
                }))
                .sort((a, b) =>
                  a.itemReadableId.localeCompare(b.itemReadableId)
                )
                .map((line, index) => {
                  const tracking = routeData?.shipmentLineTracking?.find(
                    (t) => {
                      const attributes =
                        t.attributes as TrackedEntityAttributes;
                      return attributes["Shipment Line"] === line.id;
                    }
                  );
                  return (
                    <ShipmentLineItem
                      key={line.id}
                      line={line}
                      shipment={routeData?.shipment}
                      hasTrackingLabel={
                        routeData?.shipmentLineTracking?.some((t) => {
                          const attributes =
                            t.attributes as TrackedEntityAttributes;
                          return attributes["Shipment Line"] === line.id;
                        }) ?? false
                      }
                      isReadOnly={isReadOnly}
                      onUpdate={onUpdateShipmentLine}
                      className={
                        index === shipmentLines.length - 1 ? "border-none" : ""
                      }
                      serialNumbers={serialNumbersByLineId[line.id!] || []}
                      onSerialNumbersChange={(newSerialNumbers) => {
                        setSerialNumbersByLineId((prev) => ({
                          ...prev,
                          [line.id!]: newSerialNumbers
                        }));
                      }}
                      tracking={tracking}
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
                <ShipmentFixedAssetLineItem
                  key={line.id}
                  line={line}
                  isReadOnly={isReadOnly}
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

function ShipmentFixedAssetLineItem({
  line,
  isReadOnly,
  className
}: {
  line: {
    id: string;
    salesOrderLineId: string;
    assetId: string;
    assetName: string | null;
    assetReadableId: string | null;
    description: string | null;
    shipped: boolean;
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
      action: path.to.shipmentFixedAssetLineUpdate
    });
  };

  return (
    <div className={cn("flex items-center gap-4 p-6", className)}>
      <Checkbox
        isChecked={line.shipped}
        disabled={isReadOnly}
        onCheckedChange={(checked) =>
          updateField("shipped", String(checked === true))
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

function ShipmentLineItem({
  line,
  shipment,
  className,
  hasTrackingLabel,
  isReadOnly,
  tracking,
  serialNumbers,
  onUpdate,
  onSerialNumbersChange
}: {
  line: ShipmentLine;
  shipment?: Shipment;
  className?: string;
  hasTrackingLabel: boolean;
  isReadOnly: boolean;
  tracking: ItemTracking | undefined;
  serialNumbers: { index: number; id: string }[];
  onSerialNumbersChange: (
    serialNumbers: { index: number; id: string }[]
  ) => void;
  onUpdate: ({
    lineId,
    field,
    value
  }:
    | {
        lineId: string;
        field: "shippedQuantity";
        value: number;
      }
    | {
        lineId: string;
        field: "storageUnitId";
        value: string;
      }) => Promise<void>;
}) {
  const { t } = useLingui();
  const [items] = useItems();
  const item = items.find((p) => p.id === line.itemId);
  const unitsOfMeasure = useUnitOfMeasure();
  const splitDisclosure = useDisclosure();
  const deleteDisclosure = useDisclosure();

  // Check if shipped quantity exceeds job quantity for job fulfillments
  const isJobOverShipped =
    line.fulfillment?.type === "Job" &&
    (line.shippedQuantity || 0) > (line.fulfillment?.job?.quantity || 0);

  return (
    <div className={cn("flex flex-col border-b p-6 gap-6 relative", className)}>
      <div className="absolute top-6 right-6">
        {line.fulfillment?.type === "Job" ? (
          <div className="flex flex-col items-end gap-0">
            <span>Job</span>
            <span className="text-xs text-muted-foreground">
              {line.fulfillment?.job?.jobId}
            </span>
          </div>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label={t`Line options`}
                variant="secondary"
                icon={<LuEllipsisVertical />}
                size="md"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                disabled={isReadOnly}
                onClick={splitDisclosure.onOpen}
              >
                <DropdownMenuIcon icon={<LuSplit />} />
                {t`Split shipment line`}
              </DropdownMenuItem>
              <DropdownMenuItem
                destructive
                disabled={isReadOnly}
                onClick={deleteDisclosure.onOpen}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                {t`Delete shipment line`}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="flex flex-1 justify-between items-center w-full">
        <HStack spacing={4} className="w-1/2">
          <HStack spacing={4}>
            <ItemThumbnail
              size="md"
              thumbnailPath={line.thumbnailPath}
              type={(item?.type as "Part") ?? "Part"}
            />

            <VStack spacing={0} className="max-w-[380px] w-full">
              <div className="w-full overflow-hidden">
                <span className="text-sm font-medium truncate block w-full">
                  {item?.readableIdWithRevision}
                </span>
                <span className="text-xs text-muted-foreground truncate block w-full">
                  {item?.name}
                </span>
              </div>
              <div className="mt-2">
                <Enumerable
                  value={
                    unitsOfMeasure?.find((u) => u.value === line.unitOfMeasure)
                      ?.label ?? null
                  }
                />
              </div>
            </VStack>
          </HStack>
        </HStack>
        <div className="flex flex-grow items-center justify-between gap-2 pl-4 w-1/2">
          <HStack spacing={4}>
            <VStack spacing={1}>
              <div className="flex items-center justify-between gap-1 w-full">
                <label className="text-xs text-muted-foreground">Shipped</label>
                {isJobOverShipped && (
                  <Tooltip>
                    <TooltipTrigger>
                      <LuCircleAlert className="text-red-500" />
                    </TooltipTrigger>
                    <TooltipContent>
                      Shipped quantity exceeds job quantity
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              <NumberField
                value={line.shippedQuantity || 0}
                onChange={(value) => {
                  // Default to 0 if value is NaN, null, or undefined
                  const safeValue = isNaN(value) || value == null ? 0 : value;
                  onUpdate({
                    lineId: line.id!,
                    field: "shippedQuantity",
                    value: safeValue
                  });
                  // Adjust serial numbers array size while preserving existing values
                  if (safeValue > serialNumbers.length) {
                    onSerialNumbersChange([
                      ...serialNumbers,
                      ...Array.from(
                        { length: safeValue - serialNumbers.length },
                        (_, i) => ({
                          index: i,
                          id: ""
                        })
                      )
                    ]);
                  } else if (safeValue < serialNumbers.length) {
                    onSerialNumbersChange(serialNumbers.slice(0, safeValue));
                  }
                }}
              >
                <NumberInput
                  className={cn(
                    "disabled:bg-transparent disabled:opacity-100 min-w-[100px]",
                    isJobOverShipped && "border-red-500 border-2"
                  )}
                  isDisabled={
                    isReadOnly ||
                    (line.fulfillment?.type === "Job" &&
                      (line.requiresSerialTracking ?? false))
                  }
                  size="sm"
                  min={0}
                />
              </NumberField>
            </VStack>
            <VStack spacing={1} className="text-center items-center">
              <label className="text-xs text-muted-foreground">Ordered</label>
              <span className="text-sm py-1.5">{line.orderQuantity || 0}</span>
            </VStack>

            <VStack spacing={1} className="text-center items-center">
              <label className="text-xs text-muted-foreground">
                Outstanding
              </label>
              <HStack className="justify-center">
                <span className="text-sm py-1.5">
                  {(line.outstandingQuantity || 0) -
                    (line.shippedQuantity || 0)}
                </span>

                {(line.shippedQuantity || 0) >
                  (line.outstandingQuantity || 0) && (
                  <Tooltip>
                    <TooltipTrigger>
                      <LuCircleAlert className="text-red-500" />
                    </TooltipTrigger>
                    <TooltipContent>
                      There are more shipped than ordered
                    </TooltipContent>
                  </Tooltip>
                )}
              </HStack>
            </VStack>
          </HStack>
          {line.fulfillment?.type !== "Job" &&
            shipment?.sourceDocument !== "Purchase Order" && (
              <StorageUnit
                locationId={line.locationId}
                storageUnitId={line.storageUnitId}
                itemId={line.itemId}
                isReadOnly={isReadOnly}
                onChange={(storageUnit) => {
                  onUpdate({
                    lineId: line.id!,
                    field: "storageUnitId",
                    value: storageUnit
                  });
                }}
              />
            )}
        </div>
      </div>
      {line.requiresBatchTracking && (
        <BatchForm
          shipment={shipment}
          line={line}
          hasTrackingLabel={hasTrackingLabel}
          isReadOnly={isReadOnly}
          tracking={tracking}
          onUpdate={onUpdate}
        />
      )}
      {line.requiresSerialTracking && (
        <SerialForm
          shipment={shipment}
          line={line}
          hasTrackingLabel={hasTrackingLabel}
          serialNumbers={serialNumbers}
          isReadOnly={isReadOnly}
          onSerialNumbersChange={onSerialNumbersChange}
        />
      )}
      {splitDisclosure.isOpen && (
        <SplitShipmentLineModal line={line} onClose={splitDisclosure.onClose} />
      )}
      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          name="Shipment Line"
          text="Are you sure you want to delete this shipment line?"
          action={path.to.shipmentLineDelete(line.id!)}
          onCancel={deleteDisclosure.onClose}
          onSubmit={deleteDisclosure.onClose}
        />
      )}
    </div>
  );
}

function BatchForm({
  line,
  shipment,
  hasTrackingLabel,
  tracking,
  isReadOnly,
  onUpdate
}: {
  line: ShipmentLine;
  shipment?: Shipment;
  hasTrackingLabel: boolean;
  isReadOnly: boolean;
  tracking: ItemTracking | undefined;
  onUpdate: ({
    lineId,
    field,
    value
  }: {
    lineId: string;
    field: "storageUnitId";
    value: string;
  }) => Promise<void>;
}) {
  const { t } = useLingui();
  const submit = useSubmit();
  const [values, setValues] = useState<{
    number: string;
    properties: any;
  }>(() => {
    if (tracking) {
      return {
        number: tracking.readableId || "",
        properties: Object.entries(
          (tracking.attributes ?? {}) as TrackedEntityAttributes
        )
          .filter(
            ([key]) =>
              ![
                "Shipment Line",
                "Shipment",
                "Shipment Line Index",
                "Receipt Line",
                "Receipt"
              ].includes(key)
          )
          .reduce((acc, [key, value]) => ({ ...acc, [key]: value || "" }), {})
      };
    }
    return {
      number: "",
      properties: {}
    };
  });

  const { data: batchNumbers } = useBatchNumbers(line.itemId!);
  const [error, setError] = useState<string | null>(null);
  const { carbon } = useCarbon();

  // Check if the batch number is valid and in the list
  const resolvedBatch = values.number
    ? resolveTrackedEntity(values.number, batchNumbers?.data ?? [])
    : null;
  // @ts-expect-error TS2339 - TODO: fix type
  const isBatchNumberValid = resolvedBatch?.status === "Available";

  // Verify batch quantity is sufficient for the shipped quantity
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (
      values.number &&
      batchNumbers?.data &&
      (line.shippedQuantity || 0) > 0
    ) {
      const batchNumber = resolveTrackedEntity(
        values.number,
        batchNumbers.data
      );

      if (
        batchNumber &&
        // @ts-expect-error TS2339 - TODO: fix type
        batchNumber.status === "Available" &&
        // @ts-expect-error TS2339 - TODO: fix type
        (line.shippedQuantity || 0) > batchNumber.quantity
      ) {
        setValues({
          ...values,
          number: ""
        });
      }
    }
  }, [line.shippedQuantity]);

  const getStorageUnitFromBatchNumber = async (trackedEntityId: string) => {
    if (!carbon) return;

    const response = await carbon
      .from("itemLedger")
      .select("storageUnitId")
      .eq("trackedEntityId", trackedEntityId)
      .order("createdAt", { ascending: false })
      .single();

    if (response?.data?.storageUnitId) {
      onUpdate({
        lineId: line.id!,
        field: "storageUnitId",
        value: response.data.storageUnitId
      });
    }
  };

  // Fetch the latest storage unit for the selected batch number
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (values.number && values.number.trim()) {
      const resolved = resolveTrackedEntity(
        values.number,
        batchNumbers?.data ?? []
      );
      if (resolved) {
        getStorageUnitFromBatchNumber(resolved.id);
      }
    }
  }, [values.number]);

  const updateBatchNumber = async (newValues: typeof values, isNew = false) => {
    if (!shipment?.id || !newValues.number.trim()) return;

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

    // Check if batch number is available (by id or readableId)
    const batchNumber = resolveTrackedEntity(
      valuesToSubmit.number.trim(),
      batchNumbers?.data ?? []
    );

    // @ts-expect-error TS2339 - TODO: fix type
    if (batchNumber && batchNumber.status !== "Available") {
      // @ts-expect-error TS2339 - TODO: fix type
      setError(`Batch number is ${batchNumber.status}`);
      setValues({
        ...valuesToSubmit,
        number: ""
      });
      return;
    } else if (!batchNumber && valuesToSubmit.number.trim()) {
      // If batch number is not in the list, don't proceed with the network request
      setError("Batch number not found");
      return;
    } else {
      setError(null);
    }

    // Check if the shipped quantity exceeds the batch quantity
    // @ts-expect-error TS2339 - TODO: fix type
    if (batchNumber && (line.shippedQuantity || 0) > batchNumber.quantity) {
      setError(
        // @ts-expect-error TS2339 - TODO: fix type
        `Shipped quantity exceeds batch quantity (${batchNumber.quantity})`
      );
      setValues({
        ...valuesToSubmit,
        number: ""
      });
      return;
    }

    // @ts-expect-error TS2339 - TODO: fix type
    if (batchNumber && batchNumber.attributes) {
      // @ts-expect-error TS2339 - TODO: fix type
      const attributes = batchNumber.attributes as TrackedEntityAttributes;
      if (
        attributes["Shipment Line"] &&
        attributes["Shipment Line"] !== line.id &&
        // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
        attributes["Shipment"] === shipment?.id
      ) {
        setError("Batch number is already used on another shipment line");
        setValues({
          ...valuesToSubmit,
          number: ""
        });
      }
    }

    const formData = new FormData();
    formData.append("itemId", line.itemId!);
    formData.append("shipmentId", shipment.id);
    formData.append("shipmentLineId", line.id!);
    formData.append("trackingType", "batch");
    formData.append("trackedEntityId", batchNumber!.id);
    formData.append("properties", JSON.stringify(valuesToSubmit.properties));
    formData.append("quantity", (line.shippedQuantity || 0).toString());

    submit(formData, {
      method: "post",
      action: path.to.shipmentLinesTracking(shipment.id),
      navigate: false
    });
  };

  return (
    <div className="flex flex-col gap-6 w-full p-6 border rounded-lg">
      <div className="flex justify-between items-center gap-4">
        <Heading size="h4">Tracking Number</Heading>
        {hasTrackingLabel && (
          <PrintButton
            sourceDocument="Shipment"
            sourceDocumentId={shipment?.id ?? ""}
            locationId={shipment?.locationId ?? undefined}
            context="shipping"
            fileRoutes={{
              pdf: (id, opts) =>
                path.to.file.shipmentLabelsPdf(id, {
                  ...opts,
                  lineId: line.id!
                }),
              zpl: (id, opts) =>
                path.to.file.shipmentLabelsZpl(id, {
                  ...opts,
                  lineId: line.id!
                })
            }}
          />
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 ">
        <div className="flex flex-col gap-2 w-full">
          <label className="text-xs text-muted-foreground flex items-center gap-2">
            <LuGroup /> Batch Number
          </label>

          <div className="flex flex-col gap-1">
            <InputGroup isDisabled={isReadOnly}>
              <Input
                placeholder={t`Batch number`}
                value={values.number}
                onChange={(e) => {
                  setValues({
                    ...values,
                    number: e.target.value
                  });
                }}
                onBlur={() => {
                  updateBatchNumber(values, true);
                }}
                className={cn(error && "border-destructive")}
              />
              <InputRightElement className="pl-2">
                {isBatchNumberValid ? (
                  <LuCheck className="text-emerald-500" />
                ) : (
                  <LuQrCode />
                )}
              </InputRightElement>
            </InputGroup>
            {error && <span className="text-xs text-destructive">{error}</span>}
          </div>
        </div>
      </div>
      {values.number &&
        batchNumbers?.data &&
        (() => {
          const batchNumber = resolveTrackedEntity(
            values.number,
            batchNumbers.data
          );
          if (!batchNumber) return null;
          // @ts-expect-error TS2339 - TODO: fix type
          if ((line.shippedQuantity || 0) >= batchNumber.quantity) return null;
          return (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
              <LuInfo className="h-3.5 w-3.5 flex-shrink-0" />
              <span>
                Shipped quantity is less than batch quantity. A new batch will
                be created for the remaining quantity when posted.
              </span>
            </div>
          );
        })()}
    </div>
  );
}

function SerialForm({
  line,
  shipment,
  hasTrackingLabel,
  serialNumbers,
  isReadOnly,
  onSerialNumbersChange
}: {
  line: ShipmentLine;
  shipment?: Shipment;
  hasTrackingLabel: boolean;
  serialNumbers: { index: number; id: string }[];
  isReadOnly: boolean;
  onSerialNumbersChange: (
    serialNumbers: { index: number; id: string }[]
  ) => void;
}) {
  const [errors, setErrors] = useState<Record<number, string>>({});
  const { data: serialNumbersData } = useSerialNumbers(
    line.itemId!,
    isReadOnly
  );

  // Check for duplicates within the current form
  const validateSerialNumber = useCallback(
    (serialNumberId: string, currentIndex: number) => {
      if (!serialNumberId) return null;

      // Check for duplicates within the form (resolve both sides to entity id)
      const resolvedCurrent = resolveTrackedEntity(
        serialNumberId,
        serialNumbersData?.data ?? []
      );
      const isDuplicate = serialNumbers.some((sn, idx) => {
        if (idx === currentIndex || !sn.id) return false;
        const resolvedOther = resolveTrackedEntity(
          sn.id,
          serialNumbersData?.data ?? []
        );
        return (
          sn.id === serialNumberId ||
          (resolvedCurrent &&
            resolvedOther &&
            resolvedCurrent.id === resolvedOther.id)
        );
      });

      if (isDuplicate) {
        return "Duplicate serial number";
      }

      // Check if serial number is available (by id or readableId)
      const serialNumber = resolveTrackedEntity(
        serialNumberId,
        serialNumbersData?.data ?? []
      );

      if (!serialNumber) {
        return "Serial number not found";
      }

      // @ts-expect-error TS2339 - TODO: fix type
      if (serialNumber.status !== "Available") {
        // @ts-expect-error TS2339 - TODO: fix type
        return `Serial number is ${serialNumber.status}`;
      }

      return null;
    },
    [serialNumbers, serialNumbersData?.data]
  );

  const updateSerialNumber = useCallback(
    async (serialNumber: { index: number; id: string }) => {
      if (!shipment?.id || !serialNumber.id) return;

      const error = validateSerialNumber(serialNumber.id, serialNumber.index);
      if (error) {
        setErrors((prev) => ({ ...prev, [serialNumber.index]: error }));

        // Clear the input value but keep the error message
        const newSerialNumbers = [...serialNumbers];
        newSerialNumbers[serialNumber.index] = {
          index: serialNumber.index,
          id: ""
        };
        onSerialNumbersChange(newSerialNumbers);
        return;
      }

      // Resolve scanned value to actual tracked entity id
      const resolvedEntity = resolveTrackedEntity(
        serialNumber.id.trim(),
        serialNumbersData?.data ?? []
      );

      const formData = new FormData();
      formData.append("trackingType", "serial");
      formData.append("itemId", line.itemId!);
      formData.append("shipmentId", shipment.id);
      formData.append("shipmentLineId", line.id!);
      formData.append("index", serialNumber.index.toString());
      formData.append(
        "trackedEntityId",
        resolvedEntity?.id ?? serialNumber.id.trim()
      );

      try {
        const response = await fetch(
          path.to.shipmentLinesTracking(shipment.id),
          {
            method: "POST",
            body: formData
          }
        );

        if (response.ok) {
          // Clear error if submission was successful
          setErrors((prev) => {
            const newErrors = { ...prev };
            delete newErrors[serialNumber.index];
            return newErrors;
          });
        } else {
          const responseData = await response.json();
          const errorMessage =
            responseData.message || "Failed to track serial number";

          setErrors((prev) => ({
            ...prev,
            [serialNumber.index]: errorMessage
          }));

          // Clear the input value but keep the error message
          const newSerialNumbers = [...serialNumbers];
          newSerialNumbers[serialNumber.index] = {
            index: serialNumber.index,
            id: ""
          };
          onSerialNumbersChange(newSerialNumbers);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("available")) {
          setErrors((prev) => ({
            ...prev,
            [serialNumber.index]: "Serial number is not available"
          }));

          // Clear the input value but keep the error message
          const newSerialNumbers = [...serialNumbers];
          newSerialNumbers[serialNumber.index] = {
            index: serialNumber.index,
            id: ""
          };
          onSerialNumbersChange(newSerialNumbers);
        }
      }
    },
    [
      line.id,
      line.itemId,
      shipment?.id,
      validateSerialNumber,
      serialNumbers,
      serialNumbersData?.data,
      onSerialNumbersChange
    ]
  );

  return (
    <div className="flex flex-col gap-6 p-6 border rounded-lg">
      <div className="flex justify-between items-center gap-4">
        <Heading size="h4">Tracking Numbers</Heading>
        {hasTrackingLabel && (
          <PrintButton
            sourceDocument="Shipment"
            sourceDocumentId={shipment?.id ?? ""}
            locationId={shipment?.locationId ?? undefined}
            context="shipping"
            fileRoutes={{
              pdf: (id, opts) =>
                path.to.file.shipmentLabelsPdf(id, {
                  ...opts,
                  lineId: line.id!
                }),
              zpl: (id, opts) =>
                path.to.file.shipmentLabelsZpl(id, {
                  ...opts,
                  lineId: line.id!
                })
            }}
          />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-4 gap-y-3">
        {serialNumbers.map((serialNumber, index) => {
          // Check if the serial number is valid and in the list
          const resolvedSerial = serialNumber.id
            ? resolveTrackedEntity(
                serialNumber.id,
                serialNumbersData?.data ?? []
              )
            : null;
          // @ts-expect-error TS2339 - TODO: fix type
          const isSerialNumberValid = resolvedSerial?.status === "Available";

          return (
            <div
              key={`${line.id}-${index}-serial`}
              className="flex flex-col gap-1"
            >
              <InputGroup isDisabled={isReadOnly}>
                <Input
                  placeholder={`Tracking Number ${index + 1}`}
                  value={serialNumber.id}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    const newSerialNumbers = [...serialNumbers];
                    newSerialNumbers[index] = {
                      index,
                      id: newValue
                    };
                    onSerialNumbersChange(newSerialNumbers);
                  }}
                  onBlur={(e) => {
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

                    if (!error) {
                      updateSerialNumber({
                        index,
                        id: newValue
                      });
                    } else {
                      // Clear the input value but keep the error message
                      const newSerialNumbers = [...serialNumbers];
                      newSerialNumbers[index] = {
                        index,
                        id: ""
                      };
                      onSerialNumbersChange(newSerialNumbers);
                    }
                  }}
                  className={cn(errors[index] && "border-destructive")}
                />
                <InputRightElement className="pl-2">
                  {isSerialNumberValid ? (
                    <LuCheck className="text-emerald-500" />
                  ) : (
                    <LuQrCode />
                  )}
                </InputRightElement>
              </InputGroup>
              {errors[index] && (
                <span className="text-xs text-destructive">
                  {errors[index]}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SplitShipmentLineModal({
  line,
  onClose
}: {
  line: ShipmentLine;
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
          action={path.to.shipmentLineSplit}
          validator={splitValidator}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>Split Shipment Line</ModalTitle>
            <ModalDescription>
              Select the quantity that you'd like to split into a new line.
            </ModalDescription>
          </ModalHeader>

          <ModalBody>
            <input type="hidden" name="documentId" value={line.shipmentId!} />
            <input type="hidden" name="documentLineId" value={line.id!} />
            <input
              type="hidden"
              name="locationId"
              value={line.locationId ?? ""}
            />
            <Number name="quantity" label={t`Quantity`} minValue={0.0001} />
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

function StorageUnit({
  locationId,
  storageUnitId,
  itemId,
  isReadOnly,
  onChange
}: {
  locationId: string | null;
  storageUnitId: string | null;
  itemId: string | null;
  isReadOnly: boolean;
  onChange: (storageUnit: string) => void;
}) {
  const { options } = useStorageUnits(
    locationId ?? undefined,
    itemId ?? undefined
  );

  if (!locationId) return null;

  return (
    <VStack spacing={1} className="min-w-[140px] text-sm">
      <label className="text-xs text-muted-foreground">
        <Trans>Storage Unit</Trans>
      </label>
      <div className="py-1">
        <Combobox
          value={storageUnitId ?? undefined}
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
    </VStack>
  );
}

const usePendingShipmentLines = () => {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };

  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return fetcher.formAction === path.to.bulkUpdateShipmentLine;
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

function resolveTrackedEntity(
  scannedValue: string,
  entities: { id: string; readableId: string | null }[]
) {
  return (
    entities.find((e) => e.id === scannedValue) ??
    entities.find((e) => e.readableId === scannedValue) ??
    null
  );
}

export default ShipmentLines;

export function useSerialNumbers(itemId?: string, isReadOnly = false) {
  const serialNumbersFetcher =
    useFetcher<Awaited<ReturnType<typeof getSerialNumbersForItem>>>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (itemId) {
      serialNumbersFetcher.load(path.to.api.serialNumbers(itemId, isReadOnly));
    }
  }, [itemId]);

  return { data: serialNumbersFetcher.data };
}

export function useBatchNumbers(itemId?: string) {
  const batchNumbersFetcher =
    useFetcher<Awaited<ReturnType<typeof getBatchNumbersForItem>>>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (itemId) {
      batchNumbersFetcher.load(path.to.api.batchNumbers(itemId));
    }
  }, [itemId]);

  return { data: batchNumbersFetcher.data };
}
