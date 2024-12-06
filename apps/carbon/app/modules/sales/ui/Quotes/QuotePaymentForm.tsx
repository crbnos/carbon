import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
} from "@carbon/react";
import { useFetcher, useParams } from "@remix-run/react";
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
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { quotePaymentValidator } from "../../sales.models";
import type { Quotation } from "../../types";

type QuotePaymentFormProps = {
  initialValues: z.infer<typeof quotePaymentValidator>;
};

const QuotePaymentForm = ({ initialValues }: QuotePaymentFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
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

export default QuotePaymentForm;
