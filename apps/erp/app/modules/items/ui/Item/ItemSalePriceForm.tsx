import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { INPUT_FORMAT } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import { CustomFormFields, Hidden, Number, Submit } from "~/components/Form";
import { useCurrencyDecimals, usePermissions, useUser } from "~/hooks";
import { itemUnitSalePriceValidator } from "../../items.models";

type ItemSalePriceFormProps = {
  initialValues: z.infer<typeof itemUnitSalePriceValidator>;
};

const ItemSalePriceForm = ({ initialValues }: ItemSalePriceFormProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();
  const { company } = useUser();
  const currencyDecimals = useCurrencyDecimals(
    company?.baseCurrencyCode ?? "USD"
  );

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={itemUnitSalePriceValidator}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>
            <Trans>Sale Price</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="itemId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Number
              name="unitSalePrice"
              label={t`Unit Sale Price`}
              minValue={0}
              formatOptions={INPUT_FORMAT.rate(
                company?.baseCurrencyCode ?? "USD",
                currencyDecimals
              )}
            />
            {/* <Currency
              name="currencyCode"
              label={t`Currency`}
              onChange={(newValue) => {
                if (newValue) setCurrency(newValue?.value);
              }}
            />

            <UnitOfMeasure
              name="salesUnitOfMeasureCode"
              label={t`Sales Unit of Measure`}
            />

            <Boolean name="salesBlocked" label={t`Sales Blocked`} />
            <Boolean name="priceIncludesTax" label={t`Price Includes Tax`} />
            <Boolean
              name="allowInvoiceDiscount"
              label={t`Allow Invoice Discount`}
            /> */}
            <CustomFormFields table="partUnitSalePrice" />
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

export default ItemSalePriceForm;
