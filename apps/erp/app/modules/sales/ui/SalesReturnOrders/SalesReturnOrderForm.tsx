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
  Customer,
  CustomerContact,
  CustomerLocation,
  CustomFormFields,
  DatePicker,
  Hidden,
  Input,
  Location,
  SequenceOrCustomId,
  Submit
} from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import {
  isSalesReturnOrderLocked,
  salesReturnOrderValidator
} from "../../sales.models";

type SalesReturnOrderFormValues = z.infer<typeof salesReturnOrderValidator>;

type SalesReturnOrderFormProps = {
  initialValues: SalesReturnOrderFormValues;
};

const SalesReturnOrderForm = ({ initialValues }: SalesReturnOrderFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const [customer, setCustomer] = useState<{
    id: string | undefined;
    currencyCode: string | undefined;
    customerContactId: string | undefined;
    customerLocationId: string | undefined;
  }>({
    id: initialValues.customerId,
    currencyCode: initialValues.currencyCode,
    customerContactId: initialValues.customerContactId,
    customerLocationId: initialValues.customerLocationId
  });
  const isEditing = initialValues.id !== undefined;

  const orderId = initialValues.id;
  const routeData = useRouteData<{ salesReturnOrder: { status: string } }>(
    orderId ? path.to.salesReturnOrder(orderId) : ""
  );
  const isLocked = isSalesReturnOrderLocked(
    routeData?.salesReturnOrder?.status
  );

  const onCustomerChange = async (
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
        // update the customer immediately
        setCustomer({
          id: newValue?.value,
          currencyCode: undefined,
          customerContactId: undefined,
          customerLocationId: undefined
        });
      });

      const { data, error } = await carbon
        ?.from("customer")
        .select(
          "currencyCode, salesContactId, customerShipping!customerShipping_customerId_fkey(shippingCustomerLocationId)"
        )
        .eq("id", newValue.value)
        .single();
      if (error) {
        toast.error(t`Error fetching customer data`);
      } else {
        setCustomer((prev) => ({
          ...prev,
          currencyCode: data.currencyCode ?? undefined,
          customerContactId: data.salesContactId ?? undefined,
          customerLocationId:
            data.customerShipping?.[0]?.shippingCustomerLocationId ?? undefined
        }));
      }
    } else {
      setCustomer({
        id: undefined,
        currencyCode: undefined,
        customerContactId: undefined,
        customerLocationId: undefined
      });
    }
  };

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={salesReturnOrderValidator}
        defaultValues={initialValues}
        isDisabled={isEditing && isLocked}
      >
        <CardHeader>
          <CardTitle>
            {isEditing ? <Trans>RMA</Trans> : <Trans>New RMA</Trans>}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              <Trans>
                A return merchandise authorization (RMA) authorizes a customer
                to return goods for credit, replacement, or repair.
              </Trans>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {isEditing && <Hidden name="salesReturnOrderId" />}
          <Hidden name="status" />
          <Hidden name="salesOrderId" />
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
                  name="salesReturnOrderId"
                  label={t`RMA ID`}
                  table="salesReturnOrder"
                />
              )}
              <Customer
                autoFocus={!isEditing}
                name="customerId"
                label={t`Customer`}
                onChange={onCustomerChange}
              />
              <Input
                name="customerReference"
                label={t`Customer Reference`}
                termId="customer-document-reference"
              />

              <CustomerContact
                name="customerContactId"
                label={t`Customer Contact`}
                customer={customer.id}
                value={customer.customerContactId}
              />
              <CustomerLocation
                name="customerLocationId"
                label={t`Customer Location`}
                customer={customer.id}
                value={customer.customerLocationId}
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
                helperText={t`The location where the goods will be received`}
              />

              <Currency
                name="currencyCode"
                label={t`Currency`}
                value={customer.currencyCode}
                onChange={(newValue) => {
                  if (newValue?.value) {
                    setCustomer((prevCustomer) => ({
                      ...prevCustomer,
                      currencyCode: newValue.value
                    }));
                  }
                }}
              />

              <CustomFormFields table="salesReturnOrder" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isEditing
                ? !permissions.can("update", "sales")
                : !permissions.can("create", "sales")
            }
          >
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default SalesReturnOrderForm;
