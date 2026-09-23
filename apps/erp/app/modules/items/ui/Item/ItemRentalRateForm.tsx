import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { INPUT_FORMAT } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import { Hidden, Number, Submit } from "~/components/Form";
import { useCurrencyDecimals, usePermissions } from "~/hooks";
import { itemRentalRateValidator } from "~/modules/sales";

type ItemRentalRateFormProps = {
  initialValues: z.infer<typeof itemRentalRateValidator>;
};

// The item's day / week / month rate ladder in one currency. A rental
// agreement line snapshots these tiers at activation, so editing them never
// touches a live agreement.
const ItemRentalRateForm = ({ initialValues }: ItemRentalRateFormProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();
  const currencyDecimals = useCurrencyDecimals(initialValues.currencyCode);
  const formatOptions = INPUT_FORMAT.rate(
    initialValues.currencyCode,
    currencyDecimals
  );

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={itemRentalRateValidator}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>
            <Trans>Rental Rates</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Rates a rental agreement line uses for this item. At least one is
              required.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Hidden name="intent" value="rentalRate" />
          <Hidden name="itemId" />
          <Hidden name="currencyCode" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Number
              name="dayRate"
              label={t`Day Rate`}
              minValue={0}
              formatOptions={formatOptions}
            />
            <Number
              name="weekRate"
              label={t`Week Rate`}
              minValue={0}
              formatOptions={formatOptions}
            />
            <Number
              name="monthRate"
              label={t`Month Rate`}
              minValue={0}
              formatOptions={formatOptions}
            />
          </div>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              !permissions.can("update", "parts") ||
              !permissions.can("update", "sales")
            }
          >
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default ItemRentalRateForm;
