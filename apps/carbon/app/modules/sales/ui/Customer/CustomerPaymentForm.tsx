import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
} from "@carbon/react";
import { useState } from "react";
import type { z } from "zod";
import {
  CustomFormFields,
  Customer,
  CustomerContact,
  CustomerLocation,
  Hidden,
  Submit,
} from "~/components/Form";
import PaymentTerm from "~/components/Form/PaymentTerm";
import { usePermissions } from "~/hooks";
import { customerPaymentValidator } from "~/modules/sales";

type CustomerPaymentFormProps = {
  initialValues: z.infer<typeof customerPaymentValidator>;
};

const CustomerPaymentForm = ({ initialValues }: CustomerPaymentFormProps) => {
  const permissions = usePermissions();
  const [customer, setCustomer] = useState<string | undefined>(
    initialValues.invoiceCustomerId
  );

  const isDisabled = !permissions.can("update", "sales");

  return (
    <ValidatedForm
      method="post"
      validator={customerPaymentValidator}
      defaultValues={initialValues}
    >
      <Card>
        <CardHeader>
          <CardTitle>Customer Payment</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="customerId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Customer
              name="invoiceCustomerId"
              label="Invoice Customer"
              onChange={(value) => setCustomer(value?.value as string)}
            />
            <CustomerLocation
              name="invoiceCustomerLocationId"
              label="Invoice Location"
              customer={customer}
            />
            <CustomerContact
              name="invoiceCustomerContactId"
              label="Invoice Contact"
              customer={customer}
            />

            <PaymentTerm name="paymentTermId" label="Payment Term" />
            <CustomFormFields table="customerPayment" />
          </div>
        </CardContent>
        <CardFooter>
          <HStack>
            <Submit isDisabled={isDisabled}>Save</Submit>
          </HStack>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default CustomerPaymentForm;
