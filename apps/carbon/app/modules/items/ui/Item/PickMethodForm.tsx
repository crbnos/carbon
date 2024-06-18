import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import { useRevalidator } from "@remix-run/react";
import type { z } from "zod";
import { Combobox } from "~/components";
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
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type PickMethodFormProps = {
  initialValues: z.infer<typeof pickMethodValidator>;
  quantities: ItemQuantities;
  locations: ListItem[];
  shelves: string[];
  type: "Part" | "Material" | "Tool" | "Fixture" | "Consumable";
};

const PickMethodForm = ({
  initialValues,
  locations,
  quantities,
  shelves,
  type,
}: PickMethodFormProps) => {
  const permissions = usePermissions();
  const { supabase } = useSupabase();
  const user = useUser();
  const revalidator = useRevalidator();

  const shelfOptions = shelves.map((shelf) => ({ value: shelf, label: shelf }));
  const locationOptions = locations.map((location) => ({
    label: location.name,
    value: location.id,
  }));

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={pickMethodValidator}
        defaultValues={{ ...quantities, ...initialValues }}
      >
        <HStack className="w-full justify-between items-start">
          <CardHeader>
            <CardTitle>Inventory</CardTitle>
          </CardHeader>

          <CardAction>
            <Combobox
              size="sm"
              value={initialValues.locationId}
              options={locationOptions}
              onChange={(selected) => {
                // hard refresh because initialValues update has no effect otherwise
                window.location.href = getLocationPath(
                  initialValues.itemId,
                  selected,
                  type
                );
              }}
            />
          </CardAction>
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

export default PickMethodForm;

function getLocationPath(
  itemId: string,
  locationId: string,
  type: "Part" | "Material" | "Tool" | "Fixture" | "Consumable"
) {
  switch (type) {
    case "Part":
      return `${path.to.partInventory(itemId)}?location=${locationId}`;
    case "Material":
      return `${path.to.materialInventory(itemId)}?location=${locationId}`;

    case "Tool":
      return `${path.to.toolInventory(itemId)}?location=${locationId}`;
    case "Fixture":
      return `${path.to.fixtureInventory(itemId)}?location=${locationId}`;
    case "Consumable":
      return `${path.to.consumableInventory(itemId)}?location=${locationId}`;
    default:
      throw new Error(`Invalid item type: ${type}`);
  }
}
