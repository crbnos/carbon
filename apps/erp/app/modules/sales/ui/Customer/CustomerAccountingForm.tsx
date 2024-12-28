import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
} from "@carbon/react";
import type { z } from "zod";
import { CustomerType, Hidden, Input, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { customerAccountingValidator } from "../../sales.models";

type CustomerPaymentFormProps = {
  initialValues: z.infer<typeof customerAccountingValidator>;
};

const CustomerAccountingForm = ({
  initialValues,
}: CustomerPaymentFormProps) => {
  const permissions = usePermissions();

  const isDisabled = !permissions.can("update", "sales");

  return (
    <ValidatedForm
      method="post"
      validator={customerAccountingValidator}
      defaultValues={initialValues}
    >
      <Card>
        <CardHeader>
          <CardTitle>Customer Accounting</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <Input name="taxId" label="Tax ID" />
            <CustomerType
              name="customerTypeId"
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

export default CustomerAccountingForm;
