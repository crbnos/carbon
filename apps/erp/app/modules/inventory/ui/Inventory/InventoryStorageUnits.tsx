import {
  DatePicker,
  Hidden,
  NumberControlled,
  Submit,
  ValidatedForm
} from "@carbon/form";
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
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  useDisclosure,
  VStack
} from "@carbon/react";
import { labelSizes } from "@carbon/utils";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { useMemo, useState } from "react";
import {
  LuEllipsisVertical,
  LuPencil,
  LuPrinter,
  LuQrCode
} from "react-icons/lu";
import { Outlet } from "react-router";
import type { z } from "zod";
import { Enumerable } from "~/components/Enumerable";
import {
  Input,
  Location,
  Select,
  StorageUnit,
  TextArea
} from "~/components/Form";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { usePermissions } from "~/hooks";
import { useItemRuleViolations } from "~/hooks/useItemRuleViolations";
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
  const adjustmentModal = useDisclosure();
  const ruleViolations = useItemRuleViolations({
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

  const navigateToLabel = (
    trackedEntityId: string,
    zpl?: boolean,
    labelSize?: string
  ) => {
    if (!window) return;
    if (zpl) {
      window.open(
        window.location.origin +
          path.to.file.trackedEntityLabelZpl(trackedEntityId, { labelSize }),
        "_blank"
      );
    } else {
      window.open(
        window.location.origin +
          path.to.file.trackedEntityLabelPdf(trackedEntityId, { labelSize }),
        "_blank"
      );
    }
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
                <Th className="flex flex-shrink-0 justify-end" />
              </Tr>
            </Thead>
            <Tbody>
              {itemStorageUnitQuantities
                .filter((item) => item.quantity !== 0)
                .map((item, index) => (
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
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>
                                <LuPrinter className="mr-2 h-4 w-4" />
                                <Trans>Print Label</Trans>
                              </DropdownMenuSubTrigger>
                              <DropdownMenuPortal>
                                <DropdownMenuSubContent>
                                  {labelSizes.map((size) => (
                                    <DropdownMenuItem
                                      key={size.id}
                                      onClick={() =>
                                        navigateToLabel(
                                          item.trackedEntityId!,
                                          !!size.zpl,
                                          size.id
                                        )
                                      }
                                    >
                                      {size.name}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuPortal>
                            </DropdownMenuSub>
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
                      />
                      {showExpirationField && (
                        <DatePicker
                          name="expirationDate"
                          label={t`Expiration Date`}
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
      <Outlet />
    </>
  );
};

export default InventoryStorageUnits;
