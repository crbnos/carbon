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
  Hidden,
  Input,
  Location,
  Select,
  Submit,
  TextArea,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { quotationValidator, quoteStatusType } from "~/modules/sales";

type QuotationFormValues = z.infer<typeof quotationValidator>;

type QuotationFormProps = {
  initialValues: QuotationFormValues;
};

const QuotationForm = ({ initialValues }: QuotationFormProps) => {
  const permissions = usePermissions();
  const [customer, setCustomer] = useState<string | undefined>(
    initialValues.customerId
  );

  const isEditing = initialValues.id !== undefined;

  const statusOptions = quoteStatusType.map((status) => ({
    label: status,
    value: status,
  }));

  return (
    <ValidatedForm
      method="post"
      validator={quotationValidator}
      defaultValues={initialValues}
      className="w-full"
    >
      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? "Quote" : "New Quote"}</CardTitle>
          {!isEditing && (
            <CardDescription>
              A quote is a document that provides a potential customer with a
              price for a product or service.
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
                onChange={(value) => setCustomer(value?.value as string)}
              />
              <Input name="name" label="Customer Reference" />

              <Location name="locationId" label="Location" />
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

              {isEditing && (
                <>
                  <DatePicker name="expirationDate" label="Expiration Date" />
                  <TextArea name="notes" label="Notes" />
                  {permissions.can("delete", "purchasing") && (
                    <Select
                      name="status"
                      label="Status"
                      value={initialValues.status}
                      options={statusOptions}
                      isReadOnly={permissions.is("customer")}
                    />
                  )}
                </>
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
      </Card>
    </ValidatedForm>
  );
};

export default QuotationForm;
