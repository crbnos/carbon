import { ValidatedForm } from "@carbon/form";
import {
  Badge,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
} from "@carbon/react";
import { useRevalidator } from "@remix-run/react";
import type { z } from "zod";
import {
  CreatableCombobox,
  CustomFormFields,
  Hidden,
  Number,
  Submit,
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import type { ItemQuantities } from "~/modules/items";
import { pickMethodValidator } from "~/modules/items";
import { path } from "~/utils/path";
import InventoryItemIcon from "./InventoryItemIcon";

type InventoryDetailsViewProps = {
  initialValues: z.infer<typeof pickMethodValidator>;
  quantities: ItemQuantities;
  shelves: string[];
};

const InventoryDetailsView = ({
  initialValues,
  quantities,
  shelves,
}: InventoryDetailsViewProps) => {
  const permissions = usePermissions();
  const { supabase } = useSupabase();
  const user = useUser();
  const revalidator = useRevalidator();

  const shelfOptions = shelves.map((shelf) => ({ value: shelf, label: shelf }));

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={pickMethodValidator}
        defaultValues={{ ...quantities, ...initialValues }}
      >
        <HStack className="w-full justify-between items-start">
          <CardHeader>
            <HStack>
              <CardTitle>{quantities.readableId}</CardTitle>
              {quantities.type && (
                <Badge variant="secondary">
                  <InventoryItemIcon type={quantities.type} />
                </Badge>
              )}
            </HStack>
          </CardHeader>
        </HStack>

        <CardContent>
          <Hidden name="itemId" />
          <Hidden name="locationId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <CreatableCombobox
              name="defaultShelfId"
              label="Default Shelf"
              options={shelfOptions}
              onCreateOption={async (option) => {
                const response = await supabase?.from("shelf").insert({
                  id: option,
                  companyId: user.company.id,
                  locationId: initialValues.locationId,
                  createdBy: user.id,
                });
                if (response && response.error === null)
                  revalidator.revalidate();
              }}
              className="w-full"
            />

            <Number name="quantityOnHand" label="Quantity On Hand" isReadOnly />

            <Number
              name="quantityAvailable"
              label="Quantity Available"
              isReadOnly
            />
            <Number
              name="quantityOnPurchaseOrder"
              label="Quantity On Purchase Order"
              isReadOnly
            />

            <Number
              name="quantityOnProdOrder"
              label="Quantity On Prod Order"
              isReadOnly
            />
            <Number
              name="quantityOnSalesOrder"
              label="Quantity On Sales Order"
              isReadOnly
            />
            <CustomFormFields table="partInventory" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "parts")}>Save</Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default InventoryDetailsView;

function getLocationPath(itemId: string, locationId: string) {
  return `${path.to.inventoryItemView(itemId)}?location=${locationId}`;
}
