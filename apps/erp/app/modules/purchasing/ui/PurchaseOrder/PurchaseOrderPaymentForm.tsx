import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@carbon/react";
import { useFetcher, useParams } from "@remix-run/react";
import { useState } from "react";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  Hidden,
  PaymentTerm,
  Submit,
  Supplier,
  SupplierContact,
  SupplierLocation,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { purchaseOrderPaymentValidator } from "~/modules/purchasing";
import type { action } from "~/routes/x+/purchase-order+/$orderId.payment";
import { path } from "~/utils/path";

type PurchaseOrderPaymentFormProps = {
  initialValues: z.infer<typeof purchaseOrderPaymentValidator>;
};

const PurchaseOrderPaymentForm = ({
  initialValues,
}: PurchaseOrderPaymentFormProps) => {
  const { orderId } = useParams();
  if (!orderId) {
    throw new Error("orderId not found");
  }

  const fetcher = useFetcher<typeof action>();
  const permissions = usePermissions();

  const [supplier, setSupplier] = useState<string | undefined>(
    initialValues.invoiceSupplierId
  );

  return (
    <Card isCollapsible defaultCollapsed>
      <ValidatedForm
        method="post"
        action={path.to.purchaseOrderPayment(orderId)}
        validator={purchaseOrderPaymentValidator}
        defaultValues={initialValues}
        fetcher={fetcher}
      >
        <CardHeader>
          <CardTitle>Payment</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Supplier
              name="invoiceSupplierId"
              label="Invoice Supplier"
              onChange={(value) => setSupplier(value?.value as string)}
            />
            <SupplierLocation
              name="invoiceSupplierLocationId"
              label="Invoice Location"
              supplier={supplier}
            />
            <SupplierContact
              name="invoiceSupplierContactId"
              label="Invoice Contact"
              supplier={supplier}
            />

            <PaymentTerm name="paymentTermId" label="Payment Terms" />

            <Boolean name="paymentComplete" label="Payment Complete" />
            <CustomFormFields table="purchaseOrderPayment" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "purchasing")}>
            Save
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default PurchaseOrderPaymentForm;
