import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  useDisclosure,
  VStack,
} from "@carbon/react";
import { useLocale } from "@react-aria/i18n";
import type { z } from "zod";
import {
  Hidden,
  Input,
  Location,
  Number,
  Select,
  Shelf,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type {
  ItemQuantities,
  ItemShelfQuantities,
  pickMethodValidator,
} from "~/modules/items";
import { path } from "~/utils/path";
import { inventoryAdjustmentValidator } from "../../inventory.models";
import InventoryShelves from "./InventoryShelves";

type InventoryDetailsProps = {
  itemShelfQuantities: ItemShelfQuantities[];
  itemUnitOfMeasureCode: string;
  locations: ListItem[];
  pickMethod: z.infer<typeof pickMethodValidator>;
  quantities: ItemQuantities;
  shelves: ListItem[];
  unitOfMeasures: ListItem[];
};

const InventoryDetails = ({
  itemShelfQuantities,
  itemUnitOfMeasureCode,
  locations,
  pickMethod,
  quantities,
  shelves,
  unitOfMeasures,
}: InventoryDetailsProps) => {
  const permissions = usePermissions();
  const adjustmentModal = useDisclosure();

  const { locale } = useLocale();
  const formatter = Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    useGrouping: true,
  });

  const itemUnitOfMeasure = unitOfMeasures.find(
    (unit) => unit.code === itemUnitOfMeasureCode
  );

  return (
    <VStack>
      <Button onClick={adjustmentModal.onOpen} className="w-fit">
        Update Inventory
      </Button>
      <div className="w-full grid gap-2 grid-cols-1 md:grid-cols-2 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-8">
            <CardDescription>
              <VStack>
                Quantity on Hand
                <span className="text-sm text-muted-foreground">
                  ({itemUnitOfMeasure?.name ?? ""})
                </span>
              </VStack>
            </CardDescription>
            <CardTitle className="text-4xl">
              {`${formatter.format(quantities.quantityOnHand ?? 0)}`}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-8">
            <CardDescription>
              <VStack>
                Quantity on Purchase Order
                <span className="text-sm text-muted-foreground">
                  ({itemUnitOfMeasure?.name ?? ""})
                </span>
              </VStack>
            </CardDescription>
            <CardTitle className="text-4xl">
              {`${formatter.format(quantities.quantityOnPurchaseOrder ?? 0)}`}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-8">
            <CardDescription>
              <VStack>
                Quantity on Sales Order
                <span className="text-sm text-muted-foreground">
                  ({itemUnitOfMeasure?.name ?? ""})
                </span>
              </VStack>
            </CardDescription>
            <CardTitle className="text-4xl">
              {`${formatter.format(quantities.quantityOnSalesOrder ?? 0)}`}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-8">
            <CardDescription>
              <VStack>
                Quantity on Production Order
                <span className="text-sm text-muted-foreground">
                  ({itemUnitOfMeasure?.name ?? ""})
                </span>
              </VStack>
            </CardDescription>
            <CardTitle className="text-4xl">
              {`${formatter.format(quantities.quantityOnProdOrder ?? 0)}`}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>
      <InventoryShelves
        itemShelfQuantities={itemShelfQuantities}
        itemUnitOfMeasureCode={itemUnitOfMeasureCode}
        locations={locations}
        shelves={shelves}
        unitOfMeasures={unitOfMeasures}
      />

      <Modal
        open={adjustmentModal.isOpen}
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
                    { label: "Positive Adjustment", value: "Positive Adjmt." },
                    { label: "Negative Adjustment", value: "Negative Adjmt." },
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
    </VStack>
  );
};

export default InventoryDetails;
