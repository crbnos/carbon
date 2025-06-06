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
import { partManufacturingValidator } from "../../items.models";

type PartManufacturingFormProps = {
  initialValues: z.infer<typeof partManufacturingValidator>;
};

const PartManufacturingForm = ({
  initialValues,
}: PartManufacturingFormProps) => {
  const fetcher = useFetcher<typeof action>();
  const permissions = usePermissions();
  const { itemId } = useParams();

  if (!itemId) throw new Error("Could not find itemId");

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={partManufacturingValidator}
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
            {/* <Boolean
              name="manufacturingBlocked"
              label="Manufacturing Blocked"
            /> */}

            <Boolean
              name="requiresConfiguration"
              label="Requires Configuration"
            />
            <CustomFormFields table="partReplenishment" />
          </div>
        </CardContent>
        <CardFooter>
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

export default PartManufacturingForm;
