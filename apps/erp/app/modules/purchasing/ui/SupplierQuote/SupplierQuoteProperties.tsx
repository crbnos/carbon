import type { Json } from "@carbon/database";
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
import { Assignee, DateTime, useOptimisticAssignment } from "~/components";
import {
  Currency,
  Supplier,
  SupplierContact,
  SupplierLocation
} from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type { action } from "~/routes/x+/items+/update";
import type { action as exchangeRateAction } from "~/routes/x+/supplier-quote+/$id.exchange-rate";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import { isSupplierQuoteLocked } from "../../purchasing.models";
import type { SupplierQuote } from "../../types";

const SupplierQuoteProperties = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    quote: SupplierQuote;
  }>(path.to.supplierQuote(id));

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  const { company } = useUser();
  const exchangeRateFetcher = useFetcher<typeof exchangeRateAction>();
  const { t } = useLingui();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdate = useCallback(
    (field: keyof SupplierQuote, value: string | null) => {
      if (value === routeData?.quote[field]) {
        return;
      }
      const formData = new FormData();

      formData.append("ids", id);
      formData.append("field", field);
      formData.append("value", value ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateSupplierQuote
      });
    },

    [id, routeData?.quote]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", id);
      formData.append("table", "supplierQuote");
      formData.append("value", value);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields
      });
    },

    [id]
  );

  const optimisticAssignment = useOptimisticAssignment({
    id,
    table: "supplierQuote"
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.quote?.assignee;
  const permissions = usePermissions();

  const canUpdate = permissions.can("update", "purchasing");
  const isLocked = isSupplierQuoteLocked(routeData?.quote?.status);
  const isDisabled = !canUpdate || isLocked;

  return (
    <VStack
      key={routeData?.quote?.id}
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
                      window.location.origin + path.to.supplierQuoteDetails(id)
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
                    copyToClipboard(routeData?.quote?.supplierQuoteId ?? "")
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy Quote number</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm">{routeData?.quote?.supplierQuoteId}</span>
      </VStack>
      <Assignee
        id={id}
        table="supplierQuote"
        value={assignee ?? ""}
        variant="inline"
        isReadOnly={!canUpdate}
      />
      <ValidatedForm
        defaultValues={{ supplierId: routeData?.quote?.supplierId }}
        validator={z.object({
          supplierId: z.string().min(1, { message: "Supplier is required" })
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
          supplierReference: routeData?.quote?.supplierReference ?? undefined
        }}
        validator={z.object({
          supplierReference: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <InputControlled
          name="supplierReference"
          label={t`Supplier Ref. Number`}
          value={routeData?.quote?.supplierReference ?? ""}
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
          supplierLocationId: routeData?.quote?.supplierLocationId ?? ""
        }}
        validator={z.object({
          supplierLocationId: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <SupplierLocation
          name="supplierLocationId"
          supplier={routeData?.quote?.supplierId ?? ""}
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
          supplierContactId: routeData?.quote?.supplierContactId ?? ""
        }}
        validator={z.object({
          supplierContactId: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <SupplierContact
          name="supplierContactId"
          supplier={routeData?.quote?.supplierId ?? ""}
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
          quotedDate: routeData?.quote?.quotedDate ?? ""
        }}
        validator={z.object({
          quotedDate: zfd.text(z.string().optional())
        })}
        className="w-full"
      >
        <DatePicker
          name="quotedDate"
          label={t`Quoted Date`}
          inline
          onChange={(date) => {
            onUpdate("quotedDate", date);
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
                    action: path.to.supplierQuoteExchangeRate(id)
                  });
                }}
              />
            </HStack>
          </VStack>
        )}
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

export default SupplierQuoteProperties;
