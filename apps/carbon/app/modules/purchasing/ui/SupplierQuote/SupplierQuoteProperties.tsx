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
  Supplier,
  SupplierContact,
  SupplierLocation,
} from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type { action } from "~/routes/x+/items+/update";
import type { action as exchangeRateAction } from "~/routes/x+/supplier-quote+/$id.exchange-rate";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
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
        action: path.to.bulkUpdateSupplierQuote,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, routeData?.quote]
  );

  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", id);
      formData.append("table", "supplierQuote");
      formData.append("value", value);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id]
  );

  const optimisticAssignment = useOptimisticAssignment({
    id,
    table: "supplierQuote",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.quote?.assignee;
  const permissions = usePermissions();

  const isDisabled =
    !permissions.can("update", "sales") ||
    !["Active"].includes(routeData?.quote?.status ?? "");

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
                  aria-label="Copy"
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
        isReadOnly={!permissions.can("update", "sales")}
      />
      <ValidatedForm
        defaultValues={{ supplierId: routeData?.quote?.supplierId }}
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
          supplierReference: routeData?.quote?.supplierReference ?? undefined,
        }}
        validator={z.object({
          supplierReference: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <InputControlled
          name="supplierReference"
          label="Supplier Ref. Number"
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
          supplierLocationId: routeData?.quote?.supplierLocationId ?? "",
        }}
        validator={z.object({
          supplierLocationId: zfd.text(z.string().optional()),
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
          supplierContactId: routeData?.quote?.supplierContactId ?? "",
        }}
        validator={z.object({
          supplierContactId: zfd.text(z.string().optional()),
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
          expirationDate: routeData?.quote?.expirationDate ?? "",
        }}
        validator={z.object({
          expirationDate: z
            .string()
            .min(1, { message: "Expiration date is required" }),
        })}
        className="w-full"
      >
        <DatePicker
          name="expirationDate"
          label="Expiration Date"
          inline
          isDisabled={isDisabled}
          onChange={(date) => {
            onUpdate("expirationDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          quotedDate: routeData?.quote?.quotedDate ?? "",
        }}
        validator={z.object({
          quotedDate: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <DatePicker
          name="quotedDate"
          label="Quoted Date"
          inline
          isDisabled={isDisabled}
          onChange={(date) => {
            onUpdate("quotedDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          currencyCode: routeData?.quote?.currencyCode ?? undefined,
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
                <Tooltip>
                  <TooltipTrigger tabIndex={-1}>
                    <LuInfo className="w-4 h-4" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Last updated:{" "}
                    {formatter.format(
                      new Date(routeData?.quote?.exchangeRateUpdatedAt ?? "")
                    )}
                  </TooltipContent>
                </Tooltip>
              )}
            </HStack>
            <HStack className="w-full justify-between">
              <span>{routeData?.quote?.exchangeRate}</span>
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
                    routeData?.quote?.currencyCode ?? ""
                  );
                  exchangeRateFetcher.submit(formData, {
                    method: "post",
                    action: path.to.supplierQuoteExchangeRate(id),
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
        isDisabled={isDisabled}
      />
    </VStack>
  );
};

export default SupplierQuoteProperties;
