import { useCarbon } from "@carbon/auth";
import { Select, ValidatedForm } from "@carbon/form";
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
  Hidden,
  Input,
  SequenceOrCustomId,
  Submit,
  Supplier,
  SupplierContact,
  SupplierLocation,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import {
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
    <Card>
      <ValidatedForm
        method="post"
        validator={purchaseOrderValidator}
        defaultValues={initialValues}
        className="w-full"
      >
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
          {isEditing && <Hidden name="purchaseOrderId" />}
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
                  name="purchaseOrderId"
                  label="Purchase Order ID"
                  table="purchaseOrder"
                />
              )}
              <Supplier
                autoFocus={!isEditing}
                name="supplierId"
                label="Supplier"
                onChange={onSupplierChange}
              />
              <Input name="supplierReference" label="Supplier Order Number" />
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
              <Select
                name="purchaseOrderType"
                label="Type"
                options={purchaseOrderTypeType.map((type) => ({
                  label: type,
                  value: type,
                }))}
              />
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
      </ValidatedForm>
    </Card>
  );
};

export default PurchaseOrderForm;
