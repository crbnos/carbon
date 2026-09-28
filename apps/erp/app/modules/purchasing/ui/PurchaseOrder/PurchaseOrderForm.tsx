import { useCarbon } from "@carbon/auth";
import { Select, ValidatedForm } from "@carbon/form";
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
import { useParams } from "react-router";
import type { z } from "zod";
import {
  Currency,
  CustomFormFields,
  Hidden,
  Input,
  Location,
  SequenceOrCustomId,
  Submit,
  Supplier,
  SupplierContact,
  SupplierLocation
} from "~/components/Form";
import {
  usePermissions,
  useRouteData,
  useSupplierApprovalRequired
} from "~/hooks";
import {
  purchaseOrderTypeType,
  purchaseOrderValidator
} from "~/modules/purchasing";
import { path } from "~/utils/path";
import { isPurchaseOrderLocked } from "../../purchasing.models";

type PurchaseOrderFormValues = z.infer<typeof purchaseOrderValidator>;

type PurchaseOrderFormProps = {
  initialValues: PurchaseOrderFormValues;
};

const PurchaseOrderForm = ({ initialValues }: PurchaseOrderFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const supplierApprovalRequired = useSupplierApprovalRequired();
  const { carbon } = useCarbon();
  const [supplier, setSupplier] = useState<{
    id: string | undefined;
    currencyCode: string | undefined;
    supplierContactId: string | undefined;
  }>({
    id: initialValues.supplierId,
    currencyCode: initialValues.currencyCode,
    supplierContactId: initialValues.supplierContactId
  });
  const isEditing = initialValues.id !== undefined;

  const { orderId } = useParams();
  const routeData = useRouteData<{ purchaseOrder: { status: string } }>(
    orderId ? path.to.purchaseOrder(orderId) : ""
  );
  const isLocked = isPurchaseOrderLocked(routeData?.purchaseOrder?.status);

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
          supplierContactId: undefined
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
        supplierContactId: undefined
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
        isDisabled={isEditing && isLocked}
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
                  label={t`Purchase Order ID`}
                  table="purchaseOrder"
                />
              )}
              <Supplier
                autoFocus={!isEditing}
                name="supplierId"
                label={t`Supplier`}
                onChange={onSupplierChange}
                onlyApproved={supplierApprovalRequired}
              />
              <Input
                name="supplierReference"
                label={t`Supplier Order Number`}
                termId="purchase-order-supplier-order-number"
              />
              <SupplierLocation
                name="supplierLocationId"
                label={t`Supplier Location`}
                supplier={supplier.id}
              />
              <SupplierContact
                name="supplierContactId"
                label={t`Supplier Contact`}
                supplier={supplier.id}
                value={supplier.supplierContactId}
              />

              <Location
                name="locationId"
                label={t`Delivery Location`}
                termId="purchase-order-delivery-location"
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
              <Select
                name="purchaseOrderType"
                label={t`Type`}
                termId="purchase-order-type"
                options={purchaseOrderTypeType.map((type) => ({
                  label: type,
                  value: type
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
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default PurchaseOrderForm;
