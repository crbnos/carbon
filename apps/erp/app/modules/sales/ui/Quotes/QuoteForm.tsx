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
      toast.error("Carbon client not found");
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
        toast.error("Error fetching customer data");
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
          <CardTitle>{isEditing ? "Quote" : "New Quote"}</CardTitle>
          {!isEditing && (
            <CardDescription>
              A quote is a set of prices for specific parts and quantities.
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
                  label="Quote ID"
                  table="quote"
                />
              )}
              <Customer
                autoFocus={!isEditing}
                name="customerId"
                label="Customer"
                isRequired
                onChange={(newValue) => {
                  if (newValue?.value) {
                    onCustomerChange(newValue);
                  }
                }}
              />
              <Input name="customerReference" label="Customer RFQ" />
              <CustomerContact
                name="customerContactId"
                label="Purchasing Contact"
                isOptional
                customer={customer.id}
                value={customer.customerContactId}
              />
              <CustomerContact
                name="customerEngineeringContactId"
                label="Engineering Contact"
                isOptional
                customer={customer.id}
              />
              <CustomerLocation
                name="customerLocationId"
                label="Customer Location"
                isOptional
                customer={customer.id}
                value={customer.customerLocationId}
              />
              <Employee name="salesPersonId" label="Sales Person" isOptional />
              <Employee name="estimatorId" label="Estimator" isOptional />
              <Location name="locationId" label="Quote Location" isRequired />
              <DatePicker
                name="dueDate"
                label="Due Date"
                isDisabled={isCustomer}
              />
              <DatePicker
                name="expirationDate"
                label="Expiration Date"
                isDisabled={isCustomer}
              />
              <Currency
                name="currencyCode"
                label="Currency"
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
            Save
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default QuoteForm;
