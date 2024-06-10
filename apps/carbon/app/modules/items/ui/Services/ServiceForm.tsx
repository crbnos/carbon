import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  Hidden,
  Input,
  InputControlled,
  ItemGroup,
  Select,
  Submit,
  TextArea,
} from "~/components/Form";
import { useNextItemId, usePermissions } from "~/hooks";
import { serviceType, serviceValidator } from "~/modules/items";

type ServiceFormProps = {
  initialValues: z.infer<typeof serviceValidator>;
};

const ServiceForm = ({ initialValues }: ServiceFormProps) => {
  const { id, onIdChange, loading } = useNextItemId("service");

  const permissions = usePermissions();
  const isEditing = initialValues.id !== undefined;

  const serviceTypeOptions =
    serviceType.map((type) => ({
      label: type,
      value: type,
    })) ?? [];

  return (
    <ValidatedForm
      method="post"
      validator={serviceValidator}
      defaultValues={initialValues}
      className="w-full"
    >
      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? "Service Details" : "New Service"}</CardTitle>
          {!isEditing && (
            <CardDescription>
              A service is an intangible activity that can be purchased or sold.
              When a service is purchased, it is accounted for as overhead.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="itemInventoryType" value="Non-Inventory" />
          <div
            className={cn(
              "grid w-full gap-x-8 gap-y-2",
              isEditing ? "grid-cols-1 lg:grid-cols-3" : "grid-cols-1"
            )}
          >
            {isEditing ? (
              <Input name="id" label="Service ID" isReadOnly />
            ) : (
              <InputControlled
                name="id"
                label="Service ID"
                helperText="Use ... to get the next service ID"
                value={id}
                onChange={onIdChange}
                isDisabled={loading}
                autoFocus
              />
            )}
            <Input name="name" label="Name" />
            <ItemGroup name="itemGroupId" label="Posting Group" />
            <TextArea name="description" label="Description" />

            <Select
              name="serviceType"
              label="Service Type"
              options={serviceTypeOptions}
            />

            <Boolean name="blocked" label="Blocked" />
            {isEditing && <Boolean name="active" label="Active" />}
            <CustomFormFields table="service" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isEditing
                ? !permissions.can("update", "parts")
                : !permissions.can("create", "parts")
            }
          >
            Save
          </Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default ServiceForm;
