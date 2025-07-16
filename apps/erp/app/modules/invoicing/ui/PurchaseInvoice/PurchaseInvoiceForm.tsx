import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  VStack,
  cn,
  toast,
} from "@carbon/react";
import { useState } from "react";
import { flushSync } from "react-dom";
import type { z } from "zod";
import {
  Currency,
  CustomFormFields,
  DatePicker,
  Hidden,
  Input,
  Location,
  SequenceOrCustomId,
  Submit,
  Supplier,
  SupplierContact,
  SupplierLocation,
} from "~/components/Form";
import PaymentTerm from "~/components/Form/PaymentTerm";
import { usePermissions } from "~/hooks";
import { purchaseInvoiceValidator } from "~/modules/invoicing";

type PurchaseInvoiceFormValues = z.infer<typeof purchaseInvoiceValidator>;

type PurchaseInvoiceFormProps = {
  initialValues: PurchaseInvoiceFormValues;
};

const PurchaseInvoiceForm = ({ initialValues }: PurchaseInvoiceFormProps) => {
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const isEditing = initialValues.id !== undefined;

  const [invoiceSupplier, setInvoiceSupplier] = useState<{
    id: string | undefined;
    invoiceSupplierContactId: string | undefined;
    invoiceSupplierLocationId: string | undefined;
    currencyCode: string | undefined;
    paymentTermId: string | undefined;
  }>({
    id: initialValues.invoiceSupplierId,
    invoiceSupplierContactId: initialValues.invoiceSupplierContactId,
    invoiceSupplierLocationId: initialValues.invoiceSupplierLocationId,
    currencyCode: initialValues.currencyCode,
    paymentTermId: initialValues.paymentTermId,
  });

  const [supplier, setSupplier] = useState<{
    id: string | undefined;
  }>({
    id: initialValues.supplierId,
  });

  const onSupplierChange = async (
    newValue: {
      value: string | undefined;
      label: string;
    } | null
  ) => {
    setSupplier({ id: newValue?.value });
    if (newValue?.value !== invoiceSupplier.id) {
      onInvoiceSupplierChange(newValue);
    }
  };

  const onInvoiceSupplierChange = async (
    newValue: {
      value: string | undefined;
      label: string;
    } | null
  ) => {
    if (!carbon) {
      toast.error("Carbon client not found");
      return;
    }

    if (newValue?.value) {
      flushSync(() => {
        // update the supplier immediately
        setInvoiceSupplier({
          id: newValue?.value,
          currencyCode: undefined,
          paymentTermId: undefined,
          invoiceSupplierContactId: undefined,
          invoiceSupplierLocationId: undefined,
        });
      });

      const [supplierData, paymentTermData] = await Promise.all([
        carbon
          ?.from("supplier")
          .select("currencyCode")
          .eq("id", newValue.value)
          .single(),
        carbon
          ?.from("supplierPayment")
          .select("*")
          .eq("supplierId", newValue.value)
          .single(),
      ]);

      if (supplierData.error || paymentTermData.error) {
        toast.error("Error fetching supplier data");
      } else {
        setInvoiceSupplier((prev) => ({
          ...prev,
          id: newValue.value,
          invoiceSupplierContactId:
            paymentTermData.data.invoiceSupplierContactId ?? undefined,
          invoiceSupplierLocationId:
            paymentTermData.data.invoiceSupplierLocationId ?? undefined,
          currencyCode: supplierData.data.currencyCode ?? undefined,
          paymentTermId: paymentTermData.data.paymentTermId ?? undefined,
        }));
      }
    } else {
      setInvoiceSupplier({
        id: undefined,
        currencyCode: undefined,
        paymentTermId: undefined,
        invoiceSupplierContactId: undefined,
        invoiceSupplierLocationId: undefined,
      });
    }
  };

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
          {isEditing && <Hidden name="invoiceId" />}
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
                  name="invoiceId"
                  label="Invoice ID"
                  table="purchaseInvoice"
                />
              )}
              <Supplier
                name="supplierId"
                label="Supplier"
                onChange={onSupplierChange}
              />
              <Input name="supplierReference" label="Supplier Invoice Number" />

              <Supplier
                name="invoiceSupplierId"
                label="Invoice Supplier"
                value={invoiceSupplier.id}
                onChange={onInvoiceSupplierChange}
              />
              <SupplierLocation
                name="invoiceSupplierLocationId"
                label="Invoice Supplier Location"
                supplier={supplier.id}
                value={invoiceSupplier.invoiceSupplierLocationId}
                onChange={(newValue) => {
                  if (newValue?.id) {
                    setInvoiceSupplier((prevSupplier) => ({
                      ...prevSupplier,
                      invoiceSupplierLocationId: newValue.id,
                    }));
                  }
                }}
              />
              <SupplierContact
                name="invoiceSupplierContactId"
                label="Invoice Supplier Contact"
                supplier={supplier.id}
                value={invoiceSupplier.invoiceSupplierContactId}
                onChange={(newValue) => {
                  if (newValue?.id) {
                    setInvoiceSupplier((prevSupplier) => ({
                      ...prevSupplier,
                      invoiceSupplierContactId: newValue.id,
                    }));
                  }
                }}
              />

              <DatePicker name="dateDue" label="Due Date" />
              <DatePicker name="dateIssued" label="Date Issued" />

              <PaymentTerm
                name="paymentTermId"
                label="Payment Terms"
                value={invoiceSupplier?.paymentTermId}
                onChange={(newValue) => {
                  if (newValue?.value) {
                    setInvoiceSupplier((prevSupplier) => ({
                      ...prevSupplier,
                      paymentTermId: newValue.value,
                    }));
                  }
                }}
              />
              <Currency
                name="currencyCode"
                label="Currency"
                value={invoiceSupplier?.currencyCode}
                onChange={(newValue) => {
                  if (newValue?.value) {
                    setInvoiceSupplier((prevSupplier) => ({
                      ...prevSupplier,
                      currencyCode: newValue.value,
                    }));
                  }
                }}
              />
              <Location name="locationId" label="Location" />
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
