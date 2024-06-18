import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import { useState } from "react";
import type { z } from "zod";
import {
  Boolean,
  Currency,
  CustomFormFields,
  Hidden,
  Select,
  Submit,
  Supplier,
  SupplierContact,
  SupplierLocation,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { purchaseOrderPaymentValidator } from "~/modules/purchasing";
import type { ListItem } from "~/types";

type PurchaseOrderPaymentFormProps = {
  initialValues: z.infer<typeof purchaseOrderPaymentValidator>;
  paymentTerms: ListItem[];
};

const PurchaseOrderPaymentForm = ({
  initialValues,
  paymentTerms,
}: PurchaseOrderPaymentFormProps) => {
  const permissions = usePermissions();

  const [supplier, setSupplier] = useState<string | undefined>(
    initialValues.invoiceSupplierId
  );

  const paymentTermOptions = paymentTerms.map((term) => ({
    label: term.name,
    value: term.id,
  }));

  return (
    <ValidatedForm
      method="post"
      validator={purchaseOrderPaymentValidator}
      defaultValues={initialValues}
    >
      <Card>
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

            <Select
              name="paymentTermId"
              label="Payment Terms"
              options={paymentTermOptions}
            />
            <Currency name="currencyCode" label="Currency" />

            <Boolean name="paymentComplete" label="Payment Complete" />
            <CustomFormFields table="purchaseOrderPayment" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "purchasing")}>
            Save
          </Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default PurchaseOrderPaymentForm;
