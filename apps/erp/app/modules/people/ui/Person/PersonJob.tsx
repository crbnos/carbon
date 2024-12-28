import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  VStack,
} from "@carbon/react";
import { useState } from "react";
import type { z } from "zod";
import {
  CustomFormFields,
  DatePicker,
  Employee,
  Hidden,
  Input,
  Location,
  Shift,
  Submit,
} from "~/components/Form";
import { employeeJobValidator } from "../../people.models";

type PersonJobProps = {
  initialValues: z.infer<typeof employeeJobValidator>;
};

const PersonJob = ({ initialValues }: PersonJobProps) => {
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
          <CardTitle>Job</CardTitle>
        </CardHeader>
        <CardContent>
          <VStack spacing={4}>
            <Input name="title" label="Title" />
            <DatePicker name="startDate" label="Start Date" />
            <Location
              name="locationId"
              label="Location"
              onChange={(l) => setLocation(l?.value ?? null)}
            />
            <Shift
              location={location ?? undefined}
              name="shiftId"
              label="Shift"
            />
            <Employee name="managerId" label="Manager" />
            <Hidden name="intent" value="job" />
            <CustomFormFields table="employeeJob" />
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit>Save</Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default PersonJob;
