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
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Submit,
  Supplier,
  SupplierContact,
  SupplierLocation
} from "~/components/Form";
import PaymentTerm from "~/components/Form/PaymentTerm";
import { usePermissions } from "~/hooks";
import { supplierPaymentValidator } from "~/modules/purchasing";

type SupplierPaymentFormProps = {
  initialValues: z.infer<typeof supplierPaymentValidator>;
};

const SupplierPaymentForm = ({ initialValues }: SupplierPaymentFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const [supplier, setSupplier] = useState<string | undefined>(
    initialValues.invoiceSupplierId
  );

  const isDisabled = !permissions.can("update", "purchasing");

  return (
    <ValidatedForm
      method="post"
      validator={supplierPaymentValidator}
      defaultValues={initialValues}
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Payment Terms</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="supplierId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Supplier
              name="invoiceSupplierId"
              label={t`Invoice Supplier`}
              onChange={(value) => setSupplier(value?.value as string)}
              termId="invoice-supplier"
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
              label={t`Payment Term`}
              termId="supplier-payment-term"
            />
            <CustomFormFields table="supplierPayment" />
          </div>
        </CardContent>
        <CardFooter>
          <HStack>
            <Submit isDisabled={isDisabled}>
              <Trans>Save</Trans>
            </Submit>
          </HStack>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default SupplierPaymentForm;
