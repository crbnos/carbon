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
import type { ReactNode } from "react";
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
import { isQuoteLocked, quoteValidator } from "../../sales.models";
import type { Quotation } from "../../types";

type QuoteFormValues = z.infer<typeof quoteValidator>;

type QuoteFormProps = {
  initialValues: QuoteFormValues;
};

const QuoteForm = ({ initialValues }: QuoteFormProps) => {
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
  const isCustomer = permissions.is("customer");
  const isEditing = initialValues.id !== undefined;

  const routeData = useRouteData<{
    quote: Quotation;
  }>(path.to.quote(initialValues.id ?? ""));

  const isLocked = isQuoteLocked(routeData?.quote?.status);
  const isDisabled = isEditing && isLocked;

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
        validator={quoteValidator}
        defaultValues={initialValues}
        isDisabled={isDisabled}
      >
        <CardHeader>
          <CardTitle>
            {isEditing ? <Trans>Quote</Trans> : <Trans>New Quote</Trans>}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              <Trans>
                A quote is a set of prices for specific parts and quantities.
              </Trans>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {isEditing && <Hidden name="quoteId" />}
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
                  name="quoteId"
                  label={t`Quote ID`}
                  table="quote"
                />
              )}
              <Customer
                autoFocus={!isEditing}
                name="customerId"
                label={t`Customer`}
                onChange={(newValue) => {
                  if (newValue?.value) {
                    onCustomerChange(newValue);
                  }
                }}
              />
              <Input name="customerReference" label={t`Customer RFQ`} />
              <CustomerContact
                name="customerContactId"
                label={t`Purchasing Contact`}
                isOptional
                customer={customer.id}
                value={customer.customerContactId}
              />
              <CustomerContact
                name="customerEngineeringContactId"
                label={t`Engineering Contact`}
                isOptional
                customer={customer.id}
              />
              <CustomerLocation
                name="customerLocationId"
                label={t`Customer Location`}
                isOptional
                customer={customer.id}
                value={customer.customerLocationId}
              />
              <Employee
                name="salesPersonId"
                label={t`Sales Person`}
                isOptional
              />
              <Employee name="estimatorId" label={t`Estimator`} isOptional />
              <Location name="locationId" label={t`Quote Location`} />
              <DatePicker
                name="dueDate"
                label={t`Due Date`}
                isDisabled={isCustomer}
              />
              <DatePicker
                name="expirationDate"
                label={t`Expiration Date`}
                isDisabled={isCustomer}
              />
              <Currency
                name="currencyCode"
                label={t`Currency`}
                value={customer.currencyCode}
                onChange={(
                  newValue: {
                    value: string | undefined;
                    label: string | ReactNode;
                  } | null
                ) => {
                  if (newValue?.value) {
                    setCustomer((prevCustomer) => ({
                      ...prevCustomer,
                      currencyCode: newValue.value
                    }));
                  }
                }}
              />
              {isEditing &&
                !!customer.currencyCode &&
                customer.currencyCode !== company.baseCurrencyCode && (
                  <ExchangeRate
                    name="exchangeRate"
                    value={initialValues.exchangeRate ?? 1}
                    exchangeRateUpdatedAt={initialValues.exchangeRateUpdatedAt}
                    isReadOnly
                    onRefresh={() => {
                      const formData = new FormData();
                      formData.append(
                        "currencyCode",
                        customer.currencyCode ?? ""
                      );
                      exchangeRateFetcher.submit(formData, {
                        method: "post",
                        action: path.to.quoteExchangeRate(
                          initialValues.id ?? ""
                        )
                      });
                    }}
                  />
                )}
              <CustomFormFields table="quote" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isDisabled ||
              (isEditing
                ? !permissions.can("update", "sales")
                : !permissions.can("create", "sales"))
            }
          >
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default QuoteForm;
