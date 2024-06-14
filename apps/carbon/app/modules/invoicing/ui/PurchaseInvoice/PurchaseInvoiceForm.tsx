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
import { useState } from "react";
import type { z } from "zod";
import {
  Currency,
  CustomFormFields,
  DatePicker,
  Hidden,
  Input,
  Select,
  Submit,
  Supplier,
  SupplierContact,
  SupplierLocation,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import {
  purchaseInvoiceStatusType,
  purchaseInvoiceValidator,
} from "~/modules/invoicing";
import type { ListItem } from "~/types";

type PurchaseInvoiceFormValues = z.infer<typeof purchaseInvoiceValidator>;

type PurchaseInvoiceFormProps = {
  initialValues: PurchaseInvoiceFormValues;
  paymentTerms: ListItem[];
};

const PurchaseInvoiceForm = ({
  initialValues,
  paymentTerms,
}: PurchaseInvoiceFormProps) => {
  const permissions = usePermissions();
  const [supplier, setSupplier] = useState<string | undefined>(
    initialValues.supplierId
  );

  const isEditing = initialValues.id !== undefined;

  const statusOptions = purchaseInvoiceStatusType.map((status) => ({
    label: status,
    value: status,
  }));

  const paymentTermOptions = paymentTerms.map((paymentTerm) => ({
    label: paymentTerm.name,
    value: paymentTerm.id,
  }));

  return (
    <ValidatedForm
      method="post"
      validator={purchaseInvoiceValidator}
      defaultValues={initialValues}
    >
      <Card>
        <CardHeader>
          <CardTitle>
            {isEditing ? "Purchase Invoice" : "New Purchase Invoice"}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              A purchase invoice is a document that specifies the products or
              services purchased by a customer and the corresponding cost.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <Hidden name="invoiceId" />
          <VStack>
            <div
              className={cn(
                "grid w-full gap-x-8 gap-y-2",
                isEditing ? "grid-cols-1 lg:grid-cols-3" : "grid-cols-2"
              )}
            >
              <Supplier
                name="supplierId"
                label="Supplier"
                isReadOnly={isEditing}
              />
              <Input name="supplierReference" label="Supplier Invoice Number" />

              {isEditing && (
                <>
                  <Select
                    name="status"
                    label="Status"
                    value={initialValues.status}
                    options={statusOptions}
                    isReadOnly={permissions.can("delete", "invoicing")}
                  />
                  <Supplier
                    name="invoiceSupplierId"
                    label="Invoice Supplier"
                    onChange={(newValue) =>
                      setSupplier(newValue?.value as string | undefined)
                    }
                  />
                  <SupplierLocation
                    name="invoiceSupplierLocationId"
                    label="Invoice Location"
                    supplier={supplier}
                  />
                  <SupplierContact
                    name="invoiceSupplierContactId"
                    label="Invoice Supplier Contact"
                    supplier={supplier}
                  />
                </>
              )}

              <DatePicker name="dateDue" label="Due Date" />
              <DatePicker name="dateIssued" label="Date Issued" />
              {isEditing && (
                <>
                  <Select
                    name="paymentTermId"
                    label="Payment Terms"
                    options={paymentTermOptions}
                  />
                  <Currency name="currencyCode" label="Currency" />
                </>
              )}
              <CustomFormFields table="purchaseInvoice" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isEditing
                ? !permissions.can("update", "invoicing")
                : !permissions.can("create", "invoicing")
            }
          >
            Save
          </Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default PurchaseInvoiceForm;
