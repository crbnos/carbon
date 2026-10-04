// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Json } from "@carbon/database";
import {
  DatePicker,
  InputControlled,
  NumberControlled,
  Select,
  ValidatedForm
} from "@carbon/form";
import {
  Button,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP, round, tiptapToText } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { LuCopy, LuLink } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { z } from "zod";
import { EmployeeAvatar } from "~/components";
import {
  Currency,
  Customer,
  CustomerContact,
  CustomerLocation,
  Employee,
  PaymentTerm
} from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import { usePermissions, useRouteData, useSettings } from "~/hooks";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import {
  type ContractDuration,
  contractBillingAlignments,
  contractBillingFrequencies,
  contractBillingTimings,
  contractDurations,
  contractRenewals,
  customerContractTypes,
  invoiceAutomations
} from "../../sales.models";
import ContractProject from "./ContractProject";
import type { Contract, ContractRouteData } from "./types";
import { contractDurationOf, useContractLabels } from "./useContractLabels";

type Term =
  | "name"
  | "customerId"
  | "invoiceCustomerId"
  | "invoiceCustomerContactId"
  | "invoiceCustomerLocationId"
  | "salesPersonId"
  | "projectId"
  | "customerReference"
  | "closeDate"
  | "startDate"
  | "duration"
  | "endDate"
  | "renewal"
  | "renewalUplift"
  | "billingFrequency"
  | "billingAlignment"
  | "billingTiming"
  | "firstInvoiceDate"
  | "billedThrough"
  | "recognizeRevenueFrom"
  | "paymentTermId"
  | "currencyCode"
  | "notes";

/** Each property is its own form so a field validates on its own; the save
 *  goes through the update route, which validates the terms as a whole. */
const PropertyForm = ({
  name,
  value,
  children
}: {
  name: Term | "invoiceAutomation" | "contractType";
  value: unknown;
  children: ReactNode;
}) => (
  <ValidatedForm
    defaultValues={{ [name]: value ?? "" }}
    validator={z.object({ [name]: z.any() })}
    className="w-full"
  >
    {children}
  </ValidatedForm>
);

/** The Select's value for "no override": Radix refuses an empty item value. */
const COMPANY_DEFAULT = "default";

/** The contract's terms, in the properties panel every document with an
 *  explorer has. Editable while Draft. Once confirmed the terms change with
 *  Amend, so they are read only — except the type, invoicing and notes,
 *  which are not terms. */
const ContractProperties = () => {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<ContractRouteData>(path.to.contract(id));
  const contract = routeData?.contract;
  const permissions = usePermissions();
  const companySettings = useSettings();
  const labels = useContractLabels();

  const storedDuration = contract
    ? contractDurationOf({
        endDate: contract.endDate,
        termMonths: contract.termMonths
      })
    : "12";
  // Choosing Custom saves nothing until an end date is picked.
  const [duration, setDuration] = useState<ContractDuration>(storedDuration);
  useEffect(() => {
    setDuration(storedDuration);
  }, [storedDuration]);

  const fetcher = useFetcher<{ error: { message: string } | null }>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is stable
  const submit = useCallback(
    (fields: Record<string, string>) => {
      const formData = new FormData();
      formData.append("id", id);
      for (const [key, value] of Object.entries(fields)) {
        formData.append(key, value);
      }
      fetcher.submit(formData, {
        method: "post",
        action: path.to.contractUpdate
      });
    },
    [id]
  );

  const onUpdate = useCallback(
    (field: Term, value: string | null) => {
      if (field !== "duration" && field !== "notes") {
        const current = contract?.[field as keyof Contract];
        if (
          (current ?? null) === (value ?? null) ||
          String(current) === value
        ) {
          return;
        }
      }
      submit({ field, value: value ?? "" });
    },
    [contract, submit]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is stable
  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();
      formData.append("ids", id);
      formData.append("table", "customerContract");
      formData.append("value", value);
      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields
      });
    },
    [id]
  );

  if (!contract) return null;

  const companyLabel =
    labels.invoiceAutomation[companySettings.invoiceAutomation];
  const canUpdate = permissions.can("update", "sales");
  const isDisabled = contract.status !== "Draft" || !canUpdate;
  const isEnded = contract.status === "Ended";
  const billTo = contract.invoiceCustomerId ?? contract.customerId ?? "";
  const notesText = tiptapToText(
    (contract.notes ?? null) as Parameters<typeof tiptapToText>[0]
  );
  const renewalUpliftPoints = round(Number(contract.renewalUplift ?? 0) * 100);

  return (
    <VStack
      spacing={4}
      className="w-96 bg-background/30 h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
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
                      window.location.origin + path.to.contractDetails(id)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy link to contract</Trans>
                </span>
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
                    copyToClipboard(contract.customerContractId ?? "")
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy contract number</Trans>
                </span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm">{contract.customerContractId}</span>
      </VStack>

      <PropertyForm name="name" value={contract.name}>
        <InputControlled
          name="name"
          label={t`Name`}
          size="sm"
          inline
          isReadOnly={isDisabled}
          value={contract.name ?? ""}
          onBlur={(e) => {
            if (e.target.value.trim()) onUpdate("name", e.target.value.trim());
          }}
        />
      </PropertyForm>
      <PropertyForm name="customerId" value={contract.customerId}>
        <Customer
          name="customerId"
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) onUpdate("customerId", value.value);
          }}
        />
      </PropertyForm>
      <PropertyForm name="invoiceCustomerId" value={contract.invoiceCustomerId}>
        <Customer
          name="invoiceCustomerId"
          label={t`Bill To`}
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            onUpdate("invoiceCustomerId", value?.value ?? null);
          }}
        />
      </PropertyForm>
      <PropertyForm
        name="invoiceCustomerContactId"
        value={contract.invoiceCustomerContactId}
      >
        <CustomerContact
          name="invoiceCustomerContactId"
          label={t`Invoice Contact`}
          customer={billTo}
          inline
          isReadOnly={isDisabled}
          onChange={(contact) => {
            if (contact?.id) onUpdate("invoiceCustomerContactId", contact.id);
          }}
        />
      </PropertyForm>
      <PropertyForm
        name="invoiceCustomerLocationId"
        value={contract.invoiceCustomerLocationId}
      >
        <CustomerLocation
          name="invoiceCustomerLocationId"
          label={t`Invoice Address`}
          customer={billTo}
          inline
          isReadOnly={isDisabled}
          onChange={(location) => {
            if (location?.id)
              onUpdate("invoiceCustomerLocationId", location.id);
          }}
        />
      </PropertyForm>
      <PropertyForm name="salesPersonId" value={contract.salesPersonId}>
        <Employee
          name="salesPersonId"
          label={t`Sales Person`}
          inline
          isReadOnly={isDisabled}
          onChange={(employee) => {
            onUpdate("salesPersonId", employee?.value ?? null);
          }}
        />
      </PropertyForm>
      <PropertyForm name="projectId" value={contract.projectId}>
        <ContractProject
          name="projectId"
          label={t`Project`}
          inline
          isReadOnly={isDisabled}
          onChange={(project) => {
            onUpdate("projectId", project?.value ?? null);
          }}
        />
      </PropertyForm>
      <PropertyForm name="customerReference" value={contract.customerReference}>
        <InputControlled
          name="customerReference"
          label={t`PO Number`}
          size="sm"
          inline
          isReadOnly={isDisabled}
          value={contract.customerReference ?? ""}
          onBlur={(e) => {
            onUpdate("customerReference", e.target.value || null);
          }}
        />
      </PropertyForm>
      <PropertyForm name="contractType" value={contract.contractType}>
        <Select
          name="contractType"
          label={t`Contract Type`}
          inline={(value) => (
            <span>
              {labels.contractType[
                value as (typeof customerContractTypes)[number]
              ] ?? value}
            </span>
          )}
          isReadOnly={isEnded || !canUpdate}
          options={customerContractTypes.map((type) => ({
            value: type,
            label: labels.contractType[type]
          }))}
          onChange={(option) => {
            if (option?.value && option.value !== contract.contractType) {
              submit({ intent: "contractType", value: option.value });
            }
          }}
        />
      </PropertyForm>

      <VStack spacing={4} className="w-full border-t border-border pt-4">
        <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
          <Trans>Term</Trans>
        </h3>
        <PropertyForm name="closeDate" value={contract.closeDate}>
          <DatePicker
            name="closeDate"
            label={t`Close Date`}
            inline
            isDisabled={isDisabled}
            onChange={(date) => {
              if (date) onUpdate("closeDate", date);
            }}
          />
        </PropertyForm>
        <PropertyForm name="startDate" value={contract.startDate}>
          <DatePicker
            name="startDate"
            label={t`Start Date`}
            inline
            isDisabled={isDisabled}
            onChange={(date) => {
              if (date) onUpdate("startDate", date);
            }}
          />
        </PropertyForm>
        <PropertyForm name="duration" value={storedDuration}>
          <Select
            name="duration"
            label={t`Duration`}
            inline={(value) => (
              <span>{labels.duration[value as ContractDuration] ?? value}</span>
            )}
            isReadOnly={isDisabled}
            options={contractDurations.map((value) => ({
              value,
              label: labels.duration[value]
            }))}
            onChange={(option) => {
              if (!option?.value) return;
              const next = option.value as ContractDuration;
              setDuration(next);
              if (next !== "custom" && next !== storedDuration) {
                onUpdate("duration", next);
              }
            }}
          />
        </PropertyForm>
        <PropertyForm name="endDate" value={contract.endDate}>
          <DatePicker
            name="endDate"
            label={t`End Date`}
            inline
            // Derived from the duration unless the term is custom.
            isDisabled={isDisabled || duration !== "custom"}
            onChange={(date) => {
              if (date) onUpdate("endDate", date);
            }}
          />
        </PropertyForm>
        <PropertyForm name="renewal" value={contract.renewal}>
          <Select
            name="renewal"
            label={t`At the End`}
            inline={(value) => (
              <span>
                {labels.renewal[value as (typeof contractRenewals)[number]] ??
                  value}
              </span>
            )}
            isReadOnly={isDisabled}
            options={contractRenewals.map((value) => ({
              value,
              label: labels.renewal[value]
            }))}
            onChange={(option) => {
              if (option?.value) onUpdate("renewal", option.value);
            }}
          />
        </PropertyForm>
        <PropertyForm name="renewalUplift" value={renewalUpliftPoints}>
          <NumberControlled
            name="renewalUplift"
            label={t`Renewal Uplift (%)`}
            inline
            isReadOnly={isDisabled}
            value={renewalUpliftPoints}
            minValue={0}
            step={INPUT_STEP.percent}
            formatOptions={INPUT_FORMAT.percentPoints}
            onChange={(value) => {
              const points = Number.isNaN(value) ? 0 : value;
              if (points !== renewalUpliftPoints) {
                submit({ field: "renewalUplift", value: String(points) });
              }
            }}
          />
        </PropertyForm>
      </VStack>

      <VStack spacing={4} className="w-full border-t border-border pt-4">
        <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
          <Trans>Invoicing</Trans>
        </h3>
        <PropertyForm name="billingFrequency" value={contract.billingFrequency}>
          <Select
            name="billingFrequency"
            label={t`Billing Frequency`}
            inline={(value) => (
              <span>
                {labels.billingFrequency[
                  value as (typeof contractBillingFrequencies)[number]
                ] ?? value}
              </span>
            )}
            isReadOnly={isDisabled}
            options={contractBillingFrequencies.map((value) => ({
              value,
              label: labels.billingFrequency[value]
            }))}
            onChange={(option) => {
              if (option?.value) onUpdate("billingFrequency", option.value);
            }}
          />
        </PropertyForm>
        <PropertyForm name="billingAlignment" value={contract.billingAlignment}>
          <Select
            name="billingAlignment"
            label={t`Billing Alignment`}
            inline={(value) => (
              <span>
                {labels.billingAlignment[
                  value as (typeof contractBillingAlignments)[number]
                ] ?? value}
              </span>
            )}
            isReadOnly={isDisabled}
            options={contractBillingAlignments.map((value) => ({
              value,
              label: labels.billingAlignment[value]
            }))}
            onChange={(option) => {
              if (option?.value) onUpdate("billingAlignment", option.value);
            }}
          />
        </PropertyForm>
        <PropertyForm name="billingTiming" value={contract.billingTiming}>
          <Select
            name="billingTiming"
            label={t`Billing Timing`}
            termId="billing-timing"
            inline={(value) => (
              <span>
                {labels.billingTiming[
                  value as (typeof contractBillingTimings)[number]
                ] ?? value}
              </span>
            )}
            isReadOnly={isDisabled}
            options={contractBillingTimings.map((value) => ({
              value,
              label: labels.billingTiming[value]
            }))}
            onChange={(option) => {
              if (option?.value) onUpdate("billingTiming", option.value);
            }}
          />
        </PropertyForm>
        <PropertyForm name="firstInvoiceDate" value={contract.firstInvoiceDate}>
          <DatePicker
            name="firstInvoiceDate"
            label={t`First Invoice`}
            inline
            isDisabled={isDisabled}
            onChange={(date) => {
              onUpdate("firstInvoiceDate", date || null);
            }}
          />
        </PropertyForm>
        <PropertyForm name="billedThrough" value={contract.billedThrough}>
          <DatePicker
            name="billedThrough"
            label={t`Billed Through`}
            inline
            isDisabled={isDisabled}
            onChange={(date) => {
              onUpdate("billedThrough", date || null);
            }}
          />
        </PropertyForm>
        <PropertyForm
          name="recognizeRevenueFrom"
          value={contract.recognizeRevenueFrom}
        >
          <DatePicker
            name="recognizeRevenueFrom"
            label={t`Recognize Revenue From`}
            inline
            isDisabled={isDisabled}
            onChange={(date) => {
              onUpdate("recognizeRevenueFrom", date || null);
            }}
          />
        </PropertyForm>
        <PropertyForm
          name="invoiceAutomation"
          value={contract.invoiceAutomation ?? COMPANY_DEFAULT}
        >
          <Select
            name="invoiceAutomation"
            label={t`Invoicing`}
            inline={(value) => (
              <span>
                {value === COMPANY_DEFAULT
                  ? t`Company default (${companyLabel})`
                  : (labels.invoiceAutomation[
                      value as (typeof invoiceAutomations)[number]
                    ] ?? value)}
              </span>
            )}
            isReadOnly={isEnded || !canUpdate}
            options={[
              {
                value: COMPANY_DEFAULT,
                label: t`Company default (${companyLabel})`
              },
              ...invoiceAutomations.map((mode) => ({
                value: mode,
                label: labels.invoiceAutomation[mode]
              }))
            ]}
            onChange={(option) => {
              const next =
                !option?.value || option.value === COMPANY_DEFAULT
                  ? null
                  : option.value;
              if ((contract.invoiceAutomation ?? null) === next) return;
              submit({ intent: "invoiceAutomation", value: next ?? "" });
            }}
          />
        </PropertyForm>
        <PropertyForm name="paymentTermId" value={contract.paymentTermId}>
          <PaymentTerm
            name="paymentTermId"
            label={t`Payment Terms`}
            inline
            isReadOnly={isDisabled}
            onChange={(term) => {
              onUpdate("paymentTermId", term?.value ?? null);
            }}
          />
        </PropertyForm>
        <PropertyForm name="currencyCode" value={contract.currencyCode}>
          <Currency
            name="currencyCode"
            label={t`Currency`}
            inline
            isReadOnly={isDisabled}
            onChange={(currency) => {
              if (currency?.value) onUpdate("currencyCode", currency.value);
            }}
          />
        </PropertyForm>
      </VStack>

      <PropertyForm name="notes" value={notesText}>
        <InputControlled
          name="notes"
          label={t`Notes`}
          size="sm"
          inline
          isReadOnly={isEnded || !canUpdate}
          value={notesText}
          onBlur={(e) => {
            if (e.target.value !== notesText) {
              onUpdate("notes", e.target.value || null);
            }
          }}
        />
      </PropertyForm>

      <VStack spacing={2}>
        <span className="text-xs font-medium text-muted-foreground">
          <Trans>Created By</Trans>
        </span>
        <EmployeeAvatar employeeId={contract.createdBy} />
      </VStack>

      <CustomFormInlineFields
        customFields={(contract.customFields ?? {}) as Record<string, Json>}
        table="customerContract"
        tags={[]}
        onUpdate={onUpdateCustomFields}
      />
    </VStack>
  );
};

export default ContractProperties;
