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
  DatePicker,
  Hidden,
  Input,
  Submit,
  Supplier,
  SupplierContact,
  SupplierLocation,
} from "~/components/Form";
import ExchangeRate from "~/components/Form/ExchangeRate";
import { usePermissions, useUser } from "~/hooks";
import { supplierQuoteValidator } from "~/modules/purchasing";
import { path } from "~/utils/path";

type SupplierQuoteFormValues = z.infer<typeof supplierQuoteValidator>;

type SupplierQuoteFormProps = {
  initialValues: SupplierQuoteFormValues;
};

const SupplierQuoteForm = ({ initialValues }: SupplierQuoteFormProps) => {
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [supplier, setSupplier] = useState<{
    id: string | undefined;
    currencyCode: string | undefined;
  }>({
    id: initialValues.supplierId,
    currencyCode: initialValues.currencyCode,
  });
  const isSupplier = permissions.is("supplier");
  const isDisabled = initialValues?.status !== "Draft";
  const isEditing = initialValues.id !== undefined;

  const exchangeRateFetcher = useFetcher<{ exchangeRate: number }>();

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
        validator={supplierQuoteValidator}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>
            {isEditing ? "Supplier Quote" : "New Supplier Quote"}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              A supplier quote is a set of prices for specific parts and
              quantities.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="supplierQuoteId" />
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
              <Input name="supplierReference" label="Supplier Ref. Number" />
              <SupplierLocation
                name="supplierLocationId"
                label="Supplier Location"
                isOptional
                supplier={supplier.id}
              />
              <SupplierContact
                name="supplierContactId"
                label="Supplier Contact"
                isOptional
                supplier={supplier.id}
              />
              <DatePicker
                name="dueDate"
                label="Due Date"
                isDisabled={isSupplier}
              />
              <DatePicker
                name="expirationDate"
                label="Expiration Date"
                isDisabled={isSupplier}
              />

              <Currency
                name="currencyCode"
                label="Currency"
                value={supplier.currencyCode}
                onChange={(
                  newValue: {
                    value: string | undefined;
                    label: string;
                  } | null
                ) => {
                  if (newValue?.value) {
                    setSupplier((prevSupplier) => ({
                      ...prevSupplier,
                      currencyCode: newValue.value,
                    }));
                  }
                }}
              />

              {isEditing &&
                !!supplier.currencyCode &&
                supplier.currencyCode !== company.baseCurrencyCode && (
                  <ExchangeRate
                    name="exchangeRate"
                    value={initialValues.exchangeRate ?? 1}
                    exchangeRateUpdatedAt={initialValues.exchangeRateUpdatedAt}
                    isReadOnly
                    onRefresh={() => {
                      const formData = new FormData();
                      formData.append(
                        "currencyCode",
                        supplier.currencyCode ?? ""
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

              <CustomFormFields table="supplierQuote" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isDisabled ||
              (isEditing
                ? !permissions.can("update", "purchasing")
                : !permissions.can("create", "purchasing"))
            }
          >
            Save
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default SupplierQuoteForm;
