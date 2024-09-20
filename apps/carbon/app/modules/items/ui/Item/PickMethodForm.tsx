import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Combobox,
  HStack,
} from "@carbon/react";
import type { z } from "zod";
import { usePermissions } from "~/hooks";
import InventoryDetails from "~/modules/inventory/ui/Inventory/InventoryDetails";
import type {
  ItemQuantities,
  ItemShelfQuantities,
  pickMethodValidator,
} from "~/modules/items";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type PickMethodFormProps = {
  initialValues: z.infer<typeof pickMethodValidator>;
  itemShelfQuantities: ItemShelfQuantities[];
  itemUnitOfMeasureCode: string;
  locations: ListItem[];
  shelves: ListItem[];
  quantities: ItemQuantities;
  type: "Part" | "Material" | "Tool" | "Fixture" | "Consumable";
  unitOfMeasures: ListItem[];
};

const PickMethodForm = ({
  initialValues,
  itemShelfQuantities,
  itemUnitOfMeasureCode,
  locations,
  shelves,
  quantities,
  type,
  unitOfMeasures,
}: PickMethodFormProps) => {
  usePermissions();

  const locationOptions = locations.map((location) => ({
    label: location.name,
    value: location.id,
  }));

  return (
    <Card>
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
        <InventoryDetails
          itemShelfQuantities={itemShelfQuantities}
          itemUnitOfMeasureCode={itemUnitOfMeasureCode}
          locations={locations}
          pickMethod={initialValues}
          quantities={quantities}
          shelves={shelves}
          unitOfMeasures={unitOfMeasures}
        />
      </CardContent>
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
