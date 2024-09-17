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
  Location,
  Number,
  Select,
  Shelf,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { type ItemQuantities, type pickMethodValidator } from "~/modules/items";
import { path } from "~/utils/path";
import { inventoryAdjustmentValidator } from "../../inventory.models";

type InventoryDetailsProps = {
  pickMethod: z.infer<typeof pickMethodValidator>;
  quantities: ItemQuantities;
};

const InventoryDetails = ({
  pickMethod,
  quantities,
}: InventoryDetailsProps) => {
  const permissions = usePermissions();
  const adjustmentModal = useDisclosure();

  const { locale } = useLocale();
  const formatter = Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    useGrouping: true,
  });

  return (
    <>
      <div className="w-full grid gap-2 grid-cols-1">
        <Button onClick={adjustmentModal.onOpen} className="w-fit">
          Update Inventory
        </Button>
        <Card>
          <CardHeader className="pb-8">
            <CardDescription>Quantity on Hand</CardDescription>
            <CardTitle className="text-4xl">
              {formatter.format(quantities.quantityOnHand ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-8">
            <CardDescription>Quantity on Purchase Order</CardDescription>
            <CardTitle className="text-4xl">
              {formatter.format(quantities.quantityOnPurchase ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-8">
            <CardDescription>Quantity on Sales Order</CardDescription>
            <CardTitle className="text-4xl">
              {formatter.format(quantities.quantityOnSalesOrder ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-8">
            <CardDescription>Quantity on Production Order</CardDescription>
            <CardTitle className="text-4xl">
              {formatter.format(quantities.quantityOnProductionOrder ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

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
    </>
  );
};

export default InventoryDetails;
