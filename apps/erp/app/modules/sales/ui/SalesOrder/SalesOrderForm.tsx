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
  SequenceOrCustomId,
  Submit,
} from "~/components/Form";
import ExchangeRate from "~/components/Form/ExchangeRate";
import { usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { salesOrderValidator } from "../../sales.models";

type SalesOrderFormValues = z.infer<typeof salesOrderValidator>;

type SalesOrderFormProps = {
  initialValues: SalesOrderFormValues & {
    originatedFromQuote: boolean;
    digitalQuoteAcceptedBy: string | undefined;
    digitalQuoteAcceptedByEmail: string | undefined;
  };
};

const SalesOrderForm = ({ initialValues }: SalesOrderFormProps) => {
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
  const isEditing = initialValues.id !== undefined;
  const isCustomer = permissions.is("customer");

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
        validator={salesOrderValidator}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>{isEditing ? "Sales Order" : "New Sales Order"}</CardTitle>
          {!isEditing && (
            <CardDescription>
              A sales order contains information about the agreement between the
              company and a specific customer for parts and services.
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
                  label="Sales Order ID"
                  table="salesOrder"
                />
              )}
              <Customer
                autoFocus={!isEditing}
                name="customerId"
                label="Customer"
                onChange={onCustomerChange}
              />
              <Input name="customerReference" label="Customer PO Number" />

              <CustomerContact
                name="customerContactId"
                label="Purchasing Contact"
                customer={customer.id}
              />
              <CustomerContact
                name="customerEngineeringContactId"
                label="Engineering Contact"
                customer={customer.id}
              />
              <CustomerLocation
                name="customerLocationId"
                label="Customer Location"
                customer={customer.id}
              />

              {initialValues.originatedFromQuote &&
                initialValues.digitalQuoteAcceptedBy &&
                initialValues.digitalQuoteAcceptedByEmail && (
                  <>
                    <Input
                      name="digitalQuoteAcceptedBy"
                      label="Quote Accepted By"
                      isDisabled
                    />
                    <Input
                      name="digitalQuoteAcceptedByEmail"
                      label="Quote Accepted By Email"
                      isDisabled
                    />
                  </>
                )}

              <DatePicker
                name="orderDate"
                label="Order Date"
                helperText="This is typically the date the purchase order was  received from the customer"
                isDisabled={isCustomer}
              />

              <Location name="locationId" label="Sales Location" />

              <Employee name="salesPersonId" label="Sales Person" />

              <Currency
                name="currencyCode"
                label="Currency"
                value={customer.currencyCode}
                onChange={(newValue) => {
                  if (newValue?.value) {
                    setCustomer((prevCustomer) => ({
                      ...prevCustomer,
                      currencyCode: newValue.value,
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
                              ),
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
            Save
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default SalesOrderForm;
