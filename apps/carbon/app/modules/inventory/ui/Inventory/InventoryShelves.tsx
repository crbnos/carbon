import { Hidden, Submit, ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
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
import { useMemo } from "react";
import type { z } from "zod";
import { Enumerable } from "~/components/Enumerable";
import { Input, Location, Number, Select, Shelf } from "~/components/Form";
import { usePermissions } from "~/hooks";
import type {
  ItemShelfQuantities,
  pickMethodValidator,
  UnitOfMeasureListItem,
} from "~/modules/items";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { inventoryAdjustmentValidator } from "../../inventory.models";

type InventoryShelvesProps = {
  pickMethod: z.infer<typeof pickMethodValidator>;
  itemShelfQuantities: ItemShelfQuantities[];
  itemUnitOfMeasureCode: string;
  locations: ListItem[];
  shelves: ListItem[];
  unitOfMeasures: UnitOfMeasureListItem[];
};

const InventoryShelves = ({
  itemShelfQuantities,
  itemUnitOfMeasureCode,
  locations,
  pickMethod,
  shelves,
  unitOfMeasures,
}: InventoryShelvesProps) => {
  const permissions = usePermissions();
  const adjustmentModal = useDisclosure();

  const itemUnitOfMeasure = useMemo(
    () => unitOfMeasures.find((unit) => unit.code === itemUnitOfMeasureCode),
    [itemUnitOfMeasureCode, unitOfMeasures]
  );

  return (
    <>
      <Card className="w-full">
        <HStack className="w-full justify-between">
          <CardHeader>
            <CardTitle>Shelves</CardTitle>
          </CardHeader>
          <CardAction>
            <Button onClick={adjustmentModal.onOpen}>Update Inventory</Button>
          </CardAction>
        </HStack>
        <CardContent>
          <Table className="table-fixed">
            <Thead>
              <Tr>
                <Th>Location</Th>
                <Th>Shelf</Th>
                <Th>QoH</Th>
                <Th>UoM</Th>
              </Tr>
            </Thead>
            <Tbody>
              {itemShelfQuantities.map((item, index) => (
                <Tr key={index}>
                  <Td>
                    <Enumerable
                      value={
                        locations.find((loc) => loc.id === item.locationId)
                          ?.name ?? null
                      }
                    />
                  </Td>
                  <Td>
                    {shelves.find((s) => s.id === item.shelfId)?.name ||
                      item.shelfId}
                  </Td>
                  <Td>{item.quantityOnHand}</Td>
                  <Td>
                    {unitOfMeasures.find(
                      (uom) => uom.code === itemUnitOfMeasureCode
                    )?.name || itemUnitOfMeasureCode}
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
                locationId: pickMethod.locationId,
                shelfId: pickMethod.defaultShelfId,
                adjustmentType: "Set Quantity",
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
                      { label: "Set Quantity", value: "Set Quantity" },
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
                  <Number name="quantity" label="Quantity" minValue={0} />
                  <Input
                    name="unitOfMeasure"
                    label="Unit of Measure"
                    value={itemUnitOfMeasure?.name ?? ""}
                    isReadOnly
                  />
                </VStack>
              </ModalBody>
              <ModalFooter>
                <Button onClick={adjustmentModal.onClose} variant="secondary">
                  Cancel
                </Button>
                <Submit isDisabled={!permissions.can("update", "inventory")}>
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
