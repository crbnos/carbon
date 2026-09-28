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
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useState } from "react";
import { flushSync } from "react-dom";
import { useFetcher, useParams } from "react-router";
import type { z } from "zod";
import {
  Currency,
  CustomFormFields,
  DatePicker,
  Hidden,
  Input,
  SequenceOrCustomId,
  Submit,
  Supplier,
  SupplierContact,
  SupplierLocation
} from "~/components/Form";
import ExchangeRate from "~/components/Form/ExchangeRate";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import {
  isSupplierQuoteLocked,
  purchaseOrderTypeType,
  supplierQuoteValidator
} from "../../purchasing.models";
import type { SupplierQuote } from "../../types";

type SupplierQuoteFormValues = z.infer<typeof supplierQuoteValidator>;

type SupplierQuoteFormProps = {
  initialValues: SupplierQuoteFormValues;
};

const SupplierQuoteForm = ({ initialValues }: SupplierQuoteFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [supplier, setSupplier] = useState<{
    id: string | undefined;
    currencyCode: string | undefined;
    supplierContactId: string | undefined;
  }>({
    id: initialValues.supplierId,
    currencyCode: initialValues.currencyCode,
    supplierContactId: initialValues.supplierContactId
  });

  const { id } = useParams();
  const routeData = useRouteData<{
    quote: SupplierQuote;
  }>(path.to.supplierQuote(id ?? ""));

  const isLocked = isSupplierQuoteLocked(routeData?.quote?.status);
  const isEditing = initialValues.id !== undefined;

  const exchangeRateFetcher = useFetcher<{ exchangeRate: number }>();

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
        validator={supplierQuoteValidator}
        defaultValues={initialValues}
        isDisabled={isEditing && isLocked}
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
          {isEditing && <Hidden name="supplierQuoteId" />}
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
                  name="supplierQuoteId"
                  label={t`Supplier Quote ID`}
                  table="supplierQuote"
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
                label={t`Supplier Ref. Number`}
                termId="supplier-quote-ref-number"
              />

              <SupplierLocation
                name="supplierLocationId"
                label={t`Supplier Location`}
                isOptional
                supplier={supplier.id}
              />
              <SupplierContact
                name="supplierContactId"
                label={t`Supplier Contact`}
                isOptional
                supplier={supplier.id}
                value={supplier.supplierContactId}
              />
              <DatePicker name="quotedDate" label={t`Quoted Date`} />
              <DatePicker
                name="expirationDate"
                label={t`Expiration Date`}
                termId="supplier-quote-expiration-date"
                minValue={today(getLocalTimeZone())}
              />

              <Currency
                name="currencyCode"
                label={t`Currency`}
                value={supplier.currencyCode}
                onChange={(
                  newValue: {
                    value: string | undefined;
                    label: ReactNode;
                  } | null
                ) => {
                  if (newValue?.value) {
                    setSupplier((prevSupplier) => ({
                      ...prevSupplier,
                      currencyCode: newValue.value
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
                        )
                      });
                    }}
                  />
                )}
              <Select
                name="supplierQuoteType"
                label={t`Type`}
                termId="supplier-quote-type"
                options={purchaseOrderTypeType.map((type) => ({
                  label: type,
                  value: type
                }))}
              />
              <CustomFormFields table="supplierQuote" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              (isEditing && isLocked) ||
              (isEditing
                ? !permissions.can("update", "purchasing")
                : !permissions.can("create", "purchasing"))
            }
          >
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default SupplierQuoteForm;
