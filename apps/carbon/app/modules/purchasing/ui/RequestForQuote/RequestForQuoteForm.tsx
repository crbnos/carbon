import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  VStack,
  cn,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import type { z } from "zod";
import {
  CustomFormFields,
  DatePicker,
  Hidden,
  Input,
  Location,
  Select,
  Submit,
  TextArea,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import {
  requestForQuoteStatusType,
  requestForQuoteValidator,
} from "~/modules/purchasing";

type RequestForQuoteFormValues = z.infer<typeof requestForQuoteValidator>;

type RequestForQuoteFormProps = {
  initialValues: RequestForQuoteFormValues;
};

const RequestForQuoteForm = ({ initialValues }: RequestForQuoteFormProps) => {
  const permissions = usePermissions();

  const isEditing = initialValues.id !== undefined;
  const isSupplier = permissions.is("supplier");

  const statusOptions = requestForQuoteStatusType.map((status) => ({
    label: status,
    value: status,
  }));

  return (
    <ValidatedForm
      method="post"
      validator={requestForQuoteValidator}
      defaultValues={initialValues}
    >
      <Card>
        <CardHeader>
          <CardTitle>
            {isEditing ? "Request for Quote" : "New Request for Quote"}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              A request for quote is a document that asks suppliers to provide
              price quotes for the purchase of goods or services.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="requestForQuoteId" />
          <VStack>
            <div
              className={cn(
                "grid w-full gap-x-8 gap-y-2",
                isEditing ? "grid-cols-1 lg:grid-cols-3" : "grid-cols-2"
              )}
            >
              <Input autoFocus={!isEditing} name="name" label="Name" />
              <DatePicker name="receiptDate" label="Receipt Date" />
              <DatePicker name="expirationDate" label="Expiration Date" />

              <Location name="locationId" label="Location" />
              {isEditing && (
                <>
                  <Select
                    name="status"
                    label="Status"
                    value={initialValues.status}
                    options={statusOptions}
                    isReadOnly={
                      isSupplier || !permissions.can("delete", "purchasing")
                    }
                  />

                  <TextArea name="notes" label="Notes" readOnly={isSupplier} />
                </>
              )}
              <CustomFormFields table="requestForQuote" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isEditing
                ? !permissions.can("update", "purchasing")
                : !permissions.can("create", "purchasing")
            }
          >
            Save
          </Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default RequestForQuoteForm;
