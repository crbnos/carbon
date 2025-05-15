import type { Json } from "@carbon/database";
import { DatePicker, InputControlled, ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack,
  toast,
} from "@carbon/react";
import { useLocale } from "@react-aria/i18n";
import { useFetcher, useParams } from "@remix-run/react";
import { useCallback, useEffect, useMemo } from "react";
import { LuCopy, LuInfo, LuLink, LuRefreshCcw } from "react-icons/lu";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { Assignee, useOptimisticAssignment } from "~/components";
import {
  Currency,
  Customer,
  CustomerContact,
  CustomerLocation,
  Location,
  PaymentTerm,
} from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type { action as exchangeRateAction } from "~/routes/x+/sales-invoice+/$invoiceId.exchange-rate";
import type { action } from "~/routes/x+/sales-invoice+/update";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import type { SalesInvoice } from "../../types";

const SalesInvoiceProperties = () => {
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("invoiceId not found");

  const routeData = useRouteData<{
    salesInvoice: SalesInvoice;
  }>(path.to.salesInvoice(invoiceId));

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  const { company } = useUser();
  const exchangeRateFetcher = useFetcher<typeof exchangeRateAction>();
  const { locale } = useLocale();
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale]
  );

  const onUpdate = useCallback(
    (field: keyof SalesInvoice, value: string | null) => {
      if (value === routeData?.salesInvoice[field]) {
        return;
      }
      const formData = new FormData();

      formData.append("ids", invoiceId);
      formData.append("field", field);
      formData.append("value", value ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateSalesInvoice,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoiceId, routeData?.salesInvoice]
  );

  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", invoiceId);
      formData.append("table", "salesInvoice");
      formData.append("value", value);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoiceId]
  );

  const permissions = usePermissions();
  const optimisticAssignment = useOptimisticAssignment({
    id: invoiceId,
    table: "salesInvoice",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.salesInvoice?.assignee;

  const isDisabled =
    !permissions.can("update", "invoicing") ||
    !["Draft", "To Review", "Overdue"].includes(
      routeData?.salesInvoice?.status ?? ""
    );

  return (
    <VStack
      spacing={4}
      className="w-96 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      <VStack spacing={4}>
        <HStack className="w-full justify-between">
          <h3 className="text-xs text-muted-foreground">Properties</h3>
          <HStack spacing={1}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Link"
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    copyToClipboard(
                      window.location.origin +
                        path.to.salesInvoiceDetails(invoiceId)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to Sales Invoice</span>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Copy"
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    copyToClipboard(routeData?.salesInvoice?.invoiceId ?? "")
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy Sales Invoice number</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm">{routeData?.salesInvoice?.invoiceId}</span>
      </VStack>

      <Assignee
        id={invoiceId}
        table="salesInvoice"
        value={assignee ?? ""}
        variant="inline"
        isReadOnly={!permissions.can("update", "invoicing")}
      />

      <ValidatedForm
        defaultValues={{ customerId: routeData?.salesInvoice?.customerId }}
        validator={z.object({
          customerId: z.string().min(1, { message: "Customer is required" }),
        })}
        className="w-full"
      >
        <Customer
          name="customerId"
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("customerId", value.value);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          customerReference:
            routeData?.salesInvoice?.customerReference ?? undefined,
        }}
        validator={z.object({
          customerReference: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <InputControlled
          name="customerReference"
          label="Customer PO"
          value={routeData?.salesInvoice?.customerReference ?? ""}
          size="sm"
          inline
          isReadOnly={isDisabled}
          onBlur={(e) => {
            onUpdate("customerReference", e.target.value);
          }}
        />
      </ValidatedForm>
      <ValidatedForm
        defaultValues={{
          invoiceCustomerId: routeData?.salesInvoice?.invoiceCustomerId,
        }}
        validator={z.object({
          invoiceCustomerId: z
            .string()
            .min(1, { message: "Customer is required" }),
        })}
        className="w-full"
      >
        <Customer
          name="invoiceCustomerId"
          label="Invoice Customer"
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("invoiceCustomerId", value.value);
            }
          }}
        />
      </ValidatedForm>
      <ValidatedForm
        defaultValues={{
          invoiceCustomerLocationId:
            routeData?.salesInvoice?.invoiceCustomerLocationId ?? "",
        }}
        validator={z.object({
          invoiceCustomerLocationId: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <CustomerLocation
          name="invoiceCustomerLocationId"
          label="Invoice Customer Location"
          customer={routeData?.salesInvoice?.invoiceCustomerId ?? ""}
          inline
          isReadOnly={isDisabled}
          onChange={(customerLocation) => {
            if (customerLocation?.id) {
              onUpdate("invoiceCustomerLocationId", customerLocation.id);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          invoiceCustomerContactId:
            routeData?.salesInvoice?.invoiceCustomerContactId ?? "",
        }}
        validator={z.object({
          invoiceCustomerContactId: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <CustomerContact
          name="invoiceCustomerContactId"
          label="Invoice Customer Contact"
          customer={routeData?.salesInvoice?.invoiceCustomerId ?? ""}
          inline
          isReadOnly={isDisabled}
          onChange={(customerContact) => {
            if (customerContact?.id) {
              onUpdate("invoiceCustomerContactId", customerContact.id);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          dateIssued: routeData?.salesInvoice?.dateIssued ?? "",
        }}
        validator={z.object({
          dateIssued: z
            .string()
            .min(1, { message: "Invoice date is required" }),
        })}
        className="w-full"
      >
        <DatePicker
          name="dateIssued"
          label="Date Issued"
          inline
          isDisabled={isDisabled}
          onChange={(date) => {
            onUpdate("dateIssued", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          dateDue: routeData?.salesInvoice?.dateDue ?? "",
        }}
        validator={z.object({
          dateDue: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <DatePicker
          name="dateDue"
          label="Date Due"
          inline
          isDisabled={isDisabled}
          onChange={(date) => {
            onUpdate("dateDue", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          datePaid: routeData?.salesInvoice?.datePaid ?? "",
        }}
        validator={z.object({
          datePaid: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <DatePicker
          name="datePaid"
          label="Date Paid"
          inline
          onChange={(date) => {
            onUpdate("datePaid", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{ locationId: routeData?.salesInvoice?.locationId }}
        validator={z.object({
          locationId: z.string().min(1, { message: "Location is required" }),
        })}
        className="w-full"
      >
        <Location
          label="Location"
          name="locationId"
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("locationId", value.value);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          paymentTermId: routeData?.salesInvoice?.paymentTermId,
        }}
        validator={z.object({
          paymentTermId: z
            .string()
            .min(1, { message: "Payment term is required" }),
        })}
        className="w-full"
      >
        <PaymentTerm
          label="Payment Term"
          name="paymentTermId"
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("paymentTermId", value.value);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          currencyCode: routeData?.salesInvoice?.currencyCode ?? undefined,
        }}
        validator={z.object({
          currencyCode: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <Currency
          name="currencyCode"
          label="Currency"
          inline
          value={routeData?.salesInvoice?.currencyCode ?? ""}
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("currencyCode", value.value);
            }
          }}
        />
      </ValidatedForm>

      {routeData?.salesInvoice?.currencyCode &&
        routeData?.salesInvoice?.currencyCode !== company.baseCurrencyCode && (
          <VStack spacing={2}>
            <HStack spacing={1}>
              <span className="text-xs text-muted-foreground">
                Exchange Rate
              </span>
              {routeData?.salesInvoice?.exchangeRateUpdatedAt && (
                <Tooltip>
                  <TooltipTrigger tabIndex={-1}>
                    <LuInfo className="w-4 h-4" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Last updated:{" "}
                    {formatter.format(
                      new Date(
                        routeData?.salesInvoice?.exchangeRateUpdatedAt ?? ""
                      )
                    )}
                  </TooltipContent>
                </Tooltip>
              )}
            </HStack>
            <HStack className="w-full justify-between">
              <span>{routeData?.salesInvoice?.exchangeRate}</span>
              <IconButton
                size="sm"
                variant="secondary"
                aria-label="Refresh"
                icon={<LuRefreshCcw />}
                isDisabled={isDisabled}
                onClick={() => {
                  const formData = new FormData();
                  formData.append(
                    "currencyCode",
                    routeData?.salesInvoice?.currencyCode ?? ""
                  );
                  exchangeRateFetcher.submit(formData, {
                    method: "post",
                    action: path.to.salesInvoiceExchangeRate(invoiceId),
                  });
                }}
              />
            </HStack>
          </VStack>
        )}
      <CustomFormInlineFields
        customFields={
          (routeData?.salesInvoice?.customFields ?? {}) as Record<string, Json>
        }
        table="salesInvoice"
        tags={[]}
        onUpdate={onUpdateCustomFields}
        isDisabled={isDisabled}
      />
    </VStack>
  );
};

export default SalesInvoiceProperties;
