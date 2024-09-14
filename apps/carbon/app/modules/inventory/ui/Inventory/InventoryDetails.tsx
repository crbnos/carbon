import { ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Combobox,
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
import { MethodItemTypeIcon } from "~/components";
import {
  Hidden,
  Location,
  Number,
  Select,
  Shelf,
  Submit,
} from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import type { ItemQuantities, pickMethodValidator } from "~/modules/items";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { inventoryAdjustmentValidator } from "../../inventory.models";

type InventoryDetailsProps = {
  partInventory: z.infer<typeof pickMethodValidator>;
  quantities: ItemQuantities;
};

const InventoryDetails = ({
  partInventory,
  quantities,
}: InventoryDetailsProps) => {
  const permissions = usePermissions();
  const adjustmentModal = useDisclosure();

  const routeData = useRouteData<{ locations: ListItem[] }>(
    path.to.inventoryRoot
  );

  const locationOptions =
    routeData?.locations?.map((location) => ({
      value: location.id,
      label: location.name,
    })) ?? [];

  const { locale } = useLocale();
  const formatter = Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    useGrouping: true,
  });

  return (
    <>
      <div className="w-full grid gap-2 grid-cols-1">
        <Card>
          <div className="relative">
            <CardHeader className="pb-3">
              <CardTitle>
                {quantities.readableId}{" "}
                <Badge className="ml-2" variant="secondary">
                  <MethodItemTypeIcon type={quantities.type ?? "Part"} />
                </Badge>
              </CardTitle>
              <CardDescription className="max-w-lg text-balance leading-relaxed">
                {quantities.name}
              </CardDescription>
            </CardHeader>
            <CardAction className="absolute right-0 top-2">
              <Combobox
                size="sm"
                value={partInventory.locationId}
                options={locationOptions}
                onChange={(selected) => {
                  // hard refresh because initialValues update has no effect otherwise
                  window.location.href = `${path.to.inventoryItem(
                    partInventory.itemId!
                  )}?location=${partInventory.locationId}`;
                }}
                className="w-64"
              />
            </CardAction>
          </div>
          <CardFooter>
            <Button onClick={adjustmentModal.onOpen}>Update Inventory</Button>
          </CardFooter>
        </Card>
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
              {formatter.format(quantities.quantityOnPurchaseOrder ?? 0)}
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
              {formatter.format(quantities.quantityOnProdOrder ?? 0)}
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
            action={path.to.inventoryItemAdjustment(partInventory.itemId)}
            defaultValues={{
              itemId: partInventory.itemId,
              locationId: partInventory.locationId,
              shelfId: partInventory.defaultShelfId,
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
                  locationId={partInventory.locationId}
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
                <Number name="quantity" label="Quantity" />
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
