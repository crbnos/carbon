import { Hidden, NumberControlled, Submit, ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
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
import { nanoid } from "nanoid";
import { useMemo, useState } from "react";
import {
  LuEllipsisVertical,
  LuPencil,
  LuPrinter,
  LuQrCode
} from "react-icons/lu";
import { Outlet } from "react-router";
import type { z } from "zod/v3";
import { Enumerable } from "~/components/Enumerable";
import { Input, Location, Select, Shelf } from "~/components/Form";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { usePermissions } from "~/hooks";
import type {
  ItemShelfQuantities,
  itemTrackingTypes,
  pickMethodValidator
} from "~/modules/items";
import { path } from "~/utils/path";
import { inventoryAdjustmentValidator } from "../../inventory.models";

type InventoryShelvesProps = {
  pickMethod: z.infer<typeof pickMethodValidator>;
  itemShelfQuantities: ItemShelfQuantities[];
  itemUnitOfMeasureCode: string;
  itemTrackingType: (typeof itemTrackingTypes)[number];
  shelves: { value: string; label: string }[];
};

const InventoryShelves = ({
  itemShelfQuantities,
  itemUnitOfMeasureCode,
  itemTrackingType,
  pickMethod,
  shelves
}: InventoryShelvesProps) => {
  const permissions = usePermissions();
  const adjustmentModal = useDisclosure();

  const unitOfMeasures = useUnitOfMeasure();

  const itemUnitOfMeasure = useMemo(
    () => unitOfMeasures.find((unit) => unit.value === itemUnitOfMeasureCode),
    [itemUnitOfMeasureCode, unitOfMeasures]
  );

  const isSerial = itemTrackingType === "Serial";
  const isBatch = itemTrackingType === "Batch";

  const [quantity, setQuantity] = useState(1);
  const [selectedShelfId, setSelectedShelfId] = useState<string | null>(null);
  const [selectedTrackedEntityId, setSelectedTrackedEntityId] = useState<
    string | null
  >(null);
  const [selectedReadableId, setSelectedReadableId] = useState<string | null>(
    null
  );

  const isEditing = selectedTrackedEntityId !== null;

  const openAdjustmentModal = (
    shelfId?: string,
    trackedEntityId?: string,
    readableId?: string,
    currentQuantity?: number
  ) => {
    setSelectedShelfId(shelfId || null);
    setSelectedTrackedEntityId(trackedEntityId || null);
    setSelectedReadableId(readableId || null);
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
            <CardTitle>Shelves</CardTitle>
            <CardDescription>
              <Enumerable
                value={
                  unitOfMeasures.find(
                    (uom) => uom.value === itemUnitOfMeasureCode
                  )?.label || itemUnitOfMeasureCode
                }
              />
            </CardDescription>
          </CardHeader>
          <CardAction>
            <Button onClick={() => openAdjustmentModal()}>
              Update Inventory
            </Button>
          </CardAction>
        </HStack>
        <CardContent>
          <Table className="table-fixed">
            <Thead>
              <Tr>
                <Th>Shelf</Th>

                <Th>Quantity</Th>
                <Th>Tracking ID</Th>
                <Th className="flex flex-shrink-0 justify-end" />
              </Tr>
            </Thead>
            <Tbody>
              {itemShelfQuantities
                .filter((item) => item.quantity !== 0)
                .map((item, index) => (
                  <Tr key={index}>
                    <Td>
                      {shelves.find((s) => s.value === item.shelfId)?.label ||
                        item.shelfId}
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
                            aria-label="Actions"
                            variant="ghost"
                            icon={<LuEllipsisVertical />}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-56">
                          <DropdownMenuItem
                            onClick={() =>
                              openAdjustmentModal(
                                item.shelfId,
                                item.trackedEntityId,
                                item.readableId,
                                item.quantity
                              )
                            }
                          >
                            <DropdownMenuIcon icon={<LuPencil />} />
                            Update Quantity
                          </DropdownMenuItem>
                          {item.trackedEntityId && (
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>
                                <LuPrinter className="mr-2 h-4 w-4" />
                                Print Label
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
              action={path.to.inventoryItemAdjustment(pickMethod.itemId)}
              defaultValues={{
                itemId: pickMethod.itemId,
                quantity: isSerial && !isEditing ? 1 : quantity,
                locationId: pickMethod.locationId,
                shelfId: selectedShelfId || undefined,
                originalShelfId: isEditing
                  ? selectedShelfId || undefined
                  : undefined,
                adjustmentType: "Set Quantity",
                trackedEntityId: selectedTrackedEntityId || nanoid(),
                readableId: selectedReadableId || undefined
              }}
              onSubmit={adjustmentModal.onClose}
            >
              <ModalHeader>
                <ModalTitle>Inventory Adjustment</ModalTitle>
              </ModalHeader>
              <ModalBody>
                <Hidden name="itemId" />
                {isEditing && <Hidden name="originalShelfId" />}

                <VStack spacing={2}>
                  <Location name="locationId" label="Location" isReadOnly />
                  <Shelf
                    name="shelfId"
                    locationId={pickMethod.locationId}
                    label="Shelf"
                  />
                  <Select
                    name="adjustmentType"
                    label="Adjustment Type"
                    options={
                      isEditing && (isSerial || isBatch)
                        ? [{ label: "Set Quantity", value: "Set Quantity" }]
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
                              label: "Positive Adjustment",
                              value: "Positive Adjmt."
                            },
                            {
                              label: "Negative Adjustment",
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
                        label={isSerial ? "Serial Number" : "Batch Number"}
                        helperText="A globally unique identifier is generated behind the scenes"
                      />
                    </>
                  )}
                  <NumberControlled
                    name="quantity"
                    label="Quantity"
                    minValue={0}
                    maxValue={isSerial && isEditing ? 1 : undefined}
                    value={isSerial && !isEditing ? 1 : quantity}
                    onChange={setQuantity}
                    isReadOnly={isSerial && !isEditing}
                  />

                  <Input
                    name="unitOfMeasure"
                    label="Unit of Measure"
                    value={itemUnitOfMeasure?.label ?? ""}
                    isReadOnly
                  />
                </VStack>
              </ModalBody>
              <ModalFooter>
                <Button onClick={adjustmentModal.onClose} variant="secondary">
                  Cancel
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
      <Outlet />
    </>
  );
};

export default InventoryShelves;
