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
  DatePicker,
  Hidden,
  Input,
  Location,
  Select,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { salesRFQStatusType, salesRfqValidator } from "~/modules/sales";

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

  const statusOptions = salesRFQStatusType.map((status) => ({
    label: status,
    value: status,
  }));

  return (
    <ValidatedForm
      method="post"
      validator={salesRfqValidator}
      defaultValues={initialValues}
    >
      <Card>
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
              <Input name="customerReference" label="Customer Order Number" />
              {isEditing && permissions.can("delete", "sales") && (
                <Select
                  name="status"
                  label="Status"
                  value={initialValues.status}
                  options={statusOptions}
                  isReadOnly={isCustomer}
                />
              )}

              <CustomerContact
                name="customerContactId"
                label="Customer Contact"
                customer={customer}
              />

              <DatePicker
                name="rfqDate"
                label="RFQ Date"
                isDisabled={isCustomer}
              />
              <DatePicker
                name="expirateDate"
                label="Expiration Date"
                isDisabled={isCustomer}
              />
              <Location name="locationId" label="Location" />
              <CustomFormFields table="salesRfq" />
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
      </Card>
    </ValidatedForm>
  );
};

export default SalesRFQForm;
