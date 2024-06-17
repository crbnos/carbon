import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
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
import {
  partManufacturingPolicies,
  partManufacturingValidator,
} from "~/modules/items";

type PartManufacturingFormProps = {
  initialValues: z.infer<typeof partManufacturingValidator>;
};

const PartManufacturingForm = ({
  initialValues,
}: PartManufacturingFormProps) => {
  const permissions = usePermissions();

  const partManufacturingPolicyOptions =
    partManufacturingPolicies?.map((policy) => ({
      label: policy,
      value: policy,
    })) ?? [];

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={partManufacturingValidator}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>Manufacturing</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="itemId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-2 w-full">
            <Select
              name="manufacturingPolicy"
              label="Manufacturing Policy"
              options={partManufacturingPolicyOptions}
            />
            {/* <Select
                name="routingId"
                label="Routing ID"
                options={[{ label: "", value: "" }]}
              /> */}

            <Number name="manufacturingLeadTime" label="Lead Time (Days)" />
            <Number
              name="scrapPercentage"
              label="Scrap Percentage"
              formatOptions={{ style: "percent" }}
            />
            <Number name="lotSize" label="Lot Size" />

            <Boolean
              name="manufacturingBlocked"
              label="Manufacturing Blocked"
            />
            <Boolean
              name="requiresConfiguration"
              label="Requires Configuration"
            />
            <CustomFormFields table="partReplenishment" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "parts")}>Save</Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default PartManufacturingForm;
