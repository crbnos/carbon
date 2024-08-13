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
import { ValidatedForm } from "@carbon/remix-validated-form";
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
  Select,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { quoteStatusType, quoteValidator } from "~/modules/sales";

type QuoteFormValues = z.infer<typeof quoteValidator>;

type QuoteFormProps = {
  initialValues: QuoteFormValues;
};

const QuoteForm = ({ initialValues }: QuoteFormProps) => {
  const permissions = usePermissions();
  const [customer, setCustomer] = useState<string | undefined>(
    initialValues.customerId
  );
  const isEditing = initialValues.id !== undefined;
  const isCustomer = permissions.is("customer");

  const statusOptions = quoteStatusType.map((status) => ({
    label: status,
    value: status,
  }));

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
                isEditing ? "grid-cols-1 lg:grid-cols-3" : "grid-cols-2"
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
              <Input name="customerReference" label="Customer Ref. Number" />
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
              {isEditing && permissions.can("delete", "sales") && (
                <Select
                  name="status"
                  label="Status"
                  value={initialValues.status}
                  options={statusOptions}
                  isReadOnly={isCustomer}
                />
              )}
              <CustomFormFields table="quote" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isEditing
                ? !permissions.can("update", "sales")
                : !permissions.can("create", "sales")
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
