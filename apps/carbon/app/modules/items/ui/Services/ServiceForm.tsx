import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
} from "@carbon/react";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  Hidden,
  Input,
  InputControlled,
  Number,
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
  const { id, onIdChange, loading } = useNextItemId("Service");

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
          <Hidden name="itemTrackingType" value="Non-Inventory" />
          <Hidden name="unitOfMeasureCode" value="EA" />
          <Hidden name="replenishmentSystem" value="Buy" />
          <Hidden name="defaultMethodType" value="Buy" />
          <div
            className={cn(
              "grid w-full gap-x-8 gap-y-4",
              isEditing
                ? "grid-cols-1 lg:grid-cols-3"
                : "grid-cols-1 md:grid-cols-2"
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
                isUppercase
                autoFocus
              />
            )}
            <Input name="name" label="Short Description" />
            <Select
              name="serviceType"
              label="Service Type"
              options={serviceTypeOptions}
            />
            {isEditing && (
              <TextArea name="description" label="Long Description" />
            )}
            {!isEditing && (
              <Number
                name="unitCost"
                label="Unit Cost"
                formatOptions={{
                  style: "currency",
                  currency: "USD",
                }}
                minValue={0}
              />
            )}
            <Boolean name="active" label="Active" />
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
