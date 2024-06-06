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
  Currency,
  CustomFormFields,
  Hidden,
  Number,
  Submit,
  UnitOfMeasure,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { itemUnitSalePriceValidator } from "~/modules/items";

type ItemSalePriceFormProps = {
  initialValues: z.infer<typeof itemUnitSalePriceValidator>;
};

const ItemSalePriceForm = ({ initialValues }: ItemSalePriceFormProps) => {
  const permissions = usePermissions();
  const [currency, setCurrency] = useState(initialValues.currencyCode);

  return (
    <ValidatedForm
      method="post"
      validator={itemUnitSalePriceValidator}
      defaultValues={initialValues}
    >
      <Card>
        <CardHeader>
          <CardTitle>Sale Price</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="itemId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-2 w-full">
            <Number
              name="unitSalePrice"
              label="Unit Sale Price"
              minValue={0}
              formatOptions={{
                style: "currency",
                currency,
              }}
            />
            <Currency
              name="currencyCode"
              label="Currency"
              onChange={(newValue) => {
                if (newValue) setCurrency(newValue?.value);
              }}
            />

            <UnitOfMeasure
              name="salesUnitOfMeasureCode"
              label="Sales Unit of Measure"
            />

            <Boolean name="salesBlocked" label="Sales Blocked" />
            <Boolean name="priceIncludesTax" label="Price Includes Tax" />
            <Boolean
              name="allowInvoiceDiscount"
              label="Allow Invoice Discount"
            />
            <CustomFormFields table="partUnitSalePrice" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "parts")}>Save</Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default ItemSalePriceForm;
