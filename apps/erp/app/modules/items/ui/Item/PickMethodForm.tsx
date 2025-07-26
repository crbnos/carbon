import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Combobox,
  HStack,
} from "@carbon/react";
import type { z } from "zod";
import {
  Combobox as ComboboxFormField,
  CustomFormFields,
  Hidden,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { pickMethodValidator } from "../../items.models";

type PickMethodFormProps = {
  initialValues: z.infer<typeof pickMethodValidator>;
  locations: ListItem[];
  type: "Part" | "Material" | "Tool" | "Consumable";
  shelves: { value: string; label: string }[];
};

const PickMethodForm = ({
  initialValues,
  locations,
  shelves,
  type,
}: PickMethodFormProps) => {
  const permissions = usePermissions();

  const locationOptions = locations.map((location) => ({
    label: location.name,
    value: location.id,
  }));

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={pickMethodValidator}
        defaultValues={initialValues}
      >
        <HStack className="w-full justify-between items-start">
          <CardHeader>
            <CardTitle>Inventory</CardTitle>
          </CardHeader>

          <CardAction>
            <Combobox
              asButton
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
            <ComboboxFormField
              name="defaultShelfId"
              label="Default Shelf"
              options={shelves}
              className="w-full"
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
  type: "Part" | "Material" | "Tool" | "Consumable"
) {
  switch (type) {
    case "Part":
      return `${path.to.partInventory(itemId)}?location=${locationId}`;
    case "Material":
      return `${path.to.materialInventory(itemId)}?location=${locationId}`;

    case "Tool":
      return `${path.to.toolInventory(itemId)}?location=${locationId}`;
    case "Consumable":
      return `${path.to.consumableInventory(itemId)}?location=${locationId}`;
    default:
      throw new Error(`Invalid item type: ${type}`);
  }
}
