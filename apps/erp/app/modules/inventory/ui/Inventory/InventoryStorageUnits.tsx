import { useStorageRuleViolations } from "@carbon/ee/storage-rules";
import {
  DatePicker,
  Hidden,
  NumberControlled,
  Submit,
  ValidatedForm
} from "@carbon/form";
import { LabelDownloadModal } from "@carbon/printing/ui";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { nanoid } from "nanoid";
import { useMemo, useState } from "react";
import {
  LuCheck,
  LuEllipsisVertical,
  LuPencil,
  LuPrinter,
  LuQrCode
} from "react-icons/lu";
import { Outlet, useFetcher } from "react-router";
import type { z } from "zod";
import { Enumerable } from "~/components/Enumerable";
import { Input, Location, Select, TextArea } from "~/components/Form";
import StorageUnit from "~/components/Form/StorageUnit";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { usePermissions, usePrinting } from "~/hooks";
import type {
  ItemStorageUnitQuantities,
  itemTrackingTypes,
  pickMethodValidator
} from "~/modules/items";
import { path } from "~/utils/path";
import { inventoryAdjustmentValidator } from "../../inventory.models";

type InventoryStorageUnitsProps = {
  pickMethod: z.infer<typeof pickMethodValidator>;
  itemStorageUnitQuantities: ItemStorageUnitQuantities[];
  itemUnitOfMeasureCode: string;
  itemTrackingType: (typeof itemTrackingTypes)[number];
  itemShelfLife: {
    mode: string | null;
    days: number | null;
  } | null;
  trackedEntityExpirations: Record<string, string | null>;
  storageUnits: { value: string; label: string }[];
};

const InventoryStorageUnits = ({
  itemStorageUnitQuantities,
  itemUnitOfMeasureCode,
  itemTrackingType,
  itemShelfLife,
  trackedEntityExpirations,
  pickMethod,
  storageUnits
}: InventoryStorageUnitsProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();
  const { locale } = useLocale();
  const adjustmentModal = useDisclosure();
  const ruleViolations = useStorageRuleViolations({
    action: path.to.inventoryItemAdjustment(pickMethod.itemId),
    onSuccess: adjustmentModal.onClose
  });

  const unitOfMeasures = useUnitOfMeasure();

  const itemUnitOfMeasure = useMemo(
    () => unitOfMeasures.find((unit) => unit.value === itemUnitOfMeasureCode),
    [itemUnitOfMeasureCode, unitOfMeasures]
  );

  const isSerial = itemTrackingType === "Serial";
  const isBatch = itemTrackingType === "Batch";

  const visibleStorageUnitQuantities = useMemo(
    () => itemStorageUnitQuantities.filter((item) => item.quantity !== 0),
    [itemStorageUnitQuantities]
  );

  const showExpirationColumn = useMemo(
    () =>
      visibleStorageUnitQuantities.some(
        (item) =>
          item.trackedEntityId && trackedEntityExpirations[item.trackedEntityId]
      ),
    [visibleStorageUnitQuantities, trackedEntityExpirations]
  );

  const [quantity, setQuantity] = useState(1);
  const [selectedStorageUnitId, setSelectedStorageUnitId] = useState<
    string | null
  >(null);
  const [selectedTrackedEntityId, setSelectedTrackedEntityId] = useState<
    string | null
  >(null);
  const [selectedReadableId, setSelectedReadableId] = useState<string | null>(
    null
  );
  const [isEditingRow, setIsEditingRow] = useState(false);

  const isEditing = selectedTrackedEntityId !== null;

  const showExpirationField = isBatch || isSerial;

  const defaultExpirationDate = useMemo(() => {
    if (!showExpirationField) return undefined;
    if (selectedTrackedEntityId) {
      return trackedEntityExpirations[selectedTrackedEntityId] ?? undefined;
    }
    if (
      itemShelfLife?.mode === "Fixed Duration" &&
      itemShelfLife.days &&
      Number(itemShelfLife.days) > 0
    ) {
      return today(getLocalTimeZone())
        .add({ days: Number(itemShelfLife.days) })
        .toString();
    }
    return undefined;
  }, [
    showExpirationField,
    selectedTrackedEntityId,
    trackedEntityExpirations,
    itemShelfLife
  ]);

  const openAdjustmentModal = (
    storageUnitId?: string,
    trackedEntityId?: string,
    readableId?: string,
    currentQuantity?: number
  ) => {
    setSelectedStorageUnitId(storageUnitId || null);
    setSelectedTrackedEntityId(trackedEntityId || null);
    setSelectedReadableId(readableId || null);
    setIsEditingRow(storageUnitId !== undefined);
    if (currentQuantity !== undefined) {
      setQuantity(currentQuantity);
    }
    adjustmentModal.onOpen();
  };

  const { printerRoutes, resolvePrinterRoute } = usePrinting();
  const printerModal = useDisclosure();
  const downloadModal = useDisclosure();
  const printFetcher = useFetcher<{ success: boolean; message: string }>();
  const [pendingPrintEntityId, setPendingPrintEntityId] = useState<
    string | null
  >(null);
  const locationId = pickMethod.locationId;
  const defaultPrinter = resolvePrinterRoute(locationId, "inventory");
  const [selectedPrinterId, setSelectedPrinterId] = useState<string>(
    defaultPrinter?.id ?? ""
  );

  const handlePrintLabel = (trackedEntityId: string) => {
    setPendingPrintEntityId(trackedEntityId);
    if (printerRoutes.length > 0) {
      setSelectedPrinterId(defaultPrinter?.id ?? printerRoutes[0]?.id ?? "");
      printerModal.onOpen();
    } else {
      downloadModal.onOpen();
    }
  };

  const handleConfirmPrint = () => {
    if (!pendingPrintEntityId || !selectedPrinterId) return;
    printFetcher.submit(
      {
        sourceDocument: "Entity",
        sourceDocumentId: pendingPrintEntityId,
        locationId,
        printerRouteId: selectedPrinterId
      },
      {
        method: "POST",
        action: path.to.manualPrint,
        encType: "application/json"
      }
    );
    toast.success("Print job queued");
    printerModal.onClose();
    setPendingPrintEntityId(null);
  };

  return (
    <>
      <Card className="w-full">
        <HStack className="w-full justify-between">
          <CardHeader>
            <CardTitle>
              <HStack className="gap-2 items-center">
                <Trans>Storage Units</Trans>
                <Enumerable
                  value={
                    unitOfMeasures.find(
                      (uom) => uom.value === itemUnitOfMeasureCode
                    )?.label || itemUnitOfMeasureCode
                  }
                />
              </HStack>
            </CardTitle>
          </CardHeader>
          <CardAction>
            <Button onClick={() => openAdjustmentModal()}>
              <Trans>Update Inventory</Trans>
            </Button>
          </CardAction>
        </HStack>
        <CardContent>
          <Table className="table-fixed">
            <Thead>
              <Tr>
                <Th>
                  <Trans>Storage Unit</Trans>
                </Th>

                <Th>
                  <Trans>Quantity</Trans>
                </Th>
                <Th>
                  <Trans>Tracking ID</Trans>
                </Th>
                {showExpirationColumn && (
                  <Th>
                    <Trans>Expiration Date</Trans>
                  </Th>
                )}
                <Th className="flex flex-shrink-0 justify-end" />
              </Tr>
            </Thead>
            <Tbody>
              {visibleStorageUnitQuantities.map((item, index) => (
                <Tr key={index}>
                  <Td>
                    {storageUnits.find((s) => s.value === item.storageUnitId)
                      ?.label || item.storageUnitId}
                  </Td>

                  <Td>
                    <span>{item.quantity}</span>
                  </Td>
                  <Td>
                    {item.trackedEntityId && (
                      <HStack>
                        {item.readableId && <span>{item.readableId}</span>}
                        <Copy
                          icon={<LuQrCode />}
                          text={item.trackedEntityId}
                          withTextInTooltip
                        />
                      </HStack>
                    )}
                  </Td>
                  {showExpirationColumn && (
                    <Td>
                      {item.trackedEntityId &&
                        trackedEntityExpirations[item.trackedEntityId] && (
                          <span>
                            {formatDate(
                              trackedEntityExpirations[item.trackedEntityId],
                              undefined,
                              locale
                            )}
                          </span>
                        )}
                    </Td>
                  )}
                  <Td className="flex flex-shrink-0 justify-end items-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          aria-label={t`Actions`}
                          variant="ghost"
                          icon={<LuEllipsisVertical />}
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-56">
                        <DropdownMenuItem
                          onClick={() =>
                            openAdjustmentModal(
                              item.storageUnitId,
                              item.trackedEntityId,
                              item.readableId,
                              item.quantity
                            )
                          }
                        >
                          <DropdownMenuIcon icon={<LuPencil />} />
                          <Trans>Update Quantity</Trans>
                        </DropdownMenuItem>
                        {item.trackedEntityId && (
                          <DropdownMenuItem
                            onClick={() =>
                              handlePrintLabel(item.trackedEntityId!)
                            }
                          >
                            <DropdownMenuIcon icon={<LuPrinter />} />
                            <Trans>Print Label</Trans>
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </CardContent>
      </Card>
      {adjustmentModal.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) {
              adjustmentModal.onClose();
            }
          }}
        >
          <ModalContent>
            <ValidatedForm
              method="post"
              validator={inventoryAdjustmentValidator}
              fetcher={ruleViolations.fetcher}
              action={path.to.inventoryItemAdjustment(pickMethod.itemId)}
              defaultValues={{
                itemId: pickMethod.itemId,
                quantity: isSerial && !isEditing ? 1 : quantity,
                locationId: pickMethod.locationId,
                storageUnitId: selectedStorageUnitId || undefined,
                originalStorageUnitId: isEditing
                  ? selectedStorageUnitId || undefined
                  : undefined,
                adjustmentType: "Set Quantity",
                trackedEntityId: selectedTrackedEntityId || nanoid(),
                readableId: selectedReadableId || undefined,
                expirationDate: defaultExpirationDate
              }}
            >
              <ModalHeader>
                <ModalTitle>
                  <Trans>Inventory Adjustment</Trans>
                </ModalTitle>
              </ModalHeader>
              <ModalBody>
                <Hidden name="itemId" />
                {isEditing && <Hidden name="originalStorageUnitId" />}

                <VStack spacing={2}>
                  <Location name="locationId" label={t`Location`} isReadOnly />
                  <StorageUnit
                    name="storageUnitId"
                    locationId={pickMethod.locationId}
                    label={t`Storage Unit`}
                    isReadOnly={isEditingRow}
                  />
                  <Select
                    name="adjustmentType"
                    label={t`Adjustment Type`}
                    options={
                      isEditing && (isSerial || isBatch)
                        ? [
                            { label: t`Set Quantity`, value: "Set Quantity" },
                            {
                              label: t`Negative Adjustment`,
                              value: "Negative Adjmt."
                            }
                          ]
                        : [
                            ...(isSerial
                              ? []
                              : [
                                  {
                                    label: "Set Quantity",
                                    value: "Set Quantity"
                                  }
                                ]),
                            {
                              label: t`Positive Adjustment`,
                              value: "Positive Adjmt."
                            },
                            {
                              label: t`Negative Adjustment`,
                              value: "Negative Adjmt."
                            }
                          ]
                    }
                  />
                  {(isBatch || isSerial) && (
                    <>
                      <Hidden name="trackedEntityId" />
                      <Input
                        name="readableId"
                        label={isSerial ? t`Serial Number` : t`Batch Number`}
                        termId={isSerial ? "serial" : "batch"}
                      />
                      {showExpirationField && (
                        <DatePicker
                          name="expirationDate"
                          label={t`Expiration Date`}
                          termId="shelf-life"
                        />
                      )}
                    </>
                  )}
                  <NumberControlled
                    name="quantity"
                    label={t`Quantity`}
                    minValue={0}
                    maxValue={isSerial && isEditing ? 1 : undefined}
                    value={isSerial && !isEditing ? 1 : quantity}
                    onChange={setQuantity}
                    isReadOnly={isSerial && !isEditing}
                  />

                  <Input
                    name="unitOfMeasure"
                    label={t`Unit of Measure`}
                    value={itemUnitOfMeasure?.label ?? ""}
                    isReadOnly
                  />
                  <TextArea name="comment" label={t`Comment`} />
                </VStack>
              </ModalBody>
              <ModalFooter>
                <Button onClick={adjustmentModal.onClose} variant="secondary">
                  <Trans>Cancel</Trans>
                </Button>
                <Submit
                  withBlocker={false}
                  isDisabled={!permissions.can("update", "inventory")}
                >
                  Save
                </Submit>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}
      <ruleViolations.ViolationModal />
      {printerModal.isOpen && pendingPrintEntityId && (
        <Modal open onOpenChange={(open) => !open && printerModal.onClose()}>
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                <Trans>Select Printer</Trans>
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              <div className="flex flex-col gap-1">
                {printerRoutes.map((route) => (
                  <button
                    type="button"
                    key={route.id}
                    className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                      selectedPrinterId === route.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted"
                    }`}
                    onClick={() => setSelectedPrinterId(route.id)}
                  >
                    <LuPrinter className="size-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{route.name}</span>
                      <span className="text-xs text-muted-foreground ml-2 uppercase">
                        {route.format}
                      </span>
                    </div>
                    {selectedPrinterId === route.id && (
                      <LuCheck className="size-4 text-primary shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </ModalBody>
            <ModalFooter>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  leftIcon={<LuPrinter />}
                  disabled={!selectedPrinterId}
                  onClick={handleConfirmPrint}
                >
                  <Trans>Print</Trans>
                </Button>
                <Button variant="solid" onClick={printerModal.onClose}>
                  <Trans>Cancel</Trans>
                </Button>
              </div>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
      {downloadModal.isOpen && pendingPrintEntityId && (
        <LabelDownloadModal
          sourceDocumentId={pendingPrintEntityId}
          fileRoutes={{
            pdf: path.to.file.trackedEntityLabelPdf,
            zpl: path.to.file.trackedEntityLabelZpl
          }}
          isOpen={downloadModal.isOpen}
          onClose={() => {
            downloadModal.onClose();
            setPendingPrintEntityId(null);
          }}
        />
      )}
      <Outlet />
    </>
  );
};

export default InventoryStorageUnits;
