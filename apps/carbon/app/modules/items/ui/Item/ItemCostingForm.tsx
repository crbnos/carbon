import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@carbon/react";
import { useState } from "react";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  Hidden,
  ItemPostingGroup,
  Number,
  Select,
  Submit,
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { itemCostValidator, itemCostingMethods } from "~/modules/items";

type ItemCostingFormProps = {
  initialValues: z.infer<typeof itemCostValidator>;
};

const ItemCostingForm = ({ initialValues }: ItemCostingFormProps) => {
  const permissions = usePermissions();
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  const [partCostingMethod, setItemCostingMethod] = useState<string>(
    initialValues.costingMethod
  );

  const partCostingMethodOptions = itemCostingMethods.map(
    (partCostingMethod) => ({
      label: partCostingMethod,
      value: partCostingMethod,
    })
  );

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={itemCostValidator}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>Costing & Posting</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="itemId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Select
              name="costingMethod"
              label="Part Costing Method"
              options={partCostingMethodOptions}
              onChange={(newValue) => {
                if (newValue) setItemCostingMethod(newValue.value);
              }}
            />
            <ItemPostingGroup name="itemPostingGroupId" label="Posting Group" />
            <Number
              name="standardCost"
              label="Standard Cost"
              formatOptions={{
                style: "currency",
                currency: baseCurrency,
                maximumFractionDigits: 4,
              }}
              isReadOnly={partCostingMethod !== "Standard"}
            />

            <Number
              name="unitCost"
              label="Unit Cost"
              formatOptions={{
                style: "currency",
                currency: baseCurrency,
                maximumFractionDigits: 4,
              }}
            />

            <Number
              name="salesHistory"
              label="Sales History"
              formatOptions={{
                style: "currency",
                currency: baseCurrency,
                maximumFractionDigits: 4,
              }}
              isReadOnly
            />
            <Number
              name="salesHistoryQty"
              label="Sales History Qty"
              formatOptions={{
                maximumSignificantDigits: 3,
              }}
              isReadOnly
            />
            <Boolean name="costIsAdjusted" label="Cost Is Adjusted" />
            <CustomFormFields table="partCost" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "parts")}>Save</Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default ItemCostingForm;
