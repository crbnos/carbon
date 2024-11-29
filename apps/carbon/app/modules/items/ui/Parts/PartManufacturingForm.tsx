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
  InputControlled,
  Number,
  Submit,
} from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import type { PartSummary } from "~/modules/items";
import { partManufacturingValidator } from "~/modules/items";
import type { action } from "~/routes/x+/part+/$itemId.manufacturing.method";
import { path } from "~/utils/path";

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

  const routeData = useRouteData<{ partSummary: PartSummary }>(
    path.to.part(itemId)
  );

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
            <InputControlled
              isReadOnly
              name="id"
              label="Part ID"
              value={routeData?.partSummary?.id ?? ""}
            />
            <InputControlled
              isReadOnly
              name="name"
              label="Short Description"
              className="col-span-2"
              value={routeData?.partSummary?.name ?? ""}
            />
            <Number name="lotSize" label="Lot Size" />
            <Number
              name="scrapPercentage"
              label="Scrap Percent"
              formatOptions={{
                style: "percent",
              }}
            />
            <Boolean
              name="manufacturingBlocked"
              label="Manufacturing Blocked"
            />
            {/* <Boolean
              name="requiresConfiguration"
              label="Requires Configuration"
            /> */}
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
