import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher, useParams } from "react-router";
import type { z } from "zod";
import {
  Customer,
  CustomerContact,
  CustomerLocation,
  Hidden,
  PaymentTerm,
  Submit
} from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import {
  isSalesOrderLocked,
  salesOrderPaymentValidator
} from "../../sales.models";
import type { SalesOrder } from "../../types";

type SalesOrderPaymentFormProps = {
  initialValues: z.infer<typeof salesOrderPaymentValidator>;
};

const SalesOrderPaymentForm = ({
  initialValues
}: SalesOrderPaymentFormProps) => {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();
  const permissions = usePermissions();
  const { orderId } = useParams();
  const routeData = useRouteData<{ salesOrder: SalesOrder }>(
    orderId ? path.to.salesOrder(orderId) : ""
  );
  const isLocked = isSalesOrderLocked(routeData?.salesOrder?.status);
  const [customer, setCustomer] = useState<string | undefined>(
    initialValues.invoiceCustomerId
  );

  const isDisabled = !permissions.can("update", "sales") || isLocked;

  return (
    <Card>
      <ValidatedForm
        method="post"
        action={path.to.salesOrderPayment(initialValues.id)}
        validator={salesOrderPaymentValidator}
        defaultValues={initialValues}
        fetcher={fetcher}
        isDisabled={isLocked}
      >
        <CardHeader>
          <CardTitle>
            <Trans>Payment</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Customer
              name="invoiceCustomerId"
              label={t`Invoice Customer`}
              onChange={(value) => setCustomer(value?.value as string)}
            />
            <CustomerLocation
              name="invoiceCustomerLocationId"
              label={t`Invoice Location`}
              customer={customer}
            />
            <CustomerContact
              name="invoiceCustomerContactId"
              label={t`Invoice Contact`}
              customer={customer}
            />

            <PaymentTerm name="paymentTermId" label={t`Payment Term`} />
          </div>
        </CardContent>
        <CardFooter>
          <HStack>
            <Submit isDisabled={isDisabled}>
              <Trans>Save</Trans>
            </Submit>
          </HStack>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default SalesOrderPaymentForm;
