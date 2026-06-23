import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Combobox,
  HStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Number,
  Select as SelectForm,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import {
  itemPlanningValidator,
  itemReorderingPolicies
} from "../../items.models";
import { ItemReorderPolicy } from "./ItemReorderPolicy";

type ItemPlanningFormProps = {
  initialValues: z.infer<typeof itemPlanningValidator>;
  locations: ListItem[];
  type: "Part" | "Material" | "Tool" | "Consumable";
};

const ItemPlanningForm = ({
  initialValues,
  locations,
  type
}: ItemPlanningFormProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();

  const locationOptions = locations.map((location) => ({
    label: location.name,
    value: location.id
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
            <CardTitle>
              <Trans>Planning</Trans>
            </CardTitle>
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
              label={t`Reordering Policy`}
              termId="reordering-policy"
              options={itemReorderingPolicies.map((policy) => ({
                label: <ItemReorderPolicy reorderingPolicy={policy} />,
                value: policy
              }))}
              onChange={(selected) => {
                // @ts-ignore
                setPolicy(selected?.value || "Manual Reorder");
              }}
            />
            {policy === "Maximum Quantity" && (
              <>
                <Number
                  name="reorderPoint"
                  label={t`Reorder Point`}
                  termId="reorder-point"
                  minValue={0}
                />
                <Number
                  name="maximumInventoryQuantity"
                  label={t`Maximum Inventory Quantity`}
                  minValue={0}
                />
              </>
            )}

            {policy === "Demand-Based Reorder" && (
              <>
                <Number
                  name="demandAccumulationPeriod"
                  label={t`Accumulation Period (Weeks)`}
                  minValue={0}
                />
                <Number
                  name="demandAccumulationSafetyStock"
                  label={t`Safety Stock`}
                  minValue={0}
                />
              </>
            )}
            {policy === "Fixed Reorder Quantity" && (
              <>
                <Number
                  name="reorderPoint"
                  label={t`Reorder Point`}
                  termId="reorder-point"
                  minValue={0}
                />
                <Number
                  name="reorderQuantity"
                  label={t`Reorder Quantity`}
                  minValue={0}
                />
              </>
            )}
            {policy !== "Fixed Reorder Quantity" && (
              <>
                <Number
                  name="orderMultiple"
                  label={t`Order Multiple`}
                  minValue={0}
                />
                <Number
                  name="minimumOrderQuantity"
                  label={t`Minimum Order Quantity`}
                  minValue={0}
                />
                <Number
                  name="maximumOrderQuantity"
                  label={t`Maximum Order Quantity`}
                  minValue={0}
                />
              </>
            )}
            {/* <Boolean name="critical" label={t`Critical`} /> */}

            <CustomFormFields table="itemPlanning" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "parts")}>
            <Trans>Save</Trans>
          </Submit>
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
