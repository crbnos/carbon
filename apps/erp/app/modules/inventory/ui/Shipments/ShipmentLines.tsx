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
  ModalHeader,
  ModalContent,
  Modal,
  NumberField,
  NumberInput,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure,
  VStack,
  ModalBody,
  ModalFooter,
  ModalTitle,
  ModalDescription,
} from "@carbon/react";
import { type CalendarDate, parseDate } from "@internationalized/date";
import {
  Await,
  Outlet,
  useFetcher,
  useFetchers,
  useParams,
  useSubmit,
} from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  LuBarcode,
  LuCalendar,
  LuCircleAlert,
  LuGroup,
  LuSplit,
} from "react-icons/lu";
import { Empty } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useShelves } from "~/components/Form/Shelf";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { TrackingTypeIcon } from "~/components/Icons";
import { useRouteData } from "~/hooks";
import { splitValidator } from "~/modules/inventory";
import type {
  getBatchNumbersForItem,
  type BatchProperty,
  type getSerialNumbersForItem,
  type Shipment,
  type ShipmentLine,
  type ShipmentLineTracking,
} from "~/modules/inventory";
import type { action as shipmentLinesUpdateAction } from "~/routes/x+/shipment+/lines.update";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import BatchPropertiesConfig from "../Batches/BatchPropertiesConfig";
import { BatchPropertiesFields } from "../Batches/BatchPropertiesFields";
import { ValidatedForm, Submit, Number } from "@carbon/form";

const ShipmentLines = () => {
  const { shipmentId } = useParams();
  if (!shipmentId) throw new Error("shipmentId not found");

  const fetcher = useFetcher<typeof shipmentLinesUpdateAction>();

  const routeData = useRouteData<{
    shipment: Shipment;
    shipmentLines: ShipmentLine[];
    shipmentLineTracking: ShipmentLineTracking[];
    batchProperties: PostgrestResponse<BatchProperty>;
  }>(path.to.shipment(shipmentId));

  const shipmentsById = new Map<string, ShipmentLine>(
    routeData?.shipmentLines.map((line) => [line.id, line])
  );
  const pendingShipmentLines = usePendingShipmentLines();

  for (let pendingShipmentLine of pendingShipmentLines) {
    let item = shipmentsById.get(pendingShipmentLine.id);
    let merged = item
      ? { ...item, ...pendingShipmentLine }
      : pendingShipmentLine;
    shipmentsById.set(pendingShipmentLine.id, merged as ShipmentLine);
  }

  const shipmentLines = Array.from(shipmentsById.values());

  const [serialNumbersByLineId, setSerialNumbersByLineId] = useState<
    Record<string, { index: number; id: string }[]>
  >(() => {
    return shipmentLines.reduce(
      (acc, line) => ({
        ...acc,
        [line.id]: Array.from({ length: line.shippedQuantity }, (_, index) => {
          const serialNumber = routeData?.shipmentLineTracking.find(
            (t) =>
              t.sourceDocumentLineId === line.id &&
              t.serialNumber !== null &&
              t.index === index
          )?.serialNumber;
          return {
            index,
            id: serialNumber?.id ?? "",
          };
        }),
      }),
      {}
    );
  });

  useEffect(() => {
    setSerialNumbersByLineId(
      shipmentLines.reduce(
        (acc, line) => ({
          ...acc,
          [line.id]: Array.from(
            { length: line.shippedQuantity },
            (_, index) => {
              const serialNumber = routeData?.shipmentLineTracking.find(
                (t) =>
                  t.sourceDocumentLineId === line.id &&
                  t.serialNumber !== null &&
                  t.index === index
              )?.serialNumber;
              return {
                index,
                id: serialNumber?.id ?? "",
              };
            }
          ),
        }),
        {}
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeData?.shipment?.sourceDocumentId, shipmentLines.length]);

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

  const isPosted = routeData?.shipment.status === "Posted";

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
              shipmentLines.map((line, index) => (
                <ShipmentLineItem
                  key={line.id}
                  line={line}
                  shipment={routeData?.shipment}
                  isReadOnly={isPosted}
                  onUpdate={onUpdateShipmentLine}
                  className={
                    index === shipmentLines.length - 1 ? "border-none" : ""
                  }
                  serialNumbers={serialNumbersByLineId[line.id] || []}
                  onSerialNumbersChange={(newSerialNumbers) => {
                    setSerialNumbersByLineId((prev) => ({
                      ...prev,
                      [line.id]: newSerialNumbers,
                    }));
                  }}
                  batchProperties={routeData?.batchProperties}
                  batchNumber={
                    routeData?.shipmentLineTracking.find(
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

function ShipmentLineItem({
  line,
  shipment,
  className,
  isReadOnly,
  onUpdate,
  batchProperties,
  batchNumber,
  serialNumbers,
  onSerialNumbersChange,
}: {
  line: ShipmentLine;
  shipment?: Shipment;
  className?: string;
  isReadOnly: boolean;
  batchProperties?: PostgrestResponse<BatchProperty>;
  batchNumber: {
    id: string;
    number: string;
    manufacturingDate?: string | null;
    expirationDate?: string | null;
    properties?: any;
  };
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
              <label className="text-xs text-muted-foreground">Shipped</label>

              <NumberField
                value={line.shippedQuantity}
                onChange={(value) => {
                  onUpdate({
                    lineId: line.id,
                    field: "shippedQuantity",
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

                {line.shippedQuantity > line.outstandingQuantity && (
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
            shipment={shipment}
            line={line}
            isReadOnly={isReadOnly}
            initialValues={batchNumber}
            batchProperties={batchProperties}
          />
        </>
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
    </div>
  );
}

function BatchForm({
  line,
  shipment,
  batchProperties,
  initialValues,
  isReadOnly,
}: {
  line: ShipmentLine;
  shipment?: Shipment;
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

  const { options: batchNumberOptions } = useBatchNumbers(line.itemId);

  const { carbon } = useCarbon();
  const updateBatchNumber = async (newValues: typeof values, isNew = false) => {
    if (!shipment?.id || !newValues.number.trim()) return;

    const batchMatch = isNew
      ? (await carbon
          ?.from("batchNumber")
          .select("*")
          .eq("number", newValues.number.trim())
          .eq("itemId", line.itemId)
          .eq("companyId", shipment.companyId)
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
      };
      // Just update the local state without triggering another database write
      setValues(valuesToSubmit);
    }

    const formData = new FormData();
    formData.append("itemId", line.itemId);
    formData.append("shipmentId", shipment.id);
    formData.append("shipmentLineId", line.id);
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
    formData.append("quantity", line.shippedQuantity.toString());

    submit(formData, {
      method: "post",
      action: path.to.shipmentLinesTracking(shipment.id),
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

          <Combobox
            options={batchNumberOptions}
            placeholder={`Batch number`}
            disabled={isReadOnly}
            value={values.number}
            onChange={(newValue) => {
              updateBatchNumber(
                {
                  ...values,
                  number:
                    batchNumberOptions.find((o) => o.value === newValue)
                      ?.label ?? "",
                },
                true
              );
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
  const { options } = useSerialNumbers(line.itemId, isReadOnly);

  // Check for duplicates within the current form
  const validateSerialNumber = useCallback(
    (serialNumberId: string, currentIndex: number) => {
      if (!serialNumberId) return null;

      const isDuplicate = serialNumbers.some(
        (sn, idx) => idx !== currentIndex && sn.id === serialNumberId
      );

      return isDuplicate ? "Duplicate serial number" : null;
    },
    [serialNumbers]
  );

  const updateSerialNumber = useCallback(
    async (serialNumber: { index: number; id: string }) => {
      if (!shipment?.id || !serialNumber.id) return;

      const error = validateSerialNumber(serialNumber.id, serialNumber.index);
      if (error) {
        setErrors((prev) => ({ ...prev, [serialNumber.index]: error }));
        return;
      }

      const formData = new FormData();
      formData.append("trackingType", "serial");
      formData.append("itemId", line.itemId);
      formData.append("shipmentId", shipment.id);
      formData.append("shipmentLineId", line.id);
      formData.append("index", serialNumber.index.toString());
      formData.append("serialNumberId", serialNumber.id.trim());

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
    [line.id, line.itemId, shipment?.id, validateSerialNumber]
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
            <Combobox
              options={
                options.filter(
                  (o) =>
                    !serialNumbers.some(
                      (sn) => sn.id === o.value && sn.index !== index
                    )
                ) ?? []
              }
              placeholder={`Serial ${index + 1}`}
              disabled={isReadOnly}
              value={serialNumber.id}
              onChange={(newValue) => {
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
                  id: newValue,
                };
                onSerialNumbersChange(newSerialNumbers);
                updateSerialNumber(newSerialNumbers[index]);
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
            <input type="hidden" name="documentId" value={line.shipmentId} />
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

  const options = useMemo(
    () =>
      serialNumbersFetcher.data?.data
        ?.map((c) => ({
          value: c.id ?? "",
          label: c.number ?? "",
        }))
        .filter((o) => o.value !== "" && o.label !== "") ?? [],

    [serialNumbersFetcher.data]
  );

  return { options, data: serialNumbersFetcher.data };
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

  const options = useMemo(() => {
    return (
      batchNumbersFetcher.data?.data?.map((c) => ({
        value: c.number ?? "",
        label: c.number ?? "",
      })) ?? []
    ).filter((o) => o.value !== "");
  }, [batchNumbersFetcher.data]);

  return { options, data: batchNumbersFetcher.data };
}
