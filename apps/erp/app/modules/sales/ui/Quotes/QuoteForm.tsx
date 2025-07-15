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
import { useFetcher } from "@remix-run/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { flushSync } from "react-dom";
import type { z } from "zod";
import {
  Currency,
  CustomFormFields,
  Customer,
  CustomerContact,
  CustomerLocation,
  DatePicker,
  Employee,
  Hidden,
  Input,
  Location,
  Submit,
} from "~/components/Form";
import ExchangeRate from "~/components/Form/ExchangeRate";
import { usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { quoteValidator } from "../../sales.models";

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
  }>({
    id: initialValues.customerId,
    currencyCode: initialValues.currencyCode,
  });
  const isCustomer = permissions.is("customer");
  const isDisabled = initialValues?.status !== "Draft";
  const isEditing = initialValues.id !== undefined;

  const exchangeRateFetcher = useFetcher<{ exchangeRate: number }>();

  const onCustomerChange = async (
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
        // update the customer immediately
        setCustomer({
          id: newValue?.value,
          currencyCode: undefined,
        });
      });

      const { data, error } = await carbon
        ?.from("customer")
        .select("currencyCode")
        .eq("id", newValue.value)
        .single();
      if (error) {
        toast.error("Error fetching customer data");
      } else {
        setCustomer((prev) => ({
          ...prev,
          currencyCode: data.currencyCode ?? undefined,
        }));
      }
    } else {
      setCustomer({
        id: undefined,
        currencyCode: undefined,
      });
    }
  };

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={quoteValidator}
        defaultValues={initialValues}
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
          <Hidden name="quoteId" />
          <VStack>
            <div
              className={cn(
                "grid w-full gap-x-8 gap-y-4",
                isEditing
                  ? "grid-cols-1 lg:grid-cols-3"
                  : "grid-cols-1 md:grid-cols-2"
              )}
            >
              <Customer
                autoFocus={!isEditing}
                name="customerId"
                label="Customer"
                onChange={onCustomerChange}
              />
              <Input name="customerReference" label="Customer RFQ" />
              <CustomerContact
                name="customerContactId"
                label="Purchasing Contact"
                isOptional
                customer={customer.id}
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
              />
              <Employee name="salesPersonId" label="Sales Person" isOptional />
              <Employee name="estimatorId" label="Estimator" isOptional />
              <Location name="locationId" label="Quote Location" />

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
                      currencyCode: newValue.value,
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
                        ),
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
