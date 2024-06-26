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
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { partManufacturingValidator } from "~/modules/items";

type PartManufacturingFormProps = {
  initialValues: z.infer<typeof partManufacturingValidator>;
};

const PartManufacturingForm = ({
  initialValues,
}: PartManufacturingFormProps) => {
  const permissions = usePermissions();

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
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Number name="lotSize" label="Lot Size" />

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
          <Submit isDisabled={!permissions.can("update", "parts")}>Save</Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default PartManufacturingForm;
