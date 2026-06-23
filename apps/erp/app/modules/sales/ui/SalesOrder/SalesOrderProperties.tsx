import type { Json } from "@carbon/database";
import { DatePicker, InputControlled, ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useCallback, useEffect, useMemo } from "react";
import { LuCopy, LuInfo, LuLink, LuRefreshCcw } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  Assignee,
  EmployeeAvatar,
  useOptimisticAssignment
} from "~/components";
import {
  Currency,
  Customer,
  CustomerContact,
  CustomerLocation,
  Employee,
  Location
} from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type { action } from "~/routes/x+/items+/update";
import type { action as exchangeRateAction } from "~/routes/x+/sales-order+/$orderId.exchange-rate";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import { isSalesOrderLocked } from "../../sales.models";
import type { SalesOrder } from "../../types";

const SalesOrderProperties = () => {
  const { t } = useLingui();
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  const routeData = useRouteData<{
    salesOrder: SalesOrder;
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
        timeStyle: "short"
      }),
    [locale]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdate = useCallback(
    (
      field: keyof SalesOrder | "receiptRequestedDate" | "receiptPromisedDate",
      value: string | null
    ) => {
      if (value === routeData?.salesOrder[field]) {
        return;
      }
      const formData = new FormData();

      formData.append("ids", orderId);
      formData.append("field", field);
      formData.append("value", value ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateSalesOrder
      });
    },

    [orderId, routeData?.salesOrder]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", orderId);
      formData.append("table", "salesOrder");
      formData.append("value", value);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields
      });
    },

    [orderId]
  );

  const permissions = usePermissions();
  const optimisticAssignment = useOptimisticAssignment({
    id: orderId,
    table: "salesOrder"
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.salesOrder?.assignee;

  const canUpdate = permissions.can("update", "sales");
  const isLocked = isSalesOrderLocked(routeData?.salesOrder?.status);
  const isDisabled = !canUpdate || isLocked;

  return (
    <VStack
      spacing={4}
      className="w-96 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      <VStack spacing={4}>
        <HStack className="w-full justify-between">
          <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
            <Trans>Properties</Trans>
          </h3>
          <HStack spacing={1}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label={t`Link`}
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
                  aria-label={t`Copy`}
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    copyToClipboard(routeData?.salesOrder?.salesOrderId ?? "")
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
        isReadOnly={!canUpdate}
      />

      <ValidatedForm
        defaultValues={{ customerId: routeData?.salesOrder?.customerId }}
        validator={z.object({
          customerId: z.string().min(1, { message: "Customer is required" })
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
            routeData?.salesOrder?.customerReference ?? undefined
        }}
        validator={z.object({
          customerReference: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <InputControlled
          name="customerReference"
          label={t`Customer PO`}
          value={routeData?.salesOrder?.customerReference ?? ""}
          size="sm"
          inline
          onBlur={(e) => {
            onUpdate("customerReference", e.target.value);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          customerLocationId: routeData?.salesOrder?.customerLocationId ?? ""
        }}
        validator={z.object({
          customerLocationId: zfd.text(z.string().optional())
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
          customerContactId: routeData?.salesOrder?.customerContactId ?? ""
        }}
        validator={z.object({
          customerContactId: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <CustomerContact
          name="customerContactId"
          label={t`Purchasing Contact`}
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

      <ValidatedForm
        defaultValues={{
          customerEngineeringContactId:
            routeData?.salesOrder?.customerEngineeringContactId ?? ""
        }}
        validator={z.object({
          customerEngineeringContactId: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <CustomerContact
          name="customerEngineeringContactId"
          label={t`Engineering Contact`}
          customer={routeData?.salesOrder?.customerId ?? ""}
          inline
          isReadOnly={isDisabled}
          onChange={(customerEngineeringContact) => {
            if (customerEngineeringContact?.id) {
              onUpdate(
                "customerEngineeringContactId",
                customerEngineeringContact.id
              );
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          orderDate: routeData?.salesOrder?.orderDate ?? ""
        }}
        validator={z.object({
          orderDate: z.string().min(1, { message: "Order date is required" })
        })}
        className="w-full"
      >
        <DatePicker
          name="orderDate"
          label={t`Order Date`}
          inline
          onChange={(date) => {
            onUpdate("orderDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          receiptRequestedDate:
            routeData?.salesOrder?.receiptRequestedDate ?? ""
        }}
        validator={z.object({
          receiptRequestedDate: z.string()
        })}
        className="w-full"
      >
        <DatePicker
          name="receiptRequestedDate"
          label={t`Requested Date`}
          inline
          onChange={(date) => {
            onUpdate("receiptRequestedDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          receiptPromisedDate: routeData?.salesOrder?.receiptPromisedDate ?? ""
        }}
        validator={z.object({
          receiptPromisedDate: z.string()
        })}
        className="w-full"
      >
        <DatePicker
          name="receiptPromisedDate"
          label={t`Promised Date`}
          inline
          onChange={(date) => {
            onUpdate("receiptPromisedDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{ locationId: routeData?.salesOrder?.locationId }}
        validator={z.object({
          locationId: z.string().min(1, { message: "Location is required" })
        })}
        className="w-full"
      >
        <Location
          label={t`Sales Order Location`}
          name="locationId"
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("locationId", value.value);
            }
          }}
          termId="sales-order"
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          salesPersonId: routeData?.salesOrder?.salesPersonId ?? undefined
        }}
        validator={zfd.text(z.string().optional())}
        className="w-full"
      >
        <Employee
          name="salesPersonId"
          label={t`Sales Person`}
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
          currencyCode: routeData?.salesOrder?.currencyCode ?? undefined
        }}
        validator={z.object({
          currencyCode: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <Currency
          name="currencyCode"
          label={t`Currency`}
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
                aria-label={t`Refresh`}
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
                    action: path.to.salesOrderExchangeRate(orderId)
                  });
                }}
              />
            </HStack>
          </VStack>
        )}
      <VStack spacing={2}>
        <span className="text-xs font-medium text-muted-foreground">
          Created By
        </span>
        {/* @ts-expect-error TS2322 */}
        <EmployeeAvatar employeeId={routeData?.salesOrder?.createdBy} />
      </VStack>

      <CustomFormInlineFields
        customFields={
          (routeData?.salesOrder?.customFields ?? {}) as Record<string, Json>
        }
        table="salesOrder"
        tags={[]}
        onUpdate={onUpdateCustomFields}
      />
    </VStack>
  );
};

export default SalesOrderProperties;
