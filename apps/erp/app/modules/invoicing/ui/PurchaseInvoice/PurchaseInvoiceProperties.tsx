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
  Location,
  PaymentTerm,
  Supplier,
  SupplierContact,
  SupplierLocation,
} from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type { action as exchangeRateAction } from "~/routes/x+/purchase-invoice+/$invoiceId.exchange-rate";
import type { action } from "~/routes/x+/purchase-invoice+/update";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import type { PurchaseInvoice } from "../../types";

const PurchaseInvoiceProperties = () => {
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("invoiceId not found");

  const routeData = useRouteData<{
    purchaseInvoice: PurchaseInvoice;
  }>(path.to.purchaseInvoice(invoiceId));

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
    (field: keyof PurchaseInvoice, value: string | null) => {
      if (value === routeData?.purchaseInvoice[field]) {
        return;
      }
      const formData = new FormData();

      formData.append("ids", invoiceId);
      formData.append("field", field);
      formData.append("value", value ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdatePurchaseInvoice,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoiceId, routeData?.purchaseInvoice]
  );

  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", invoiceId);
      formData.append("table", "purchaseInvoice");
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
    table: "purchaseInvoice",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.purchaseInvoice?.assignee;

  const isDisabled =
    !permissions.can("update", "invoicing") ||
    !["Draft", "To Review", "Overdue"].includes(
      routeData?.purchaseInvoice?.status ?? ""
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
                        path.to.purchaseInvoiceDetails(invoiceId)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to Purchase Invoice</span>
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
                    copyToClipboard(routeData?.purchaseInvoice?.invoiceId ?? "")
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy Purchase Invoice number</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm">{routeData?.purchaseInvoice?.invoiceId}</span>
      </VStack>

      <Assignee
        id={invoiceId}
        table="purchaseInvoice"
        value={assignee ?? ""}
        variant="inline"
        isReadOnly={!permissions.can("update", "invoicing")}
      />

      <ValidatedForm
        defaultValues={{ supplierId: routeData?.purchaseInvoice?.supplierId }}
        validator={z.object({
          supplierId: z.string().min(1, { message: "Supplier is required" }),
        })}
        className="w-full"
      >
        <Supplier
          name="supplierId"
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("supplierId", value.value);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          supplierReference:
            routeData?.purchaseInvoice?.supplierReference ?? undefined,
        }}
        validator={z.object({
          supplierReference: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <InputControlled
          name="supplierReference"
          label="Supplier Ref. Number"
          value={routeData?.purchaseInvoice?.supplierReference ?? ""}
          size="sm"
          inline
          isReadOnly={isDisabled}
          onBlur={(e) => {
            onUpdate("supplierReference", e.target.value);
          }}
        />
      </ValidatedForm>
      <ValidatedForm
        defaultValues={{
          invoiceSupplierId: routeData?.purchaseInvoice?.invoiceSupplierId,
        }}
        validator={z.object({
          invoiceSupplierId: z
            .string()
            .min(1, { message: "Supplier is required" }),
        })}
        className="w-full"
      >
        <Supplier
          name="invoiceSupplierId"
          label="Invoice Supplier"
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("invoiceSupplierId", value.value);
            }
          }}
        />
      </ValidatedForm>
      <ValidatedForm
        defaultValues={{
          invoiceSupplierLocationId:
            routeData?.purchaseInvoice?.invoiceSupplierLocationId ?? "",
        }}
        validator={z.object({
          invoiceSupplierLocationId: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <SupplierLocation
          name="invoiceSupplierLocationId"
          label="Invoice Supplier Location"
          supplier={routeData?.purchaseInvoice?.invoiceSupplierId ?? ""}
          inline
          isReadOnly={isDisabled}
          onChange={(supplierLocation) => {
            if (supplierLocation?.id) {
              onUpdate("invoiceSupplierLocationId", supplierLocation.id);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          invoiceSupplierContactId:
            routeData?.purchaseInvoice?.invoiceSupplierContactId ?? "",
        }}
        validator={z.object({
          invoiceSupplierContactId: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <SupplierContact
          name="invoiceSupplierContactId"
          label="Invoice Supplier Contact"
          supplier={routeData?.purchaseInvoice?.invoiceSupplierId ?? ""}
          inline
          isReadOnly={isDisabled}
          onChange={(supplierContact) => {
            if (supplierContact?.id) {
              onUpdate("invoiceSupplierContactId", supplierContact.id);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          dateIssued: routeData?.purchaseInvoice?.dateIssued ?? "",
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
          dateDue: routeData?.purchaseInvoice?.dateDue ?? "",
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
          datePaid: routeData?.purchaseInvoice?.datePaid ?? "",
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
        defaultValues={{ locationId: routeData?.purchaseInvoice?.locationId }}
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
          paymentTermId: routeData?.purchaseInvoice?.paymentTermId,
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
          currencyCode: routeData?.purchaseInvoice?.currencyCode ?? undefined,
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
          value={routeData?.purchaseInvoice?.currencyCode ?? ""}
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("currencyCode", value.value);
            }
          }}
        />
      </ValidatedForm>

      {routeData?.purchaseInvoice?.currencyCode &&
        routeData?.purchaseInvoice?.currencyCode !==
          company.baseCurrencyCode && (
          <VStack spacing={2}>
            <HStack spacing={1}>
              <span className="text-xs text-muted-foreground">
                Exchange Rate
              </span>
              {routeData?.purchaseInvoice?.exchangeRateUpdatedAt && (
                <Tooltip>
                  <TooltipTrigger tabIndex={-1}>
                    <LuInfo className="w-4 h-4" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Last updated:{" "}
                    {formatter.format(
                      new Date(
                        routeData?.purchaseInvoice?.exchangeRateUpdatedAt ?? ""
                      )
                    )}
                  </TooltipContent>
                </Tooltip>
              )}
            </HStack>
            <HStack className="w-full justify-between">
              <span>{routeData?.purchaseInvoice?.exchangeRate}</span>
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
                    routeData?.purchaseInvoice?.currencyCode ?? ""
                  );
                  exchangeRateFetcher.submit(formData, {
                    method: "post",
                    action: path.to.purchaseInvoiceExchangeRate(invoiceId),
                  });
                }}
              />
            </HStack>
          </VStack>
        )}
      <CustomFormInlineFields
        customFields={
          (routeData?.purchaseInvoice?.customFields ?? {}) as Record<
            string,
            Json
          >
        }
        table="purchaseInvoice"
        tags={[]}
        onUpdate={onUpdateCustomFields}
        isDisabled={isDisabled}
      />
    </VStack>
  );
};

export default PurchaseInvoiceProperties;
