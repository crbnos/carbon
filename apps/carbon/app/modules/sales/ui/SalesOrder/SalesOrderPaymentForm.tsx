import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useState } from "react";
import type { z } from "zod";
import {
  Customer,
  CustomerContact,
  CustomerLocation,
  Hidden,
  PaymentTerm,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { salesOrderPaymentValidator } from "~/modules/sales";
import { path } from "~/utils/path";

type SalesOrderPaymentFormProps = {
  initialValues: z.infer<typeof salesOrderPaymentValidator>;
};

const SalesOrderPaymentForm = ({
  initialValues,
}: SalesOrderPaymentFormProps) => {
  const fetcher = useFetcher<{}>();
  const permissions = usePermissions();
  const [customer, setCustomer] = useState<string | undefined>(
    initialValues.invoiceCustomerId
  );

  const isDisabled = !permissions.can("update", "sales");

  return (
    <Card isCollapsible defaultCollapsed>
      <ValidatedForm
        method="post"
        action={path.to.salesOrderPayment(initialValues.id)}
        validator={salesOrderPaymentValidator}
        defaultValues={initialValues}
        fetcher={fetcher}
      >
        <CardHeader>
          <CardTitle>Payment</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
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
          </div>
        </CardContent>
        <CardFooter>
          <HStack>
            <Submit isDisabled={isDisabled}>Save</Submit>
          </HStack>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default SalesOrderPaymentForm;
