import { ValidatedForm } from "@carbon/form";
import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { z } from "zod";
import {
  CustomFormFields,
  DatePicker,
  Department,
  Employee,
  Hidden,
  Input,
  Location,
  Shift,
  Submit
} from "~/components/Form";
import { employeeJobValidator } from "../../people.models";

type PersonJobProps = {
  initialValues: z.infer<typeof employeeJobValidator>;
};

const PersonJob = ({ initialValues }: PersonJobProps) => {
  const { t } = useLingui();
  const [location, setLocation] = useState<string | null>(
    initialValues.locationId ?? null
  );
  return (
    <ValidatedForm
      validator={employeeJobValidator}
      method="post"
      defaultValues={initialValues}
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Job</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input name="title" label={t`Title`} />
            <DatePicker name="startDate" label={t`Start Date`} />
            <Location
              name="locationId"
              label={t`Location`}
              onChange={(l) => setLocation(l?.value ?? null)}
            />
            <Shift
              location={location ?? undefined}
              name="shiftId"
              label={t`Shift`}
            />
            <Department name="departmentId" label={t`Department`} />
            <Employee name="managerId" label={t`Manager`} />
            <Hidden name="intent" value="job" />
            <CustomFormFields table="employeeJob" />
          </div>
          <div>
            <Submit>
              <Trans>Save</Trans>
            </Submit>
          </div>
        </CardContent>
      </Card>
    </ValidatedForm>
  );
};

export default PersonJob;
