import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
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
  SupplierLocation
} from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import {
  isPurchaseReturnOrderLocked,
  purchaseReturnOrderValidator
} from "../../purchasing.models";

type PurchaseReturnOrderFormValues = z.infer<
  typeof purchaseReturnOrderValidator
>;

type PurchaseReturnOrderFormProps = {
  initialValues: PurchaseReturnOrderFormValues;
};

const PurchaseReturnOrderForm = ({
  initialValues
}: PurchaseReturnOrderFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const [supplier, setSupplier] = useState<{
    id: string | undefined;
    currencyCode: string | undefined;
    supplierContactId: string | undefined;
    supplierLocationId: string | undefined;
  }>({
    id: initialValues.supplierId,
    currencyCode: initialValues.currencyCode,
    supplierContactId: initialValues.supplierContactId,
    supplierLocationId: initialValues.supplierLocationId
  });
  const isEditing = initialValues.id !== undefined;

  const orderId = initialValues.id;
  const routeData = useRouteData<{ purchaseReturnOrder: { status: string } }>(
    orderId ? path.to.purchaseReturnOrder(orderId) : ""
  );
  const isLocked = isPurchaseReturnOrderLocked(
    routeData?.purchaseReturnOrder?.status
  );

  const onSupplierChange = async (
    newValue: {
      value: string | undefined;
    } | null
  ) => {
    if (!carbon) {
      toast.error(t`Carbon client not found`);
      return;
    }

    if (newValue?.value) {
      flushSync(() => {
        // update the supplier immediately
        setSupplier({
          id: newValue?.value,
          currencyCode: undefined,
          supplierContactId: undefined,
          supplierLocationId: undefined
        });
      });

      const { data, error } = await carbon
        ?.from("supplier")
        .select("currencyCode, purchasingContactId")
        .eq("id", newValue.value)
        .single();
      if (error) {
        toast.error(t`Error fetching supplier data`);
      } else {
        setSupplier((prev) => ({
          ...prev,
          currencyCode: data.currencyCode ?? undefined,
          supplierContactId: data.purchasingContactId ?? undefined
        }));
      }
    } else {
      setSupplier({
        id: undefined,
        currencyCode: undefined,
        supplierContactId: undefined,
        supplierLocationId: undefined
      });
    }
  };

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={purchaseReturnOrderValidator}
        defaultValues={initialValues}
        isDisabled={isEditing && isLocked}
      >
        <CardHeader>
          <CardTitle>
            {isEditing ? (
              <Trans>Supplier Return</Trans>
            ) : (
              <Trans>New Supplier Return</Trans>
            )}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              <Trans>
                A supplier return sends previously received goods back to the
                supplier for credit or replacement.
              </Trans>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {isEditing && <Hidden name="purchaseReturnOrderId" />}
          <Hidden name="status" />
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
                  name="purchaseReturnOrderId"
                  label={t`Return ID`}
                  table="purchaseReturnOrder"
                />
              )}
              <Supplier
                autoFocus={!isEditing}
                name="supplierId"
                label={t`Supplier`}
                onChange={onSupplierChange}
              />
              <Input
                name="supplierReference"
                label={t`Supplier RMA #`}
                helperText={t`The supplier's return authorization number`}
              />

              <SupplierContact
                name="supplierContactId"
                label={t`Supplier Contact`}
                supplier={supplier.id}
                value={supplier.supplierContactId}
              />
              <SupplierLocation
                name="supplierLocationId"
                label={t`Supplier Location`}
                supplier={supplier.id}
              />

              <DatePicker name="orderDate" label={t`Order Date`} />

              <DatePicker
                name="expirationDate"
                label={t`Expiration Date`}
                helperText={t`The date the return authorization expires`}
              />

              <Location
                name="locationId"
                label={t`Return Location`}
                helperText={t`The location the goods will be shipped from`}
              />

              <Currency
                name="currencyCode"
                label={t`Currency`}
                value={supplier.currencyCode}
                onChange={(newValue) => {
                  if (newValue?.value) {
                    setSupplier((prevSupplier) => ({
                      ...prevSupplier,
                      currencyCode: newValue.value
                    }));
                  }
                }}
              />

              <CustomFormFields table="purchaseReturnOrder" />
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
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default PurchaseReturnOrderForm;
