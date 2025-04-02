import type { Json } from "@carbon/database";
import { DatePicker, InputControlled, ValidatedForm } from "@carbon/form";
import {
  Badge,
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
import { Link, useFetcher, useParams } from "@remix-run/react";
import { useCallback, useEffect, useMemo } from "react";
import {
  LuCopy,
  LuExternalLink,
  LuHardHat,
  LuInfo,
  LuLink,
  LuRefreshCcw,
} from "react-icons/lu";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { Assignee, Hyperlink, useOptimisticAssignment } from "~/components";
import {
  Currency,
  Location,
  Supplier,
  SupplierContact,
  SupplierLocation,
} from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type { action } from "~/routes/x+/items+/update";
import type { action as exchangeRateAction } from "~/routes/x+/purchase-order+/$orderId.exchange-rate";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import type { PurchaseOrder, SupplierQuote } from "../../types";

const PurchaseOrderProperties = () => {
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  const routeData = useRouteData<{
    purchaseOrder: PurchaseOrder;
    supplierQuote: SupplierQuote;
  }>(path.to.purchaseOrder(orderId));

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
    (field: keyof PurchaseOrder, value: string | null) => {
      if (value === routeData?.purchaseOrder[field]) {
        return;
      }
      const formData = new FormData();

      formData.append("ids", orderId);
      formData.append("field", field);
      formData.append("value", value ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdatePurchaseOrder,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderId, routeData?.purchaseOrder]
  );

  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", orderId);
      formData.append("table", "purchaseOrder");
      formData.append("value", value);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderId]
  );

  const permissions = usePermissions();
  const optimisticAssignment = useOptimisticAssignment({
    id: orderId,
    table: "purchaseOrder",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.purchaseOrder?.assignee;

  const isDisabled =
    !permissions.can("update", "purchasing") ||
    !["Draft", "To Review"].includes(routeData?.purchaseOrder?.status ?? "");

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
                        path.to.purchaseOrderDetails(orderId)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to Purchase Order</span>
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
                    copyToClipboard(
                      routeData?.purchaseOrder?.purchaseOrderId ?? ""
                    )
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy Purchase Order number</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm">
          {routeData?.purchaseOrder?.purchaseOrderId}
        </span>
      </VStack>

      {routeData?.purchaseOrder?.jobId && (
        <VStack spacing={2}>
          <span className="text-xs text-muted-foreground">Job</span>

          <Hyperlink to={path.to.jobDetails(routeData?.purchaseOrder?.jobId)}>
            <Badge variant="secondary">
              <LuHardHat className="w-3 h-3 mr-1" />
              {routeData?.purchaseOrder?.jobReadableId ?? "Job"}
            </Badge>
          </Hyperlink>
        </VStack>
      )}

      <Assignee
        id={orderId}
        table="purchaseOrder"
        value={assignee ?? ""}
        variant="inline"
        isReadOnly={!permissions.can("update", "purchasing")}
      />

      <ValidatedForm
        defaultValues={{ supplierId: routeData?.purchaseOrder?.supplierId }}
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

      {routeData?.supplierQuote && (
        <VStack spacing={2}>
          <span className="text-xs text-muted-foreground">Supplier Quote</span>

          <Link
            className="flex items-center justify-start gap-2"
            to={path.to.supplierQuote(routeData?.supplierQuote.id!)}
            target="_blank"
          >
            {routeData?.supplierQuote.supplierQuoteId}
            <LuExternalLink />
          </Link>
        </VStack>
      )}

      <ValidatedForm
        defaultValues={{
          supplierReference:
            routeData?.purchaseOrder?.supplierReference ?? undefined,
        }}
        validator={z.object({
          supplierReference: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <InputControlled
          name="supplierReference"
          label="Supplier Ref. Number"
          value={routeData?.purchaseOrder?.supplierReference ?? ""}
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
          supplierLocationId:
            routeData?.purchaseOrder?.supplierLocationId ?? "",
        }}
        validator={z.object({
          supplierLocationId: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <SupplierLocation
          name="supplierLocationId"
          supplier={routeData?.purchaseOrder?.supplierId ?? ""}
          inline
          isReadOnly={isDisabled}
          onChange={(supplierLocation) => {
            if (supplierLocation?.id) {
              onUpdate("supplierLocationId", supplierLocation.id);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          supplierContactId: routeData?.purchaseOrder?.supplierContactId ?? "",
        }}
        validator={z.object({
          supplierContactId: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <SupplierContact
          name="supplierContactId"
          supplier={routeData?.purchaseOrder?.supplierId ?? ""}
          inline
          isReadOnly={isDisabled}
          onChange={(supplierContact) => {
            if (supplierContact?.id) {
              onUpdate("supplierContactId", supplierContact.id);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          orderDate: routeData?.purchaseOrder?.orderDate ?? "",
        }}
        validator={z.object({
          orderDate: z.string().min(1, { message: "Order date is required" }),
        })}
        className="w-full"
      >
        <DatePicker
          name="orderDate"
          label="Order Date"
          inline
          isDisabled={isDisabled}
          onChange={(date) => {
            onUpdate("orderDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          receiptPromisedDate:
            routeData?.purchaseOrder?.receiptPromisedDate ?? "",
        }}
        validator={z.object({
          receiptPromisedDate: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <DatePicker
          name="receiptPromisedDate"
          label="Receipt Promised Date"
          inline
          onChange={(date) => {
            onUpdate("receiptPromisedDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          deliveryDate: routeData?.purchaseOrder?.deliveryDate ?? "",
        }}
        validator={z.object({
          deliveryDate: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <DatePicker
          name="deliveryDate"
          label="Delivery Date"
          inline
          onChange={(date) => {
            onUpdate("deliveryDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{ locationId: routeData?.purchaseOrder?.locationId }}
        validator={z.object({
          locationId: z.string().min(1, { message: "Location is required" }),
        })}
        className="w-full"
      >
        <Location
          label="Purchase Order Location"
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
          currencyCode: routeData?.purchaseOrder?.currencyCode ?? undefined,
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
          value={routeData?.purchaseOrder?.currencyCode ?? ""}
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("currencyCode", value.value);
            }
          }}
        />
      </ValidatedForm>

      {routeData?.purchaseOrder?.currencyCode &&
        routeData?.purchaseOrder?.currencyCode !== company.baseCurrencyCode && (
          <VStack spacing={2}>
            <HStack spacing={1}>
              <span className="text-xs text-muted-foreground">
                Exchange Rate
              </span>
              {routeData?.purchaseOrder?.exchangeRateUpdatedAt && (
                <Tooltip>
                  <TooltipTrigger tabIndex={-1}>
                    <LuInfo className="w-4 h-4" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Last updated:{" "}
                    {formatter.format(
                      new Date(
                        routeData?.purchaseOrder?.exchangeRateUpdatedAt ?? ""
                      )
                    )}
                  </TooltipContent>
                </Tooltip>
              )}
            </HStack>
            <HStack className="w-full justify-between">
              <span>{routeData?.purchaseOrder?.exchangeRate}</span>
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
                    routeData?.purchaseOrder?.currencyCode ?? ""
                  );
                  exchangeRateFetcher.submit(formData, {
                    method: "post",
                    action: path.to.purchaseOrderExchangeRate(orderId),
                  });
                }}
              />
            </HStack>
          </VStack>
        )}
      <CustomFormInlineFields
        customFields={
          (routeData?.purchaseOrder?.customFields ?? {}) as Record<string, Json>
        }
        table="purchaseOrder"
        tags={[]}
        onUpdate={onUpdateCustomFields}
        isDisabled={isDisabled}
      />
    </VStack>
  );
};

export default PurchaseOrderProperties;
