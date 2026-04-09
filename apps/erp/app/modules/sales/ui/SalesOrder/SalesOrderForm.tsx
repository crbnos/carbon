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
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Currency,
  Customer,
  CustomerContact,
  CustomerLocation,
  CustomFormFields,
  DatePicker,
  Employee,
  Hidden,
  Input,
  Location,
  SequenceOrCustomId,
  Submit
} from "~/components/Form";
import ExchangeRate from "~/components/Form/ExchangeRate";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { isSalesOrderLocked, salesOrderValidator } from "../../sales.models";

type SalesOrderFormValues = z.infer<typeof salesOrderValidator>;

type SalesOrderFormProps = {
  initialValues: SalesOrderFormValues & {
    originatedFromQuote: boolean;
    digitalQuoteAcceptedBy: string | undefined;
    digitalQuoteAcceptedByEmail: string | undefined;
  };
};

const SalesOrderForm = ({ initialValues }: SalesOrderFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const { company } = useUser();
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
  const isCustomer = permissions.is("customer");

  const orderId = initialValues.id;
  const routeData = useRouteData<{ salesOrder: { status: string } }>(
    orderId ? path.to.salesOrder(orderId) : ""
  );
  const isLocked = isSalesOrderLocked(routeData?.salesOrder?.status);

  const exchangeRateFetcher = useFetcher<{ exchangeRate: number }>();

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
          "currencyCode, salesContactId, customerShipping!customerId(shippingCustomerLocationId)"
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
            data.customerShipping?.shippingCustomerLocationId ?? undefined
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
        validator={salesOrderValidator}
        defaultValues={initialValues}
        isDisabled={isEditing && isLocked}
      >
        <CardHeader>
          <CardTitle>
            {isEditing ? (
              <Trans>Sales Order</Trans>
            ) : (
              <Trans>New Sales Order</Trans>
            )}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              <Trans>
                A sales order contains information about the agreement between
                the company and a specific customer for parts and services.
              </Trans>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {isEditing && <Hidden name="salesOrderId" />}
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
                  name="salesOrderId"
                  label={t`Sales Order ID`}
                  table="salesOrder"
                />
              )}
              <Customer
                autoFocus={!isEditing}
                name="customerId"
                label={t`Customer`}
                onChange={onCustomerChange}
              />
              <Input name="customerReference" label={t`Customer PO Number`} />

              <CustomerContact
                name="customerContactId"
                label={t`Purchasing Contact`}
                customer={customer.id}
                value={customer.customerContactId}
              />
              <CustomerContact
                name="customerEngineeringContactId"
                label={t`Engineering Contact`}
                customer={customer.id}
              />
              <CustomerLocation
                name="customerLocationId"
                label={t`Customer Location`}
                customer={customer.id}
                value={customer.customerLocationId}
              />

              {initialValues.originatedFromQuote &&
                initialValues.digitalQuoteAcceptedBy &&
                initialValues.digitalQuoteAcceptedByEmail && (
                  <>
                    <Input
                      name="digitalQuoteAcceptedBy"
                      label={t`Quote Accepted By`}
                      isDisabled
                    />
                    <Input
                      name="digitalQuoteAcceptedByEmail"
                      label={t`Quote Accepted By Email`}
                      isDisabled
                    />
                  </>
                )}

              <DatePicker
                name="requestedDate"
                label={t`Requested Date`}
                helperText={t`The date the customer expects to receive the goods`}
                isDisabled={isCustomer}
              />

              <DatePicker
                name="promisedDate"
                label={t`Promised Date`}
                helperText={t`The date the customer expects to receive the goods`}
                isDisabled={isCustomer}
              />

              <Location name="locationId" label={t`Sales Location`} />

              <Employee name="salesPersonId" label={t`Sales Person`} />

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
                disabled={initialValues.originatedFromQuote}
              />

              {isEditing &&
                !!customer.currencyCode &&
                customer.currencyCode !== company.baseCurrencyCode && (
                  <ExchangeRate
                    name="exchangeRate"
                    value={initialValues.exchangeRate ?? 1}
                    exchangeRateUpdatedAt={initialValues.exchangeRateUpdatedAt}
                    isReadOnly
                    onRefresh={
                      !initialValues.originatedFromQuote
                        ? () => {
                            const formData = new FormData();
                            formData.append(
                              "currencyCode",
                              customer.currencyCode ?? ""
                            );
                            exchangeRateFetcher.submit(formData, {
                              method: "post",
                              action: path.to.salesOrderExchangeRate(
                                initialValues.id ?? ""
                              )
                            });
                          }
                        : undefined
                    }
                  />
                )}

              <CustomFormFields table="salesOrder" />
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

export default SalesOrderForm;
