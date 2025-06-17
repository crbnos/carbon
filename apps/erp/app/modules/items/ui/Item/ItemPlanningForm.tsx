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
import { useState } from "react";
import type { z } from "zod";

import {
  Boolean,
  CustomFormFields,
  Hidden,
  Number,
  Select as SelectForm,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import {
  itemPlanningValidator,
  itemReorderingPolicies,
} from "../../items.models";

type ItemPlanningFormProps = {
  initialValues: z.infer<typeof itemPlanningValidator>;
  locations: ListItem[];
  type: "Part" | "Material" | "Tool" | "Consumable";
};

const ItemPlanningForm = ({
  initialValues,
  locations,
  type,
}: ItemPlanningFormProps) => {
  const permissions = usePermissions();

  const locationOptions = locations.map((location) => ({
    label: location.name,
    value: location.id,
  }));

  const [policy, setPolicy] = useState(initialValues.reorderingPolicy);

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={itemPlanningValidator}
        defaultValues={initialValues}
      >
        <HStack className="w-full justify-between items-start">
          <CardHeader>
            <CardTitle>Planning</CardTitle>
          </CardHeader>
          <CardAction>
            <Combobox
              size="sm"
              value={initialValues.locationId}
              options={locationOptions}
              onChange={(selected) => {
                // hard refresh because initialValues update has no effect otherwise
                window.location.href = window.location.href = getLocationPath(
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
            <SelectForm
              name="reorderingPolicy"
              label="Reordering Policy"
              options={itemReorderingPolicies.map((policy) => ({
                label: policy,
                value: policy,
              }))}
              onChange={(selected) => {
                // @ts-ignore
                setPolicy(selected?.value || "Manual Reorder");
              }}
            />
            {policy === "Maximum Quantity" && (
              <>
                <Number
                  name="maximumInventoryQuantity"
                  label="Maximum Inventory Quantity"
                />
                <div />
              </>
            )}

            {policy === "Demand-Based Reorder" && (
              <>
                <Number
                  name="demandAccumulationPeriod"
                  label="Demand Accumulation Period (Days)"
                  minValue={0}
                />
                <Boolean
                  name="demandAccumulationIncludesInventory"
                  label="Demand Includes Inventory"
                />
              </>
            )}
            {policy === "Fixed Reorder Quantity" && (
              <>
                <Number name="reorderPoint" label="Reorder Point" />
                <Number
                  name="reorderQuantity"
                  label="Reorder Quantity"
                  minValue={0}
                />
              </>
            )}

            <Number name="orderMultiple" label="Order Multiple" minValue={0} />
            <Number
              name="minimumOrderQuantity"
              label="Minimum Order Quantity"
              minValue={0}
            />
            <Number
              name="maximumOrderQuantity"
              label="Maximum Order Quantity"
              minValue={0}
            />
            {/* <Boolean name="critical" label="Critical" /> */}

            <CustomFormFields table="partPlanning" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "parts")}>Save</Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default ItemPlanningForm;

function getLocationPath(
  itemId: string,
  locationId: string,
  type: "Part" | "Material" | "Tool" | "Consumable"
) {
  switch (type) {
    case "Part":
      return `${path.to.partPlanning(itemId)}?location=${locationId}`;
    case "Material":
      return `${path.to.materialPlanning(itemId)}?location=${locationId}`;

    case "Tool":
      return `${path.to.toolPlanning(itemId)}?location=${locationId}`;
    case "Consumable":
      return `${path.to.consumablePlanning(itemId)}?location=${locationId}`;
    default:
      throw new Error(`Invalid item type: ${type}`);
  }
}
