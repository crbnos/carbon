import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher, useParams } from "react-router";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  PaymentTerm,
  Submit,
  Supplier,
  SupplierContact,
  SupplierLocation
} from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import {
  isPurchaseOrderLocked,
  purchaseOrderPaymentValidator
} from "~/modules/purchasing";
import type { action } from "~/routes/x+/purchase-order+/$orderId.payment";
import { path } from "~/utils/path";

type PurchaseOrderPaymentFormProps = {
  initialValues: z.infer<typeof purchaseOrderPaymentValidator>;
};

const PurchaseOrderPaymentForm = ({
  initialValues
}: PurchaseOrderPaymentFormProps) => {
  const { orderId } = useParams();
  if (!orderId) {
    throw new Error("orderId not found");
  }

  const routeData = useRouteData<{
    purchaseOrder: { status: string };
  }>(path.to.purchaseOrder(orderId));

  const isLocked = isPurchaseOrderLocked(routeData?.purchaseOrder?.status);

  const fetcher = useFetcher<typeof action>();
  const { t } = useLingui();
  const permissions = usePermissions();

  const [supplier, setSupplier] = useState<string | undefined>(
    initialValues.invoiceSupplierId
  );

  return (
    <Card>
      <ValidatedForm
        method="post"
        action={path.to.purchaseOrderPayment(orderId)}
        validator={purchaseOrderPaymentValidator}
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
            <Supplier
              name="invoiceSupplierId"
              label={t`Invoice Supplier`}
              termId="invoice-supplier"
              onChange={(value) => setSupplier(value?.value as string)}
            />
            <SupplierLocation
              name="invoiceSupplierLocationId"
              label={t`Invoice Location`}
              supplier={supplier}
            />
            <SupplierContact
              name="invoiceSupplierContactId"
              label={t`Invoice Contact`}
              supplier={supplier}
            />

            <PaymentTerm
              name="paymentTermId"
              label={t`Payment Terms`}
              termId="supplier-payment-term"
            />

            <CustomFormFields table="purchaseOrderPayment" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "purchasing")}>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default PurchaseOrderPaymentForm;
