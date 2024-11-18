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
  Employee,
  Location,
} from "~/components/Form";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type { action } from "~/routes/x+/items+/update";
import type { action as exchangeRateAction } from "~/routes/x+/sales-order+/$orderId.exchange-rate";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import type { Quotation, SalesOrder } from "../../types";

const SalesOrderProperties = () => {
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  const routeData = useRouteData<{
    salesOrder: SalesOrder;
    quote: Quotation;
    originatedFromQuote: boolean;
  }>(path.to.salesOrder(orderId));

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
    (field: keyof SalesOrder, value: string | null) => {
      if (value === routeData?.salesOrder[field]) {
        return;
      }
      const formData = new FormData();

      formData.append("ids", orderId);
      formData.append("field", field);
      formData.append("value", value ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateSalesOrder,
      });
    },
    [fetcher, orderId, routeData?.salesOrder]
  );

  const permissions = usePermissions();
  const optimisticAssignment = useOptimisticAssignment({
    id: orderId,
    table: "salesOrder",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.salesOrder?.assignee;

  const isDisabled =
    !permissions.can("update", "sales") ||
    !["Draft", "In Progress", "Needs Approval"].includes(
      routeData?.salesOrder?.status ?? ""
    );

  return (
    <VStack
      spacing={4}
      className="w-96 bg-card h-full overflow-y-auto border-l border-border px-4 py-2 text-sm"
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
                        path.to.salesOrderDetails(orderId)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to Sales Order</span>
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
                    copyToClipboard(routeData?.salesOrder?.id ?? "")
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy Sales Order number</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm">{routeData?.salesOrder?.salesOrderId}</span>
      </VStack>

      <Assignee
        id={orderId}
        table="salesOrder"
        value={assignee ?? ""}
        variant="inline"
        isReadOnly={!permissions.can("update", "sales")}
      />

      <ValidatedForm
        defaultValues={{ customerId: routeData?.salesOrder?.customerId }}
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
            routeData?.salesOrder?.customerReference ?? undefined,
        }}
        validator={z.object({
          customerReference: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <InputControlled
          name="customerReference"
          label="Customer Ref. Number"
          value={routeData?.salesOrder?.customerReference ?? ""}
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
          customerLocationId: routeData?.salesOrder?.customerLocationId ?? "",
        }}
        validator={z.object({
          customerLocationId: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <CustomerLocation
          name="customerLocationId"
          customer={routeData?.salesOrder?.customerId ?? ""}
          inline
          isReadOnly={isDisabled}
          onChange={(customerLocation) => {
            if (customerLocation?.id) {
              onUpdate("customerLocationId", customerLocation.id);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          customerContactId: routeData?.salesOrder?.customerContactId ?? "",
        }}
        validator={z.object({
          customerContactId: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <CustomerContact
          name="customerContactId"
          customer={routeData?.salesOrder?.customerId ?? ""}
          inline
          isReadOnly={isDisabled}
          onChange={(customerContact) => {
            if (customerContact?.id) {
              onUpdate("customerContactId", customerContact.id);
            }
          }}
        />
      </ValidatedForm>

      {routeData?.originatedFromQuote && (
        <>
          <VStack spacing={2}>
            <span className="text-xs text-muted-foreground">
              Quote Accepted By
            </span>
            <span className="text-sm">
              {routeData?.quote?.digitalQuoteAcceptedBy}
            </span>
          </VStack>

          <VStack spacing={2}>
            <span className="text-xs text-muted-foreground">
              Quote Accepted By Email
            </span>
            <span className="text-sm">
              {routeData?.quote?.digitalQuoteAcceptedByEmail}
            </span>
          </VStack>
        </>
      )}

      <ValidatedForm
        defaultValues={{
          orderDate: routeData?.salesOrder?.orderDate ?? "",
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
        defaultValues={{ locationId: routeData?.salesOrder?.locationId }}
        validator={z.object({
          locationId: z.string().min(1, { message: "Location is required" }),
        })}
        className="w-full"
      >
        <Location
          label="Sales Order Location"
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
          salesPersonId: routeData?.salesOrder?.salesPersonId ?? undefined,
        }}
        validator={zfd.text(z.string().optional())}
        className="w-full"
      >
        <Employee
          name="salesPersonId"
          label="Sales Person"
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("salesPersonId", value.value);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          currencyCode: routeData?.salesOrder?.currencyCode ?? undefined,
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
          value={routeData?.salesOrder?.currencyCode ?? ""}
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("currencyCode", value.value);
            }
          }}
        />
      </ValidatedForm>

      {routeData?.salesOrder?.currencyCode &&
        routeData?.salesOrder?.currencyCode !== company.baseCurrencyCode && (
          <VStack spacing={2}>
            <HStack spacing={1}>
              <span className="text-xs text-muted-foreground">
                Exchange Rate
              </span>
              {routeData?.salesOrder?.exchangeRateUpdatedAt && (
                <Tooltip>
                  <TooltipTrigger tabIndex={-1}>
                    <LuInfo className="w-4 h-4" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Last updated:{" "}
                    {formatter.format(
                      new Date(
                        routeData?.salesOrder?.exchangeRateUpdatedAt ?? ""
                      )
                    )}
                  </TooltipContent>
                </Tooltip>
              )}
            </HStack>
            <HStack className="w-full justify-between">
              <span>{routeData?.salesOrder?.exchangeRate}</span>
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
                    routeData?.salesOrder?.currencyCode ?? ""
                  );
                  exchangeRateFetcher.submit(formData, {
                    method: "post",
                    action: path.to.salesOrderExchangeRate(orderId),
                  });
                }}
              />
            </HStack>
          </VStack>
        )}
    </VStack>
  );
};

export default SalesOrderProperties;
