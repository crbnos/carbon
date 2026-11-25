// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { Number, Submit, ValidatedForm } from "@carbon/form";
import { useAction, useLoaderQuery } from "@carbon/query";
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
  MENU_ITEM_SHORTCUTS,
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
import { distinctItemText, getItemReadableId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { Outlet, useFetchers, useParams } from "react-router";
import { Empty, ItemThumbnail, PrintButton } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useStorageUnits } from "~/components/Form/StorageUnit";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { ConfirmDelete } from "~/components/Modals";
import { useRouteData } from "~/hooks";
import { splitValidator } from "~/modules/inventory/inventory.models";
import type {
  getBatchNumbersForItem,
  getSerialNumbersForItem
} from "~/modules/inventory/inventory.service";
import {
  findShipmentSerial,
  isShippableEntityStatus,
  shipmentSerialLabels
} from "~/modules/inventory/inventory.utils";
import type {
  ItemTracking,
  RentalShipmentLine,
  Shipment,
  ShipmentLine,
  ShipmentLineTracking
} from "~/modules/inventory/types";
import type { action as shipmentLinesSplitAction } from "~/routes/x+/shipment+/lines.split";
import type { action as shipmentLinesUpdateAction } from "~/routes/x+/shipment+/lines.update";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import { RentalUnitRow } from "./RentalUnitRow";

const ShipmentLines = () => {
  const { shipmentId } = useParams();
  if (!shipmentId) throw new Error("shipmentId not found");

  const fetcher = useAction<typeof shipmentLinesUpdateAction>();
  const [items] = useItems();

  const routeData = useRouteData<{
    shipment: Shipment;
    shipmentLines: ShipmentLine[];
    shipmentLineTracking: ShipmentLineTracking[];
    /** A contract delivery: each line's typed serial. */
    serialNumberByLineId?: Record<string, string | null>;
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
    rentalLines: RentalShipmentLine[];
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
          field: "storageUnitId" | "serialNumber";
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

    // oxlint-disable-next-line react/exhaustive-deps -- suppressed due to migration
    []
  );

  const isPosted = routeData?.shipment?.status === "Posted";
  const isVoided = routeData?.shipment?.status === "Voided";
  const isReadOnly = isPosted || isVoided;
  const isRental = routeData?.shipment?.sourceDocument === "Rental Agreement";

  return (
    <>
      {!isRental && (
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
                    const lineTracking =
                      routeData?.shipmentLineTracking?.filter((t) => {
                        const attributes =
                          t.attributes as TrackedEntityAttributes;
                        return attributes["Shipment Line"] === line.id;
                      });
                    return (
                      <ShipmentLineItem
                        key={line.id}
                        line={line}
                        shipment={routeData?.shipment}
                        serialNumber={
                          routeData?.serialNumberByLineId?.[line.id!] ?? null
                        }
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
                          index === shipmentLines.length - 1
                            ? "border-none"
                            : ""
                        }
                        serialNumbers={lineTracking ?? []}
                        tracking={lineTracking?.[0]}
                      />
                    );
                  })
              )}
            </div>
          </CardContent>
        </Card>
      )}
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
      {isRental && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Rental Units</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg">
              {(routeData?.rentalLines ?? []).length === 0 ? (
                <Empty className="py-6" />
              ) : (
                routeData!.rentalLines.map((line, index) => (
                  <ShipmentRentalLineItem
                    key={line.id}
                    line={line}
                    isReadOnly={isReadOnly}
                    className={
                      index < routeData!.rentalLines.length - 1
                        ? "border-b"
                        : ""
                    }
                  />
                ))
              )}
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
  const { t } = useLingui();
  const fetcher = useAction();
  const [serialNumber, setSerialNumber] = useState(line.serialNumber ?? "");
  const assetName =
    line.assetName ?? line.assetReadableId ?? line.description ?? "";

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
    <div
      className={cn(
        "flex items-center gap-4 p-6 max-md:flex-wrap max-md:p-4",
        className
      )}
    >
      <Checkbox
        aria-label={t`Shipped: ${assetName}`}
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
        aria-label={t`Serial number for ${line.assetName ?? line.assetReadableId ?? line.description ?? ""}`}
        value={serialNumber}
        isDisabled={isReadOnly}
        className="w-48 max-md:w-full"
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

function ShipmentRentalLineItem({
  line,
  isReadOnly,
  className
}: {
  line: RentalShipmentLine;
  isReadOnly: boolean;
  className?: string;
}) {
  const { t } = useLingui();
  const fetcher = useAction();

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
    <div className={cn("@container p-6", className)}>
      <RentalUnitRow
        line={line}
        checked={line.shipped}
        checkedLabel={t`Shipped`}
        isReadOnly={isReadOnly}
        onCheckedChange={(checked) => updateField("shipped", String(checked))}
        onMeterChange={(meter) => updateField("meter", meter)}
      />
    </div>
  );
}

function ShipmentLineItem({
  line,
  shipment,
  serialNumber,
  className,
  hasTrackingLabel,
  isReadOnly,
  tracking,
  serialNumbers,
  onUpdate
}: {
  line: ShipmentLine;
  shipment?: Shipment;
  /** A contract delivery line's typed serial. */
  serialNumber?: string | null;
  className?: string;
  hasTrackingLabel: boolean;
  isReadOnly: boolean;
  tracking: ItemTracking | undefined;
  serialNumbers: ShipmentLineTracking[];
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
        field: "storageUnitId" | "serialNumber";
        value: string;
      }) => Promise<void>;
}) {
  const { t } = useLingui();
  const [items] = useItems();
  // A contract delivery moves no stock: no storage unit, and the serial is
  // typed (the job consumed the part to the project, so no tracked entity).
  const isContractDelivery = shipment?.sourceDocument === "Customer Contract";
  const item = items.find((p) => p.id === line.itemId);
  const itemName = item?.readableIdWithRevision ?? line.itemId ?? "";
  const unitsOfMeasure = useUnitOfMeasure();
  const splitDisclosure = useDisclosure();
  const deleteDisclosure = useDisclosure();

  // Check if shipped quantity exceeds job quantity for job fulfillments
  const isJobFulfillment = line.fulfillment?.type === "Job";
  const isJobOverShipped =
    isJobFulfillment &&
    (line.shippedQuantity || 0) > (line.fulfillment?.job?.quantity || 0);

  return (
    <div
      className={cn(
        "@container flex flex-col border-b p-6 gap-6 relative max-md:p-4 max-md:gap-4",
        className
      )}
    >
      {!isJobFulfillment && (
        <div className="absolute top-3 right-6 max-md:right-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label={t`Line options for ${itemName}`}
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
                {t`Split shipment line`}
              </DropdownMenuItem>
              <DropdownMenuItem
                shortcut={MENU_ITEM_SHORTCUTS.delete}
                destructive
                disabled={isReadOnly}
                onClick={deleteDisclosure.onOpen}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                {t`Delete shipment line`}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {/* Sized by the line's own width, not the viewport: the content pane
          it sits in is resizable. The item takes what the quantities leave,
          and they stay on one line once the row is wide enough. pr-10 clears
          the line menu; a Job line has no menu, its job sits in the row. */}
      <div
        className={cn(
          "flex flex-1 flex-col @3xl:flex-row @3xl:items-center gap-4 w-full",
          !isJobFulfillment && "pr-10"
        )}
      >
        <HStack spacing={4} className="w-full @3xl:w-auto @3xl:flex-1 min-w-0">
          <HStack spacing={4} className="flex-1 min-w-0">
            <ItemThumbnail
              size="md"
              thumbnailPath={line.thumbnailPath}
              type={(item?.type as "Part") ?? "Part"}
            />

            <VStack spacing={0} className="flex-1 min-w-0">
              <div className="w-full overflow-hidden">
                <span className="text-sm font-medium truncate block w-full">
                  {item?.readableIdWithRevision}
                </span>
                {distinctItemText(item?.readableIdWithRevision, item?.name) && (
                  <span className="text-xs text-muted-foreground truncate block w-full">
                    {item?.name}
                  </span>
                )}
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
        <div className="flex flex-wrap @3xl:flex-nowrap items-center gap-x-6 gap-y-4 w-full @3xl:w-auto @3xl:shrink-0">
          <HStack spacing={4}>
            <VStack spacing={1}>
              <div className="flex items-center justify-between gap-1 w-full">
                <label className="text-xs text-muted-foreground">
                  <Trans>Shipped</Trans>
                </label>
                {isJobOverShipped && (
                  <Tooltip>
                    <TooltipTrigger>
                      <LuCircleAlert className="text-red-500" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <Trans>Shipped quantity exceeds job quantity</Trans>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              <NumberField
                aria-label={t`Shipped quantity for ${itemName}`}
                value={line.shippedQuantity || 0}
                onChange={(value) => {
                  // Default to 0 if value is NaN, null, or undefined
                  const safeValue = isNaN(value) || value == null ? 0 : value;
                  onUpdate({
                    lineId: line.id!,
                    field: "shippedQuantity",
                    value: safeValue
                  });
                }}
              >
                <NumberInput
                  className={cn(
                    "disabled:bg-transparent disabled:opacity-100 min-w-[100px] max-md:w-full",
                    isJobOverShipped && "border-red-500 border-2"
                  )}
                  isDisabled={
                    isReadOnly ||
                    (isJobFulfillment && (line.requiresSerialTracking ?? false))
                  }
                  size="sm"
                  min={0}
                />
              </NumberField>
            </VStack>
            <VStack spacing={1} className="text-center items-center">
              <label className="text-xs text-muted-foreground">
                <Trans>Ordered</Trans>
              </label>
              <span className="text-sm py-1.5">{line.orderQuantity || 0}</span>
            </VStack>

            <VStack spacing={1} className="text-center items-center">
              <label className="text-xs text-muted-foreground">
                <Trans>Outstanding</Trans>
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
                      <Trans>There are more shipped than ordered</Trans>
                    </TooltipContent>
                  </Tooltip>
                )}
              </HStack>
            </VStack>
          </HStack>
          {isJobFulfillment && (
            <VStack spacing={1} className="items-end">
              <label className="text-xs text-muted-foreground">
                <Trans>Job</Trans>
              </label>
              <span className="text-sm py-1.5">
                {line.fulfillment?.job?.jobId}
              </span>
            </VStack>
          )}
          {isContractDelivery && (
            <VStack spacing={1}>
              <label className="text-xs text-muted-foreground">
                <Trans>Serial Number</Trans>
              </label>
              <Input
                size="sm"
                className="min-w-[160px]"
                defaultValue={serialNumber ?? ""}
                isReadOnly={isReadOnly}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value === (serialNumber ?? "")) return;
                  onUpdate({
                    lineId: line.id!,
                    field: "serialNumber",
                    value
                  });
                }}
              />
            </VStack>
          )}
          {!isJobFulfillment &&
            !isContractDelivery &&
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
        />
      )}
      <SplitShipmentLineModal
        open={splitDisclosure.isOpen}
        line={line}
        onClose={splitDisclosure.onClose}
      />
      <ConfirmDelete
        isOpen={deleteDisclosure.isOpen}
        name="Shipment Line"
        text="Are you sure you want to delete this shipment line?"
        action={path.to.shipmentLineDelete(line.id!)}
        onCancel={deleteDisclosure.onClose}
        onSubmit={deleteDisclosure.onClose}
      />
    </div>
  );
}

// The statuses lines.tracking accepts for this shipment's source: On Hold
// returned stock or an Available serviced unit on a sales return, Available
// or Rejected units on a supplier return, Available stock otherwise.
export function isShippable(
  shipment: Pick<Shipment, "sourceDocument"> | undefined,
  status: unknown
) {
  return isShippableEntityStatus(shipment?.sourceDocument, status as string);
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
  const [items] = useItems();
  const itemReadableId = getItemReadableId(items, line.itemId) ?? "";
  // A refused assignment (wrong item, not available) is toasted.
  const assign = useAction();
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
  const isBatchNumberValid =
    // @ts-expect-error TS2339 - TODO: fix type
    isShippable(shipment, resolvedBatch?.status);

  // Verify batch quantity is sufficient for the shipped quantity
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
        isShippable(shipment, batchNumber.status) &&
        // @ts-expect-error TS2339 - TODO: fix type
        (line.shippedQuantity || 0) > batchNumber.quantity
      ) {
        setValues({
          ...values,
          number: ""
        });
      }
    }
    // oxlint-disable-next-line react/exhaustive-deps -- suppressed due to migration
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
    // oxlint-disable-next-line react/exhaustive-deps -- suppressed due to migration
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
    if (batchNumber && !isShippable(shipment, batchNumber.status)) {
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

    assign.submit(formData, {
      method: "post",
      action: path.to.shipmentLinesTracking(shipment.id)
    });
  };

  // Same discoverability fix as SerialForm: the input stays free-text for
  // scanners, and the QR affordance opens the list of batches this line accepts.
  // Quantity is shown alongside each one because a batch smaller than the
  // shipped quantity is split on posting, which is worth seeing before picking.
  const selectableBatches = (batchNumbers?.data ?? []).filter((entity) =>
    isShippable(shipment, entity.status)
  );

  return (
    <div className="flex flex-col gap-6 w-full p-6 border rounded-lg max-md:gap-4 max-md:p-4">
      <div className="flex justify-between items-center gap-4">
        <Heading size="h4">
          <Trans>Batch Number</Trans>
        </Heading>
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
      <div className="grid grid-cols-1 @min-[42rem]:grid-cols-3 gap-4">
        <div className="flex flex-col gap-2 w-full">
          <label className="text-xs text-muted-foreground flex items-center gap-2">
            <LuGroup /> Batch Number
          </label>

          <div className="flex flex-col gap-1">
            <InputGroup isDisabled={isReadOnly}>
              <Input
                placeholder={t`Batch number`}
                aria-label={t`Batch number for ${itemReadableId}`}
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
                ) : selectableBatches.length > 0 && !isReadOnly ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={t`Show available batch numbers`}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <LuQrCode />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="max-h-64 overflow-y-auto"
                    >
                      {selectableBatches.map((entity) => {
                        const number = (entity.readableId ??
                          entity.id) as string;
                        return (
                          <DropdownMenuItem
                            key={entity.id}
                            className="flex items-center justify-between gap-3"
                            onSelect={() => {
                              const picked = { ...values, number };
                              setValues(picked);
                              updateBatchNumber(picked, true);
                            }}
                          >
                            <span className="font-mono text-xs">{number}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {+(entity.quantity ?? 0)}
                            </span>
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
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
  isReadOnly
}: {
  line: ShipmentLine;
  shipment?: Shipment;
  hasTrackingLabel: boolean;
  serialNumbers: ShipmentLineTracking[];
  isReadOnly: boolean;
}) {
  const { t } = useLingui();
  const [items] = useItems();
  const itemReadableId = getItemReadableId(items, line.itemId) ?? "";
  const [errors, setErrors] = useState<Record<number, string>>({});
  const { data: serialNumbersData } = useSerialNumbers(
    line.itemId!,
    isReadOnly,
    !isReadOnly &&
      shipment?.sourceDocument === "Sales Order" &&
      line.fulfillment?.type !== "Job",
    shipment?.sourceDocument === "Sales Return Order"
      ? shipment.sourceDocumentId
      : null
  );

  const [draft, setDraft] = useState<{
    index: number;
    text: string;
    previousId: string | null;
  } | null>(null);
  const slotAtMenuOpen = useRef<string | null>(null);
  const assignment = useAction({ onSettled: () => setDraft(null) });
  const assigning = assignment.state !== "idle";
  const available = serialNumbersData?.data ?? [];
  const byIndex = new Map(
    serialNumbers.map((entity) => [
      (entity.attributes as TrackedEntityAttributes)["Shipment Line Index"],
      entity
    ])
  );
  const labels = shipmentSerialLabels(available);
  const occupied = new Set(serialNumbers.map((entity) => entity.id));
  const unassignedSerialNumbers = available.filter(
    (entity) => isShippable(shipment, entity.status) && !occupied.has(entity.id)
  );

  function assign(
    index: number,
    entity: (typeof available)[number] | undefined,
    previousId: string | null
  ) {
    if (!shipment?.id || !line.id || assigning) return;
    const error = !entity
      ? t`Scan a unique serial number or select a unit from the list.`
      : !isShippable(shipment, entity.status)
        ? t`Serial number is not available`
        : occupied.has(entity.id) && previousId !== entity.id
          ? t`Duplicate serial number`
          : "";
    setErrors((prev) => ({ ...prev, [index]: error }));
    if (!entity || error || entity.id === previousId) {
      setDraft(null);
      return;
    }
    const body = new FormData();
    body.set("trackingType", "serial");
    body.set("shipmentId", shipment.id);
    body.set("shipmentLineId", line.id);
    body.set("index", String(index));
    body.set("trackedEntityId", entity.id);
    if (previousId) body.set("expectedTrackedEntityId", previousId);
    assignment.submit(body, {
      method: "post",
      action: path.to.shipmentLinesTracking(shipment.id)
    });
  }

  return (
    <div className="flex flex-col gap-6 p-6 border rounded-lg max-md:gap-4 max-md:p-4">
      <div className="flex justify-between items-center gap-4">
        <Heading size="h4">
          <Trans>Serial Numbers</Trans>
        </Heading>
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

      <div className="grid grid-cols-1 @min-[42rem]:grid-cols-3 gap-x-4 gap-y-3">
        {Array.from({ length: line.shippedQuantity ?? 0 }, (_, index) => {
          const saved = byIndex.get(index);
          const editing = draft?.index === index ? draft : null;
          const text = editing?.text ?? saved?.readableId ?? saved?.id ?? "";

          return (
            <div
              key={`${line.id}-${index}-serial`}
              className="flex flex-col gap-1"
            >
              <InputGroup isDisabled={isReadOnly || assigning}>
                <Input
                  placeholder={t`Serial Number ${index + 1}`}
                  aria-label={t`Serial number ${index + 1} for ${itemReadableId}`}
                  value={text}
                  onChange={(e) =>
                    setDraft({
                      index,
                      text: e.target.value,
                      previousId: editing
                        ? editing.previousId
                        : (saved?.id ?? null)
                    })
                  }
                  onBlur={() => {
                    if (editing?.text)
                      assign(
                        index,
                        findShipmentSerial(editing.text, available),
                        editing.previousId
                      );
                    else setDraft(null);
                  }}
                  className={cn(errors[index] && "border-destructive")}
                />
                <InputRightElement className="pl-2">
                  {unassignedSerialNumbers.length > 0 &&
                  !isReadOnly &&
                  !assigning ? (
                    <DropdownMenu
                      onOpenChange={(open) => {
                        if (open) slotAtMenuOpen.current = saved?.id ?? null;
                      }}
                    >
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={t`Show available tracking numbers`}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <LuQrCode />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="max-h-64 overflow-y-auto"
                      >
                        {unassignedSerialNumbers.map((entity) => {
                          const number = labels.get(entity.id);
                          return (
                            <DropdownMenuItem
                              key={entity.id}
                              className="font-mono text-xs"
                              onSelect={() =>
                                assign(index, entity, slotAtMenuOpen.current)
                              }
                            >
                              {number}
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : saved ? (
                    <LuCheck className="text-emerald-500" />
                  ) : (
                    <LuQrCode />
                  )}
                </InputRightElement>
              </InputGroup>
              {saved &&
                labels.has(saved.id) &&
                labels.get(saved.id) !== (saved.readableId ?? saved.id) && (
                  <span className="text-xs text-muted-foreground">
                    {labels.get(saved.id)}
                  </span>
                )}
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

type SplitShipmentLineModalProps = {
  line: ShipmentLine;
  open: boolean;
  onClose: () => void;
};

function SplitShipmentLineModal({
  open,
  onClose,
  ...props
}: SplitShipmentLineModalProps) {
  return (
    <Modal open={open} onOpenChange={onClose}>
      <ModalContent>
        <SplitShipmentLineBody onClose={onClose} {...props} />
      </ModalContent>
    </Modal>
  );
}

function SplitShipmentLineBody({
  line,
  onClose
}: Omit<SplitShipmentLineModalProps, "open">) {
  const { t } = useLingui();
  const fetcher = useAction<typeof shipmentLinesSplitAction>({
    onSuccess: onClose
  });
  return (
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
        <input type="hidden" name="locationId" value={line.locationId ?? ""} />
        <Number name="quantity" label={t`Quantity`} minValue={0.0001} />
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Submit>Split Line</Submit>
      </ModalFooter>
    </ValidatedForm>
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
  const { t } = useLingui();

  if (!locationId) return null;

  return (
    <VStack spacing={1} className="min-w-[140px] text-sm">
      <label className="text-xs text-muted-foreground">
        <Trans>Storage Unit</Trans>
      </label>
      <div className="py-1">
        <Combobox
          aria-label={t`Storage unit`}
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

export function useSerialNumbers(
  itemId?: string,
  isReadOnly = false,
  stockShipment = false,
  salesReturnOrderId?: string | null
) {
  const serialNumbersFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getSerialNumbersForItem>>
  >(
    itemId
      ? path.to.api.serialNumbers(
          itemId,
          isReadOnly,
          stockShipment,
          salesReturnOrderId
        )
      : null
  );

  return { data: serialNumbersFetcher.data };
}

export function useBatchNumbers(itemId?: string) {
  const batchNumbersFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getBatchNumbersForItem>>
  >(itemId ? path.to.api.batchNumbers(itemId) : null);

  return { data: batchNumbersFetcher.data };
}
