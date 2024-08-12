import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import type { z } from "zod";
import { Input, Submit, SupplierType } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { supplierAccountingValidator } from "~/modules/purchasing";

type SupplierPaymentFormProps = {
  initialValues: z.infer<typeof supplierAccountingValidator>;
};

const SupplierAccountingForm = ({
  initialValues,
}: SupplierPaymentFormProps) => {
  const permissions = usePermissions();

  const isDisabled = !permissions.can("update", "purchasing");

  return (
    <ValidatedForm
      method="post"
      validator={supplierAccountingValidator}
      defaultValues={initialValues}
    >
      <Card>
        <CardHeader>
          <CardTitle>Supplier Accounting</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Input name="taxId" label="Tax ID" />
            <SupplierType
              name="supplierTypeId"
              label="Posting Group"
              placeholder="Select Posting Group"
            />
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

export default SupplierAccountingForm;
