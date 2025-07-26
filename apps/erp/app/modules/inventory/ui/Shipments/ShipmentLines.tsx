import { useCarbon } from "@carbon/auth";
import { Number, Submit, ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Combobox,
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
  SplitButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure,
  VStack,
} from "@carbon/react";
import type { TrackedEntityAttributes } from "@carbon/utils";
import { labelSizes } from "@carbon/utils";
import {
  Outlet,
  useFetcher,
  useFetchers,
  useParams,
  useSubmit,
} from "@remix-run/react";
import { useCallback, useEffect, useState } from "react";
import {
  LuCheck,
  LuCircleAlert,
  LuEllipsisVertical,
  LuGroup,
  LuQrCode,
  LuSplit,
  LuTrash,
} from "react-icons/lu";
import { Empty, ItemThumbnail } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useShelves } from "~/components/Form/Shelf";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { ConfirmDelete } from "~/components/Modals";
import { useRouteData } from "~/hooks";
import type {
  getBatchNumbersForItem,
  getSerialNumbersForItem,
  ItemTracking,
  Shipment,
  ShipmentLine,
  ShipmentLineTracking,
} from "~/modules/inventory";
import { splitValidator } from "~/modules/inventory";
import type { action as shipmentLinesUpdateAction } from "~/routes/x+/shipment+/lines.update";
import { useItems } from "~/stores";
import { getItemReadableId } from "~/utils/items";
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
  }>(path.to.shipment(shipmentId));

  const shipmentsById = new Map<string, ShipmentLine>(
    // @ts-ignore
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
    shippedQuantity: line.shippedQuantity ?? 0,
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

            const serialNumber = serialNumberEntity?.id || "";

            return {
              index,
              id: serialNumber,
            };
          }
        ),
      };
    }, {});
  });

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

              const serialNumber = serialNumberEntity?.id || "";

              return {
                index,
                id: serialNumber,
              };
            }
          ),
        };
      }, {})
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeData?.shipment?.sourceDocumentId, routeData?.shipmentLines?.length]);

  const onUpdateShipmentLine = useCallback(
    async ({
      lineId,
      field,
      value,
    }:
      | {
          lineId: string;
          field: "shippedQuantity";
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
        action: path.to.bulkUpdateShipmentLine,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const isPosted = routeData?.shipment?.status === "Posted";

  return (
    <>
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Shipment Lines</CardTitle>
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
                  itemReadableId: getItemReadableId(items, line.itemId) ?? "",
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
                          return (
                            attributes["Shipment Line"] === line.id &&
                            attributes["Split Entity ID"]
                          );
                        }) ?? false
                      }
                      isReadOnly={isPosted}
                      onUpdate={onUpdateShipmentLine}
                      className={
                        index === shipmentLines.length - 1 ? "border-none" : ""
                      }
                      serialNumbers={serialNumbersByLineId[line.id!] || []}
                      onSerialNumbersChange={(newSerialNumbers) => {
                        setSerialNumbersByLineId((prev) => ({
                          ...prev,
                          [line.id!]: newSerialNumbers,
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
      <Outlet />
    </>
  );
};

function ShipmentLineItem({
  line,
  shipment,
  className,
  hasTrackingLabel,
  isReadOnly,
  tracking,
  serialNumbers,
  onUpdate,
  onSerialNumbersChange,
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
    value,
  }:
    | {
        lineId: string;
        field: "shippedQuantity";
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
  const splitDisclosure = useDisclosure();
  const deleteDisclosure = useDisclosure();

  // Check if shipped quantity exceeds job quantity for job fulfillments
  const isJobOverShipped =
    line.fulfillment?.type === "Job" &&
    (line.shippedQuantity || 0) > (line.fulfillment?.job?.quantity || 0);

  return (
    <div
      className={cn(
        "flex flex-col border-b p-6 gap-6 relative",

        className
      )}
    >
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
                aria-label="Line options"
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
                Split shipment line
              </DropdownMenuItem>
              <DropdownMenuItem
                destructive
                disabled={isReadOnly}
                onClick={deleteDisclosure.onOpen}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                Delete shipment line
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
                  {item?.name}
                </span>
                <span className="text-xs text-muted-foreground truncate block w-full">
                  {item?.readableIdWithRevision}
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
                  onUpdate({
                    lineId: line.id!,
                    field: "shippedQuantity",
                    value,
                  });
                  // Adjust serial numbers array size while preserving existing values
                  if (value > serialNumbers.length) {
                    onSerialNumbersChange([
                      ...serialNumbers,
                      ...Array.from(
                        { length: value - serialNumbers.length },
                        (_, i) => ({
                          index: i,
                          id: "",
                        })
                      ),
                    ]);
                  } else if (value < serialNumbers.length) {
                    onSerialNumbersChange(serialNumbers.slice(0, value));
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
                  {isReadOnly
                    ? (line.outstandingQuantity || 0) -
                      (line.shippedQuantity || 0)
                    : line.outstandingQuantity || 0}
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
              <Shelf
                locationId={line.locationId}
                shelfId={line.shelfId}
                isReadOnly={isReadOnly}
                onChange={(shelf) => {
                  onUpdate({
                    lineId: line.id!,
                    field: "shelfId",
                    value: shelf,
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
  onUpdate,
}: {
  line: ShipmentLine;
  shipment?: Shipment;
  hasTrackingLabel: boolean;
  isReadOnly: boolean;
  tracking: ItemTracking | undefined;
  onUpdate: ({
    lineId,
    field,
    value,
  }: {
    lineId: string;
    field: "shelfId";
    value: string;
  }) => Promise<void>;
}) {
  const submit = useSubmit();
  const [values, setValues] = useState<{
    number: string;
    properties: any;
  }>(() => {
    if (tracking) {
      return {
        number: tracking.id || "",
        properties: Object.entries(
          (tracking.attributes ?? {}) as TrackedEntityAttributes
        )
          .filter(
            ([key]) =>
              ![
                "Batch Number",
                "Shipment Line",
                "Shipment",
                "Shipment Line Index",
                "Receipt Line",
                "Receipt",
              ].includes(key)
          )
          .reduce((acc, [key, value]) => ({ ...acc, [key]: value || "" }), {}),
      };
    }
    return {
      number: "",
      properties: {},
    };
  });

  const { data: batchNumbers } = useBatchNumbers(line.itemId!);
  const [error, setError] = useState<string | null>(null);
  const { carbon } = useCarbon();

  // Check if the batch number is valid and in the list
  const isBatchNumberValid =
    values.number &&
    batchNumbers?.data?.some(
      (b) => b.id === values.number && b.status === "Available"
    );

  // Verify batch quantity is sufficient for the shipped quantity
  useEffect(() => {
    if (
      values.number &&
      batchNumbers?.data &&
      (line.shippedQuantity || 0) > 0
    ) {
      const batchNumber = batchNumbers.data.find((b) => b.id === values.number);

      if (
        batchNumber &&
        batchNumber.status === "Available" &&
        (line.shippedQuantity || 0) > batchNumber.quantity
      ) {
        setValues({
          ...values,
          number: "",
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.shippedQuantity]);

  const getShelfFromBatchNumber = async (trackedEntityId: string) => {
    if (!carbon) return;

    const response = await carbon
      .from("itemLedger")
      .select("shelfId")
      .eq("trackedEntityId", trackedEntityId)
      .order("createdAt", { ascending: false })
      .single();

    if (response?.data?.shelfId) {
      onUpdate({
        lineId: line.id!,
        field: "shelfId",
        value: response.data.shelfId,
      });
    }
  };

  // Fetch the latest shelf for the selected batch number
  useEffect(() => {
    if (values.number && values.number.trim()) {
      getShelfFromBatchNumber(values.number);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.number]);

  const updateBatchNumber = async (newValues: typeof values, isNew = false) => {
    if (!shipment?.id || !newValues.number.trim()) return;

    let batchMatch = null;
    if (isNew && tracking) {
      const attributes = tracking.attributes as TrackedEntityAttributes;
      batchMatch = attributes["Batch Number"];
    }

    let valuesToSubmit = newValues;

    if (batchMatch) {
      const attributes = tracking?.attributes as TrackedEntityAttributes;
      valuesToSubmit = {
        ...newValues,
        properties: Object.entries(attributes)
          .filter(([key]) => !["Batch Number", "Receipt Line"].includes(key))
          .reduce((acc, [key, value]) => ({ ...acc, [key]: value || "" }), {}),
      };

      // Just update the local state without triggering another database write
      setValues(valuesToSubmit);
    }

    // Check if batch number is available
    const batchNumber = batchNumbers?.data?.find(
      (b) => b.id === valuesToSubmit.number.trim()
    );

    if (batchNumber && batchNumber.status !== "Available") {
      setError(`Batch number is ${batchNumber.status}`);
      setValues({
        ...valuesToSubmit,
        number: "",
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
    if (batchNumber && (line.shippedQuantity || 0) > batchNumber.quantity) {
      setError(
        `Shipped quantity exceeds batch quantity (${batchNumber.quantity})`
      );
      setValues({
        ...valuesToSubmit,
        number: "",
      });
      return;
    }

    if (batchNumber && batchNumber.attributes) {
      const attributes = batchNumber.attributes as TrackedEntityAttributes;
      if (
        attributes["Shipment Line"] &&
        attributes["Shipment"] === shipment?.id
      ) {
        setError("Batch number is already used on another shipment line");
        setValues({
          ...valuesToSubmit,
          number: "",
        });
      }
    }

    const formData = new FormData();
    formData.append("itemId", line.itemId!);
    formData.append("shipmentId", shipment.id);
    formData.append("shipmentLineId", line.id!);
    formData.append("trackingType", "batch");
    formData.append("trackedEntityId", valuesToSubmit.number.trim());
    formData.append("properties", JSON.stringify(valuesToSubmit.properties));
    formData.append("quantity", (line.shippedQuantity || 0).toString());

    submit(formData, {
      method: "post",
      action: path.to.shipmentLinesTracking(shipment.id),
      navigate: false,
    });
  };

  const navigateToLineTrackingLabels = (zpl?: boolean, labelSize?: string) => {
    if (!window) return;
    if (zpl) {
      window.open(
        window.location.origin +
          path.to.file.shipmentLabelsZpl(shipment?.id ?? "", {
            lineId: line.id!,
            labelSize,
          }),
        "_blank"
      );
    } else {
      window.open(
        window.location.origin +
          path.to.file.shipmentLabelsPdf(shipment?.id ?? "", {
            lineId: line.id!,
            labelSize,
          }),
        "_blank"
      );
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full p-6 border rounded-lg">
      <div className="flex justify-between items-center gap-4">
        <Heading size="h4">Tracking Number</Heading>
        {hasTrackingLabel && (
          <SplitButton
            size="sm"
            leftIcon={<LuQrCode />}
            dropdownItems={labelSizes.map((size) => ({
              label: size.name,
              onClick: () => navigateToLineTrackingLabels(!!size.zpl, size.id),
            }))}
            onClick={() => navigateToLineTrackingLabels(false)}
            variant="primary"
          >
            Tracking Labels
          </SplitButton>
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
                placeholder="Batch number"
                value={values.number}
                onChange={(e) => {
                  setValues({
                    ...values,
                    number: e.target.value,
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
            {values.number &&
              batchNumbers?.data &&
              (() => {
                const batchNumber = batchNumbers.data.find(
                  (b) => b.id === values.number
                );
                if (batchNumber) {
                  if ((line.shippedQuantity || 0) < batchNumber.quantity) {
                    return (
                      <span className="text-xs text-muted-foreground">
                        Shipped quantity is less than batch quantity. A new
                        batch will be created for the remaining quantity when
                        posted.
                      </span>
                    );
                  }
                }
                return null;
              })()}
            {error && <span className="text-xs text-destructive">{error}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function SerialForm({
  line,
  shipment,
  serialNumbers,
  isReadOnly,
  onSerialNumbersChange,
}: {
  line: ShipmentLine;
  shipment?: Shipment;
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

      // Check for duplicates within the form
      const isDuplicate = serialNumbers.some(
        (sn, idx) => idx !== currentIndex && sn.id === serialNumberId
      );

      if (isDuplicate) {
        return "Duplicate serial number";
      }

      // Check if serial number is available
      const serialNumber = serialNumbersData?.data?.find(
        (sn) => sn.id === serialNumberId
      );

      if (!serialNumber) {
        return "Serial number not found";
      }

      if (serialNumber.status !== "Available") {
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
          id: "",
        };
        onSerialNumbersChange(newSerialNumbers);
        return;
      }

      const formData = new FormData();
      formData.append("trackingType", "serial");
      formData.append("itemId", line.itemId!);
      formData.append("shipmentId", shipment.id);
      formData.append("shipmentLineId", line.id!);
      formData.append("index", serialNumber.index.toString());
      formData.append("trackedEntityId", serialNumber.id.trim());

      try {
        const response = await fetch(
          path.to.shipmentLinesTracking(shipment.id),
          {
            method: "POST",
            body: formData,
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
            [serialNumber.index]: errorMessage,
          }));

          // Clear the input value but keep the error message
          const newSerialNumbers = [...serialNumbers];
          newSerialNumbers[serialNumber.index] = {
            index: serialNumber.index,
            id: "",
          };
          onSerialNumbersChange(newSerialNumbers);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("available")) {
          setErrors((prev) => ({
            ...prev,
            [serialNumber.index]: "Serial number is not available",
          }));

          // Clear the input value but keep the error message
          const newSerialNumbers = [...serialNumbers];
          newSerialNumbers[serialNumber.index] = {
            index: serialNumber.index,
            id: "",
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
      onSerialNumbersChange,
    ]
  );

  return (
    <div className="flex flex-col gap-6 p-6 border rounded-lg">
      <Heading size="h4">Tracking Numbers</Heading>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-4 gap-y-3">
        {serialNumbers.map((serialNumber, index) => {
          // Check if the serial number is valid and in the list
          const isSerialNumberValid =
            serialNumber.id &&
            serialNumbersData?.data?.some(
              (sn) => sn.id === serialNumber.id && sn.status === "Available"
            );

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
                      id: newValue,
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
                        id: newValue,
                      });
                    } else {
                      // Clear the input value but keep the error message
                      const newSerialNumbers = [...serialNumbers];
                      newSerialNumbers[index] = {
                        index,
                        id: "",
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
  onClose,
}: {
  line: ShipmentLine;
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
            <Number
              name="quantity"
              label="Quantity"
              maxValue={(line.orderQuantity || 0) - 0.0001}
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
          [field]: value,
        };
        return [...acc, newItem];
      }
      return acc;
    }, []);
};

export default ShipmentLines;

export function useSerialNumbers(itemId?: string, isReadOnly = false) {
  const serialNumbersFetcher =
    useFetcher<Awaited<ReturnType<typeof getSerialNumbersForItem>>>();

  useEffect(() => {
    if (itemId) {
      serialNumbersFetcher.load(path.to.api.serialNumbers(itemId, isReadOnly));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  return { data: serialNumbersFetcher.data };
}

export function useBatchNumbers(itemId?: string) {
  const batchNumbersFetcher =
    useFetcher<Awaited<ReturnType<typeof getBatchNumbersForItem>>>();

  useEffect(() => {
    if (itemId) {
      batchNumbersFetcher.load(path.to.api.batchNumbers(itemId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  return { data: batchNumbersFetcher.data };
}
