import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@carbon/react";
import { useFetcher, useParams } from "@remix-run/react";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  Hidden,
  Number,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";

import type { action } from "~/routes/x+/part+/$itemId.manufacturing.$methodId.method";
import { itemManufacturingValidator } from "../../items.models";

type ItemManufacturingFormProps = {
  initialValues: z.infer<typeof itemManufacturingValidator>;
  withConfiguration?: boolean;
};

const ItemManufacturingForm = ({
  initialValues,
  withConfiguration = true,
}: ItemManufacturingFormProps) => {
  const fetcher = useFetcher<typeof action>();
  const permissions = usePermissions();
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
          <CardTitle>Manufacturing</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="itemId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Number name="lotSize" label="Batch Size" />
            <Number
              name="scrapPercentage"
              label="Scrap Percent"
              formatOptions={{
                style: "percent",
              }}
            />
            <Number name="leadTime" label="Lead Time (Days)" />
            {/* <Boolean
              name="manufacturingBlocked"
              label="Manufacturing Blocked"
            /> */}
            <div className="col-span-2" />

            {withConfiguration && (
              <Boolean
                name="requiresConfiguration"
                label=""
                description="Configured"
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
            Save
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default ItemManufacturingForm;
