import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  VStack,
  cn,
} from "@carbon/react";
import { useState } from "react";
import type { z } from "zod";
import {
  CustomFormFields,
  Customer,
  CustomerContact,
  CustomerLocation,
  DatePicker,
  Employee,
  Hidden,
  Input,
  Location,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { quoteValidator } from "~/modules/sales";

type QuoteFormValues = z.infer<typeof quoteValidator>;

type QuoteFormProps = {
  initialValues: QuoteFormValues;
};

const QuoteForm = ({ initialValues }: QuoteFormProps) => {
  const permissions = usePermissions();
  const [customer, setCustomer] = useState<string | undefined>(
    initialValues.customerId
  );
  const isCustomer = permissions.is("customer");
  const isDisabled = initialValues?.status !== "Draft";
  const isEditing = initialValues.id !== undefined;

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={quoteValidator}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>{isEditing ? "Quote" : "New Quote"}</CardTitle>
          {!isEditing && (
            <CardDescription>
              A quote is a set of prices for specific parts and quantities.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="quoteId" />
          <VStack>
            <div
              className={cn(
                "grid w-full gap-x-8 gap-y-4",
                isEditing
                  ? "grid-cols-1 lg:grid-cols-3"
                  : "grid-cols-1 md:grid-cols-2"
              )}
            >
              <Customer
                autoFocus={!isEditing}
                name="customerId"
                label="Customer"
                onChange={(newValue) =>
                  setCustomer(newValue?.value as string | undefined)
                }
              />
              <Input name="customerReference" label="Customer Ref. Number" />
              <CustomerLocation
                name="customerLocationId"
                label="Customer Location"
                customer={customer}
              />
              <CustomerContact
                name="customerContactId"
                label="Customer Contact"
                customer={customer}
              />
              <Employee name="salesPersonId" label="Sales Person" />
              <Employee name="estimatorId" label="Estimator" />
              <Location name="locationId" label="Location" />

              <DatePicker
                name="dueDate"
                label="Due Date"
                isDisabled={isCustomer}
              />
              <DatePicker
                name="expirationDate"
                label="Expiration Date"
                isDisabled={isCustomer}
              />

              <CustomFormFields table="quote" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isDisabled ||
              (isEditing
                ? !permissions.can("update", "sales")
                : !permissions.can("create", "sales"))
            }
          >
            Save
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default QuoteForm;
