import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
} from "@carbon/react";
import { useParams } from "@remix-run/react";
import { useState } from "react";
import type { z } from "zod";
import {
  Currency,
  Customer,
  CustomerContact,
  CustomerLocation,
  Hidden,
  PaymentTerm,
  Submit,
} from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import type { Quotation } from "~/modules/sales";
import { quotePaymentValidator } from "~/modules/sales";
import { path } from "~/utils/path";

type QuotePaymentFormProps = {
  initialValues: z.infer<typeof quotePaymentValidator>;
};

const QuotePaymentForm = ({ initialValues }: QuotePaymentFormProps) => {
  const permissions = usePermissions();
  const [customer, setCustomer] = useState<string | undefined>(
    initialValues.invoiceCustomerId
  );

  const { quoteId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");
  const routeData = useRouteData<{
    quote: Quotation;
  }>(path.to.quote(quoteId));

  const isEditable = ["Draft", "To Review"].includes(
    routeData?.quote?.status ?? ""
  );
  const isDisabled = !isEditable || !permissions.can("update", "sales");

  return (
    <Card isCollapsible defaultCollapsed>
      <ValidatedForm
        method="post"
        action={path.to.quotePayment(initialValues.id)}
        validator={quotePaymentValidator}
        defaultValues={initialValues}
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
            <Currency name="currencyCode" label="Currency" />
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

export default QuotePaymentForm;
