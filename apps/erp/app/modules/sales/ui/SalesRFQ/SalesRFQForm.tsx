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
import { salesRfqValidator } from "../../sales.models";

type SalesRFQFormValues = z.infer<typeof salesRfqValidator>;

type SalesRFQFormProps = {
  initialValues: SalesRFQFormValues;
};

const SalesRFQForm = ({ initialValues }: SalesRFQFormProps) => {
  const permissions = usePermissions();
  const [customer, setCustomer] = useState<string | undefined>(
    initialValues.customerId
  );
  const isEditing = initialValues.id !== undefined;
  const isCustomer = permissions.is("customer");
  const isDraft = ["Draft", "Ready to Quote"].includes(
    initialValues.status ?? ""
  );

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={salesRfqValidator}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>{isEditing ? "RFQ" : "New RFQ"}</CardTitle>
          {!isEditing && (
            <CardDescription>
              A sales request for quote (RFQ) is a customer inquiry for pricing
              on a set of parts and quantities. It may result in a quote.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="rfqId" />
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
              <Input name="customerReference" label="Customer RFQ" />
              <CustomerContact
                name="customerContactId"
                label="Purchasing Contact"
                customer={customer}
              />
              <CustomerContact
                name="customerEngineeringContactId"
                label="Engineering Contact"
                customer={customer}
              />
              <CustomerLocation
                name="customerLocationId"
                label="Customer Location"
                customer={customer}
              />
              <DatePicker
                name="rfqDate"
                label="RFQ Date"
                isDisabled={isCustomer}
              />
              <DatePicker
                name="expirationDate"
                label="Due Date"
                isDisabled={isCustomer}
              />
              <Location name="locationId" label="RFQ Location" />
              <Employee name="salesPersonId" label="Sales Person" isOptional />
              <CustomFormFields table="salesRfq" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              !isDraft ||
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

export default SalesRFQForm;
