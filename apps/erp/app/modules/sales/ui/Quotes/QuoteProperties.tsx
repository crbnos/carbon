import type { Json } from "@carbon/database";
import { getQuoteDisplayId } from "@carbon/documents/utils";
import { DatePicker, InputControlled, ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  IconButton,
  Subheading,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect } from "react";
import { LuCopy, LuInfo, LuLink, LuRefreshCcw } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  Assignee,
  DateTime,
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
import type { action as exchangeRateAction } from "~/routes/x+/quote+/$quoteId.exchange-rate";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import { isQuoteLocked } from "../../sales.models";
import type { Quotation } from "../../types";

const QuoteProperties = () => {
  const { t } = useLingui();
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");

  const routeData = useRouteData<{
    quote: Quotation;
  }>(path.to.quote(quoteId));

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  const { company } = useUser();
  const exchangeRateFetcher = useFetcher<typeof exchangeRateAction>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdate = useCallback(
    (field: keyof Quotation, value: string | null) => {
      if (value === routeData?.quote[field]) {
        return;
      }
      const formData = new FormData();

      formData.append("ids", quoteId);
      formData.append("field", field);
      formData.append("value", value ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateQuote
      });
    },

    [quoteId, routeData?.quote]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", quoteId);
      formData.append("table", "quote");
      formData.append("value", value);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields
      });
    },

    [quoteId]
  );

  const optimisticAssignment = useOptimisticAssignment({
    id: quoteId,
    table: "quote"
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.quote?.assignee;
  const permissions = usePermissions();

  const canUpdate = permissions.can("update", "sales");
  const isLocked = isQuoteLocked(routeData?.quote?.status);
  const isDisabled = !canUpdate || isLocked;

  return (
    <VStack
      spacing={4}
      className="w-96 bg-background/30 h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      <VStack spacing={4}>
        <HStack className="w-full justify-between">
          <Subheading as="h3" variant="light">
            <Trans>Properties</Trans>
          </Subheading>
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
                      window.location.origin + path.to.quoteDetails(quoteId)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to Quote</span>
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
                    copyToClipboard(getQuoteDisplayId(routeData?.quote))
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <Trans>Copy Quote number</Trans>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm">{getQuoteDisplayId(routeData?.quote)}</span>
      </VStack>
      <Assignee
        id={quoteId}
        table="quote"
        value={assignee ?? ""}
        variant="inline"
        isReadOnly={!canUpdate}
      />
      <ValidatedForm
        defaultValues={{ customerId: routeData?.quote?.customerId }}
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
          customerReference: routeData?.quote?.customerReference ?? undefined
        }}
        validator={z.object({
          customerReference: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <InputControlled
          name="customerReference"
          label={t`Customer RFQ`}
          value={routeData?.quote?.customerReference ?? ""}
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
          customerLocationId: routeData?.quote?.customerLocationId ?? ""
        }}
        validator={z.object({
          customerLocationId: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <CustomerLocation
          name="customerLocationId"
          customer={routeData?.quote?.customerId ?? ""}
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
          customerContactId: routeData?.quote?.customerContactId ?? ""
        }}
        validator={z.object({
          customerContactId: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <CustomerContact
          name="customerContactId"
          customer={routeData?.quote?.customerId ?? ""}
          inline
          label={t`Purchasing Contact`}
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
            routeData?.quote?.customerEngineeringContactId ?? ""
        }}
        validator={z.object({
          customerEngineeringContactId: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <CustomerContact
          name="customerEngineeringContactId"
          customer={routeData?.quote?.customerId ?? ""}
          inline
          label={t`Engineering Contact`}
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
          expirationDate: routeData?.quote?.expirationDate ?? ""
        }}
        validator={z.object({
          expirationDate: z
            .string()
            .min(1, { message: "Expiration date is required" })
        })}
        className="w-full"
      >
        <DatePicker
          name="expirationDate"
          label={t`Expiration Date`}
          inline
          onChange={(date) => {
            onUpdate("expirationDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          dueDate: routeData?.quote?.dueDate ?? ""
        }}
        validator={z.object({
          dueDate: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <DatePicker
          name="dueDate"
          label={t`Due Date`}
          inline
          onChange={(date) => {
            onUpdate("dueDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{ locationId: routeData?.quote?.locationId }}
        validator={z.object({
          locationId: z.string().min(1, { message: "Location is required" })
        })}
        className="w-full"
      >
        <Location
          label={t`Quote Location`}
          name="locationId"
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("locationId", value.value);
            }
          }}
          termId="quote"
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          salesPersonId: routeData?.quote?.salesPersonId ?? undefined
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
          estimatorId: routeData?.quote?.estimatorId ?? undefined
        }}
        validator={z.object({
          estimatorId: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <Employee
          name="estimatorId"
          label={t`Estimator`}
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("estimatorId", value.value);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          currencyCode: routeData?.quote?.currencyCode ?? undefined
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
          value={routeData?.quote?.currencyCode ?? ""}
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("currencyCode", value.value);
            }
          }}
        />
      </ValidatedForm>

      {routeData?.quote?.currencyCode &&
        routeData?.quote?.currencyCode !== company.baseCurrencyCode && (
          <VStack spacing={2}>
            <HStack spacing={1}>
              <span className="text-xs text-muted-foreground">
                Exchange Rate
              </span>
              {routeData?.quote?.exchangeRateUpdatedAt && (
                <DateTime
                  value={routeData?.quote?.exchangeRateUpdatedAt}
                  variant="absolute"
                  side="bottom"
                >
                  <LuInfo className="h-4 w-4 text-muted-foreground" />
                </DateTime>
              )}
            </HStack>
            <HStack className="w-full justify-between">
              <span>{routeData?.quote?.exchangeRate}</span>
              <IconButton
                size="sm"
                variant="secondary"
                aria-label={t`Refresh`}
                icon={<LuRefreshCcw />}
                isDisabled={isDisabled}
                onClick={() => {
                  exchangeRateFetcher.submit(null, {
                    method: "post",
                    action: path.to.quoteExchangeRate(quoteId)
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
        <EmployeeAvatar employeeId={routeData?.quote?.createdBy} />
      </VStack>

      <CustomFormInlineFields
        customFields={
          (routeData?.quote?.customFields ?? {}) as Record<string, Json>
        }
        table="quote"
        tags={[]}
        onUpdate={onUpdateCustomFields}
      />
    </VStack>
  );
};

export default QuoteProperties;
