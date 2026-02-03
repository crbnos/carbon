import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
  VStack
} from "@carbon/react";
import type { z } from "zod";
import {
  CustomFormFields,
  DatePicker,
  Employee,
  Hidden,
  Location,
  SequenceOrCustomId,
  Submit,
  Suppliers
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { purchasingRfqValidator } from "../../purchasing.models";

type PurchasingRFQFormValues = z.infer<typeof purchasingRfqValidator>;

type PurchasingRFQFormProps = {
  initialValues: PurchasingRFQFormValues;
};

const PurchasingRFQForm = ({ initialValues }: PurchasingRFQFormProps) => {
  const permissions = usePermissions();
  const isEditing = initialValues.id !== undefined;
  const isDraft = ["Draft"].includes(initialValues.status ?? "");

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={purchasingRfqValidator}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>
            {isEditing ? "Purchasing RFQ" : "New Purchasing RFQ"}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              A purchasing request for quote (RFQ) is sent to suppliers to
              request pricing on a set of items and quantities.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {isEditing && <Hidden name="rfqId" />}
          <VStack>
            <div
              className={cn(
                "grid w-full gap-x-8 gap-y-4",
                isEditing
                  ? "grid-cols-1 lg:grid-cols-3"
                  : "grid-cols-1 md:grid-cols-2"
              )}
            >
              {!isEditing && (
                <SequenceOrCustomId
                  name="rfqId"
                  label="RFQ ID"
                  table="purchasingRfq"
                />
              )}
              <Suppliers name="supplierIds" label="Suppliers" />
              <DatePicker name="rfqDate" label="RFQ Date" />
              <DatePicker name="expirationDate" label="Due Date" />
              <Location name="locationId" label="Receiving Location" />
              <Employee name="employeeId" label="Buyer" isOptional />
              <CustomFormFields table="purchasingRfq" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              !isDraft ||
              (isEditing
                ? !permissions.can("update", "purchasing")
                : !permissions.can("create", "purchasing"))
            }
          >
            Save
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default PurchasingRFQForm;
