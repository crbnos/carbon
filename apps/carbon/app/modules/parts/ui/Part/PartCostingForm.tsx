import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import { useState } from "react";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  Hidden,
  Number,
  Select,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { itemCostValidator, itemCostingMethods } from "~/modules/parts";

type PartCostingFormProps = {
  initialValues: z.infer<typeof itemCostValidator>;
};

const currency = "USD"; // TODO: get from settings

const PartCostingForm = ({ initialValues }: PartCostingFormProps) => {
  const permissions = usePermissions();
  const [partCostingMethod, setPartCostingMethod] = useState<string>(
    initialValues.costingMethod
  );

  const partCostingMethodOptions = itemCostingMethods.map(
    (partCostingMethod) => ({
      label: partCostingMethod,
      value: partCostingMethod,
    })
  );

  return (
    <ValidatedForm
      method="post"
      validator={itemCostValidator}
      defaultValues={initialValues}
    >
      <Card>
        <CardHeader>
          <CardTitle>Costing & Posting</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="itemId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-2 w-full">
            <Select
              name="costingMethod"
              label="Part Costing Method"
              options={partCostingMethodOptions}
              onChange={(newValue) => {
                if (newValue) setPartCostingMethod(newValue.value);
              }}
            />
            <Number
              name="standardCost"
              label="Standard Cost"
              formatOptions={{
                style: "currency",
                currency,
              }}
              isReadOnly={partCostingMethod !== "Standard"}
            />

            <Number
              name="unitCost"
              label="Average Cost"
              formatOptions={{
                style: "currency",
                currency,
              }}
            />

            <Number
              name="salesHistory"
              label="Sales History"
              formatOptions={{
                style: "currency",
                currency,
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
      </Card>
    </ValidatedForm>
  );
};

export default PartCostingForm;
