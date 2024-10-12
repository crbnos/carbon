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
  Select,
  Submit,
  Supplier,
  SupplierContact,
  SupplierLocation,
  TextArea,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import {
  purchaseOrderStatusType,
  purchaseOrderTypeType,
  purchaseOrderValidator,
} from "~/modules/purchasing";

type PurchaseOrderFormValues = z.infer<typeof purchaseOrderValidator>;

type PurchaseOrderFormProps = {
  initialValues: PurchaseOrderFormValues;
};

const PurchaseOrderForm = ({ initialValues }: PurchaseOrderFormProps) => {
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const [supplier, setSupplier] = useState<{
    id: string | undefined;
    currencyCode: string | undefined;
  }>({
    id: initialValues.supplierId,
    currencyCode: initialValues.currencyCode,
  });
  const isEditing = initialValues.id !== undefined;
  const isSupplier = permissions.is("supplier");

  const statusOptions = purchaseOrderStatusType.map((status) => ({
    label: status,
    value: status,
  }));

  const typeOptions = purchaseOrderTypeType.map((type) => ({
    label: type,
    value: type,
  }));

  const onSupplierChange = async (
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
        setSupplier({
          id: newValue?.value,
          currencyCode: undefined,
        });
      });

      const { data, error } = await carbon
        ?.from("supplier")
        .select("currencyCode")
        .eq("id", newValue.value)
        .single();
      if (error) {
        toast.error("Error fetching supplier data");
      } else {
        setSupplier((prev) => ({
          ...prev,
          currencyCode: data.currencyCode ?? undefined,
        }));
      }
    } else {
      setSupplier({
        id: undefined,
        currencyCode: undefined,
      });
    }
  };

  return (
    <ValidatedForm
      method="post"
      validator={purchaseOrderValidator}
      defaultValues={initialValues}
    >
      <Card>
        <CardHeader>
          <CardTitle>
            {isEditing ? "Purchase Order" : "New Purchase Order"}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              A purchase order contains information about the agreement between
              the company and a specific supplier for parts and services.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="purchaseOrderId" />
          <VStack>
            <div
              className={cn(
                "grid w-full gap-x-8 gap-y-4",
                isEditing
                  ? "grid-cols-1 lg:grid-cols-3"
                  : "grid-cols-1 md:grid-cols-2"
              )}
            >
              <Supplier
                autoFocus={!isEditing}
                name="supplierId"
                label="Supplier"
                onChange={onSupplierChange}
              />
              <Input name="supplierReference" label="Supplier Order Number" />
              {isEditing && permissions.can("delete", "purchasing") && (
                <Select
                  name="status"
                  label="Status"
                  value={initialValues.status}
                  options={statusOptions}
                  isReadOnly={isSupplier}
                />
              )}
              <SupplierLocation
                name="supplierLocationId"
                label="Supplier Location"
                supplier={supplier.id}
              />
              <SupplierContact
                name="supplierContactId"
                label="Supplier Contact"
                supplier={supplier.id}
              />

              <DatePicker
                name="orderDate"
                label="Order Date"
                isDisabled={isSupplier}
              />
              <Select
                name="type"
                label="Type"
                options={typeOptions}
                isReadOnly={true} // {isSupplier}
              />

              <Currency
                name="currencyCode"
                label="Currency"
                value={supplier.currencyCode}
                onChange={(newValue) => {
                  if (newValue?.value) {
                    setSupplier((prevSupplier) => ({
                      ...prevSupplier,
                      currencyCode: newValue.value,
                    }));
                  }
                }}
              />

              {isEditing && (
                <TextArea name="notes" label="Notes" readOnly={isSupplier} />
              )}
              <CustomFormFields table="purchaseOrder" />
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

export default PurchaseOrderForm;
