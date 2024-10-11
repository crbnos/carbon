import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  VStack,
} from "@carbon/react";
import type { z } from "zod";
import {
  Combobox,
  CustomFormFields,
  Hidden,
  Input,
  Select,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type {
  ReceiptLine,
  ReceiptSourceDocument,
  receiptStatusType,
} from "~/modules/inventory";
import {
  receiptSourceDocumentType,
  receiptValidator,
} from "~/modules/inventory";
import { path } from "~/utils/path";
import useReceiptForm from "./useReceiptForm";

type ReceiptFormProps = {
  initialValues: z.infer<typeof receiptValidator>;
  status: (typeof receiptStatusType)[number];
  receiptLines?: ReceiptLine[];
};

const formId = "receipt-form";

const ReceiptForm = ({ initialValues, status }: ReceiptFormProps) => {
  const permissions = usePermissions();
  const {
    locations,
    locationId,
    sourceDocuments,
    supplierId,
    setLocationId,
    setSourceDocument,
  } = useReceiptForm();

  const isPosted = status === "Posted";
  const isEditing = initialValues.id !== undefined;
  const locationOptions = locations.map((l) => ({
    label: l.name,
    value: l.id,
  }));

  return (
    <ValidatedForm
      id={formId}
      validator={receiptValidator}
      method="post"
      action={path.to.receiptDetails(initialValues.id)}
      defaultValues={initialValues}
      style={{ width: "100%" }}
    >
      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? "Receipt" : "New Receipt"}</CardTitle>
          {!isEditing && (
            <CardDescription>
              A receipt is a record of a part received from a supplier or
              transfered from another location.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <Hidden name="supplierId" value={supplierId ?? ""} />
          <VStack spacing={4} className="min-h-full">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 w-full">
              <Input name="receiptId" label="Receipt ID" isReadOnly />
              <Combobox
                name="locationId"
                label="Location"
                options={locationOptions}
                value={locationId ?? undefined}
                onChange={(newValue) => {
                  if (newValue) setLocationId(newValue.value as string);
                }}
                isReadOnly={isPosted}
              />
              <Select
                name="sourceDocument"
                label="Source Document"
                options={receiptSourceDocumentType.map((v) => ({
                  label: v,
                  value: v,
                }))}
                onChange={(newValue) => {
                  if (newValue) {
                    setSourceDocument(newValue.value as ReceiptSourceDocument);
                  }
                }}
                isReadOnly={isPosted}
              />
              <Combobox
                name="sourceDocumentId"
                label="Source Document ID"
                options={sourceDocuments.map((d) => ({
                  label: d.name,
                  value: d.id,
                }))}
                isReadOnly={isPosted}
              />
              <Input name="externalDocumentId" label="External Reference" />
              <CustomFormFields table="receipt" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isEditing
                ? !permissions.can("update", "inventory")
                : !permissions.can("create", "inventory")
            }
          >
            Save
          </Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>

    // <Notes notes={notes} documentId={initialValues.id} />
  );
};

export default ReceiptForm;
