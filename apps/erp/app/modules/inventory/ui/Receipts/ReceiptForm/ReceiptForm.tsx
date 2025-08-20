import { DefaultDisabledSubmit, ValidatedForm } from "@carbon/form";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  useDisclosure,
  VStack,
} from "@carbon/react";
import { LuEllipsisVertical, LuTrash } from "react-icons/lu";
import type { z } from "zod";
import {
  Combobox,
  CustomFormFields,
  Hidden,
  Input,
  Location,
  Select,
} from "~/components/Form";
import { ConfirmDelete } from "~/components/Modals";
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
    locationId,
    sourceDocuments,
    supplierId,
    setLocationId,
    setSourceDocument,
  } = useReceiptForm({ status, initialValues });

  const isPosted = status === "Posted";
  const isEditing = initialValues.id !== undefined;

  const deleteDisclosure = useDisclosure();

  return (
    <>
      <Card>
        <ValidatedForm
          id={formId}
          validator={receiptValidator}
          method="post"
          action={path.to.receiptDetails(initialValues.id)}
          defaultValues={initialValues}
          style={{ width: "100%" }}
        >
          <HStack className="justify-between w-full">
            <CardHeader>
              <CardTitle>{isEditing ? "Receipt" : "New Receipt"}</CardTitle>
              {!isEditing && (
                <CardDescription>
                  A receipt is a record of a part received from a supplier or
                  transferred from another location.
                </CardDescription>
              )}
            </CardHeader>
            <CardAction>
              {isEditing &&
                permissions.can("delete", "inventory") &&
                !isPosted && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        aria-label="Open menu"
                        variant="secondary"
                        icon={<LuEllipsisVertical />}
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={deleteDisclosure.onOpen}
                        className="text-destructive hover:text-destructive"
                      >
                        <DropdownMenuIcon icon={<LuTrash />} />
                        Delete Receipt
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
            </CardAction>
          </HStack>
          <CardContent>
            <Hidden name="id" />
            <Hidden name="supplierId" value={supplierId ?? ""} />
            <VStack spacing={4} className="min-h-full">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 w-full">
                <Input name="receiptId" label="Receipt ID" isReadOnly />
                <Location
                  name="locationId"
                  label="Location"
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
                      setSourceDocument(
                        newValue.value as ReceiptSourceDocument
                      );
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
                <Input
                  name="externalDocumentId"
                  label="External Reference"
                  isDisabled={isPosted}
                />
                <CustomFormFields table="receipt" />
              </div>
            </VStack>
          </CardContent>
          <CardFooter>
            <DefaultDisabledSubmit
              formId={formId}
              isDisabled={
                isEditing
                  ? !permissions.can("update", "inventory")
                  : !permissions.can("create", "inventory")
              }
            >
              Save
            </DefaultDisabledSubmit>
          </CardFooter>
        </ValidatedForm>
      </Card>
      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteReceipt(initialValues.id)}
          isOpen={deleteDisclosure.isOpen}
          name={initialValues.receiptId!}
          text={`Are you sure you want to delete ${initialValues.receiptId!}? This cannot be undone.`}
          onCancel={() => {
            deleteDisclosure.onClose();
          }}
          onSubmit={() => {
            deleteDisclosure.onClose();
          }}
        />
      )}
    </>
  );
};

export default ReceiptForm;
