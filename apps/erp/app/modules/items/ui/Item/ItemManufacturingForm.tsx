import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useFetcher, useParams } from "react-router";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  Hidden,
  Number,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";

import type { action } from "~/routes/x+/part+/$itemId.details";
import { itemManufacturingValidator } from "../../items.models";

type ItemManufacturingFormProps = {
  initialValues: z.infer<typeof itemManufacturingValidator>;
  withConfiguration?: boolean;
};

const ItemManufacturingForm = ({
  initialValues,
  withConfiguration = true
}: ItemManufacturingFormProps) => {
  const fetcher = useFetcher<typeof action>();
  const permissions = usePermissions();
  const { t } = useLingui();
  const { itemId } = useParams();

  if (!itemId) throw new Error("Could not find itemId");

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={itemManufacturingValidator}
        defaultValues={initialValues}
        fetcher={fetcher}
      >
        <CardHeader>
          <CardTitle>
            <Trans>Manufacturing</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="intent" value="manufacturing" />
          <Hidden name="itemId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Number
              name="lotSize"
              label={t`Batch Size`}
              termId="part-batch-size"
            />
            <Number
              name="scrapPercentage"
              label={t`Scrap Percent`}
              termId="item-scrap-percent"
              formatOptions={{
                style: "percent"
              }}
            />
            <Number
              name="leadTime"
              label={t`Lead Time (Days)`}
              termId="item-manufacturing-lead-time"
            />
            {/* <Boolean
              name="manufacturingBlocked"
              label={t`Manufacturing Blocked`}
            /> */}

            {withConfiguration && (
              <Boolean
                name="requiresConfiguration"
                label={t`Configured`}
                termId="item-configured"
                bordered
                description={t`Part is configured for manufacturing`}
                className="col-span-3"
              />
            )}
            <CustomFormFields table="partReplenishment" />
          </div>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Submit
            withBlocker={false}
            isDisabled={!permissions.can("update", "parts")}
          >
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default ItemManufacturingForm;
