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
  HStack,
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
  VStack,
} from "@carbon/react";
import { Outlet } from "@remix-run/react";
import { useMemo, useState } from "react";
import type { z } from "zod";
import { Enumerable } from "~/components/Enumerable";
import { Input, Location, Select, Shelf } from "~/components/Form";
import { usePermissions } from "~/hooks";
import type {
  ItemShelfQuantities,
  itemTrackingTypes,
  pickMethodValidator,
} from "~/modules/items";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { inventoryAdjustmentValidator } from "../../inventory.models";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { LuQrCode } from "react-icons/lu";
import { nanoid } from "nanoid";

type InventoryShelvesProps = {
  pickMethod: z.infer<typeof pickMethodValidator>;
  itemShelfQuantities: ItemShelfQuantities[];
  itemUnitOfMeasureCode: string;
  itemTrackingType: (typeof itemTrackingTypes)[number];
  shelves: ListItem[];
};

const InventoryShelves = ({
  itemShelfQuantities,
  itemUnitOfMeasureCode,
  itemTrackingType,
  pickMethod,
  shelves,
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
  console.log({ isSerial, isBatch });
  const [quantity, setQuantity] = useState(1);

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
            <Button onClick={adjustmentModal.onOpen}>Update Inventory</Button>
          </CardAction>
        </HStack>
        <CardContent>
          <Table className="table-fixed">
            <Thead>
              <Tr>
                <Th>Shelf</Th>

                <Th>QoH</Th>
                <Th>Tracking ID</Th>
              </Tr>
            </Thead>
            <Tbody>
              {itemShelfQuantities
                .filter((item) => item.quantity !== 0)
                .map((item, index) => (
                  <Tr key={index}>
                    <Td>
                      {shelves.find((s) => s.id === item.shelfId)?.name ||
                        item.shelfId}
                    </Td>

                    <Td className="flex items-center gap-2">
                      <span>{item.quantity}</span>
                    </Td>
                    <Td>
                      {item.trackedEntityId && (
                        <Copy
                          icon={<LuQrCode />}
                          text={item.trackedEntityId}
                          withTextInTooltip
                        />
                      )}
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
                quantity: quantity,
                locationId: pickMethod.locationId,
                shelfId: pickMethod.defaultShelfId,
                adjustmentType: isSerial ? "Positive Adjmt." : "Set Quantity",
                trackedEntityId: nanoid(),
              }}
              onSubmit={adjustmentModal.onClose}
            >
              <ModalHeader>
                <ModalTitle>Inventory Adjustment</ModalTitle>
              </ModalHeader>
              <ModalBody>
                <Hidden name="itemId" />

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
                    options={[
                      ...(isSerial
                        ? []
                        : [{ label: "Set Quantity", value: "Set Quantity" }]),
                      {
                        label: "Positive Adjustment",
                        value: "Positive Adjmt.",
                      },
                      {
                        label: "Negative Adjustment",
                        value: "Negative Adjmt.",
                      },
                    ]}
                  />
                  {(isBatch || isSerial) && (
                    <Input
                      name="trackedEntityId"
                      label="Tracking ID"
                      helperText="Globally unique identifier for the item"
                    />
                  )}
                  <NumberControlled
                    name="quantity"
                    label="Quantity"
                    minValue={0}
                    value={quantity}
                    onChange={setQuantity}
                    isReadOnly={isSerial}
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
