// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Json } from "@carbon/database";
import {
  Boolean,
  DatePicker,
  InputControlled,
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
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useCallback, useEffect } from "react";
import { LuCopy, LuLink } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { z } from "zod";
import { EmployeeAvatar } from "~/components";
import {
  Employee,
  Location,
  NumberControlled,
  Supplier,
  SupplierContact,
  SupplierLocation
} from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import { useCurrencyDecimals, usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import {
  leasePaymentFrequencies,
  leasePaymentTimings
} from "../../purchasing.models";
import type { Lease, LeaseRouteData } from "./types";

type Term =
  | "supplierId"
  | "supplierLocationId"
  | "supplierContactId"
  | "assignee"
  | "locationId"
  | "name"
  | "description"
  | "commencementDate"
  | "endDate"
  | "noticeDate"
  | "invoiceFromDate"
  | "paymentAmount"
  | "paymentFrequency"
  | "paymentTiming"
  | "annualEscalationPercent"
  | "discountRate"
  | "fairValue"
  | "economicLifeMonths"
  | "purchaseOptionAmount"
  | "ownershipTransfers"
  | "specializedAsset"
  | "purchaseOptionReasonablyCertain";

/** Each property is its own form so a field validates on its own; the save
 *  goes through the update route, which validates the terms as a whole. */
const PropertyForm = ({
  name,
  value,
  children
}: {
  name: Term;
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

const SectionHeading = ({ children }: { children: ReactNode }) => (
  <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
    {children}
  </h3>
);

/** The lease's terms, in the properties panel every document with an
 *  explorer has. Editable while Draft; after activation they change only
 *  through Modify, Terminate and Purchase, so they are read only. */
const LeaseProperties = () => {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<LeaseRouteData>(path.to.lease(id));
  const lease = routeData?.lease;
  const permissions = usePermissions();
  const currencyCode = lease?.currencyCode ?? "";
  const currencyDecimals = useCurrencyDecimals(currencyCode);

  const fetcher = useFetcher<{ error: { message: string } | null }>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is stable
  const onUpdate = useCallback(
    (field: Term, value: string | null) => {
      const current = lease?.[field as keyof Lease];
      if ((current ?? null) === (value ?? null) || String(current) === value) {
        return;
      }
      const formData = new FormData();
      formData.append("id", id);
      formData.append("field", field);
      formData.append("value", value ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.leaseUpdate
      });
    },
    [id, lease]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is stable
  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();
      formData.append("ids", id);
      formData.append("table", "lease");
      formData.append("value", value);
      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields
      });
    },
    [id]
  );

  if (!lease) return null;

  const isDisabled =
    lease.status !== "Draft" || !permissions.can("update", "purchasing");
  const moneyFormat = INPUT_FORMAT.money(currencyCode, currencyDecimals);
  const moneyStep = INPUT_STEP.money(currencyDecimals);
  const frequencyLabel = (value: string) =>
    value === "Monthly"
      ? t`Monthly`
      : value === "Quarterly"
        ? t`Quarterly`
        : t`Annual`;
  const timingLabel = (value: string) =>
    value === "Advance" ? t`Advance` : t`Arrears`;

  return (
    <VStack
      spacing={4}
      className="w-96 bg-background/30 h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      <VStack spacing={4}>
        <HStack className="w-full justify-between">
          <SectionHeading>
            <Trans>Properties</Trans>
          </SectionHeading>
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
                      window.location.origin + path.to.leaseDetails(id)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy link to lease</Trans>
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
                  onClick={() => copyToClipboard(lease.leaseId ?? "")}
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy lease number</Trans>
                </span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm">{lease.leaseId}</span>
      </VStack>

      <PropertyForm name="name" value={lease.name}>
        <InputControlled
          name="name"
          label={t`Name`}
          size="sm"
          inline
          isReadOnly={isDisabled}
          value={lease.name ?? ""}
          onBlur={(e) => {
            if (e.target.value) onUpdate("name", e.target.value);
          }}
        />
      </PropertyForm>
      <PropertyForm name="supplierId" value={lease.supplierId}>
        <Supplier
          name="supplierId"
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) onUpdate("supplierId", value.value);
          }}
        />
      </PropertyForm>
      <PropertyForm name="supplierLocationId" value={lease.supplierLocationId}>
        <SupplierLocation
          name="supplierLocationId"
          label={t`Supplier Location`}
          supplier={lease.supplierId ?? ""}
          inline
          isReadOnly={isDisabled}
          onChange={(location) => {
            if (location?.id) onUpdate("supplierLocationId", location.id);
          }}
        />
      </PropertyForm>
      <PropertyForm name="supplierContactId" value={lease.supplierContactId}>
        <SupplierContact
          name="supplierContactId"
          label={t`Supplier Contact`}
          supplier={lease.supplierId ?? ""}
          inline
          isReadOnly={isDisabled}
          onChange={(contact) => {
            if (contact?.id) onUpdate("supplierContactId", contact.id);
          }}
        />
      </PropertyForm>
      <PropertyForm name="assignee" value={lease.assignee}>
        <Employee
          name="assignee"
          label={t`Owner`}
          inline
          isReadOnly={isDisabled}
          onChange={(employee) => {
            onUpdate("assignee", employee?.value ?? null);
          }}
        />
      </PropertyForm>
      <PropertyForm name="locationId" value={lease.locationId}>
        <Location
          name="locationId"
          label={t`Location`}
          inline
          isReadOnly={isDisabled}
          onChange={(location) => {
            if (location?.value) onUpdate("locationId", location.value);
          }}
        />
      </PropertyForm>
      <PropertyForm name="description" value={lease.description}>
        <InputControlled
          name="description"
          label={t`Description`}
          size="sm"
          inline
          isReadOnly={isDisabled}
          value={lease.description ?? ""}
          onBlur={(e) => {
            onUpdate("description", e.target.value || null);
          }}
        />
      </PropertyForm>

      <VStack spacing={4} className="w-full border-t border-border pt-4">
        <SectionHeading>
          <Trans>Term</Trans>
        </SectionHeading>
        <PropertyForm name="commencementDate" value={lease.commencementDate}>
          <DatePicker
            name="commencementDate"
            label={t`Commencement Date`}
            inline
            isDisabled={isDisabled}
            onChange={(date) => {
              if (date) onUpdate("commencementDate", date);
            }}
          />
        </PropertyForm>
        <PropertyForm name="endDate" value={lease.endDate}>
          <DatePicker
            name="endDate"
            label={t`End Date`}
            inline
            isDisabled={isDisabled}
            onChange={(date) => {
              if (date) onUpdate("endDate", date);
            }}
          />
        </PropertyForm>
        <PropertyForm name="noticeDate" value={lease.noticeDate}>
          <DatePicker
            name="noticeDate"
            label={t`Notice Date`}
            inline
            isDisabled={isDisabled}
            onChange={(date) => {
              onUpdate("noticeDate", date || null);
            }}
          />
        </PropertyForm>
        <PropertyForm name="invoiceFromDate" value={lease.invoiceFromDate}>
          <DatePicker
            name="invoiceFromDate"
            label={t`Invoice From`}
            inline
            isDisabled={isDisabled}
            onChange={(date) => {
              onUpdate("invoiceFromDate", date || null);
            }}
          />
        </PropertyForm>
      </VStack>

      <VStack spacing={4} className="w-full border-t border-border pt-4">
        <SectionHeading>
          <Trans>Payments</Trans>
        </SectionHeading>
        <PropertyForm name="paymentAmount" value={lease.paymentAmount}>
          <NumberControlled
            name="paymentAmount"
            label={t`Payment Amount`}
            inline
            isReadOnly={isDisabled}
            value={lease.paymentAmount ?? 0}
            minValue={0}
            step={moneyStep}
            formatOptions={moneyFormat}
            onChange={(value) => {
              onUpdate(
                "paymentAmount",
                String(Number.isNaN(value) ? 0 : value)
              );
            }}
          />
        </PropertyForm>
        <PropertyForm name="paymentFrequency" value={lease.paymentFrequency}>
          <Select
            name="paymentFrequency"
            label={t`Payment Frequency`}
            inline={(value) => <span>{frequencyLabel(value)}</span>}
            isReadOnly={isDisabled}
            options={leasePaymentFrequencies.map((frequency) => ({
              value: frequency,
              label: frequencyLabel(frequency)
            }))}
            onChange={(option) => {
              if (option?.value) onUpdate("paymentFrequency", option.value);
            }}
          />
        </PropertyForm>
        <PropertyForm name="paymentTiming" value={lease.paymentTiming}>
          <Select
            name="paymentTiming"
            label={t`Payment Timing`}
            inline={(value) => <span>{timingLabel(value)}</span>}
            isReadOnly={isDisabled}
            options={leasePaymentTimings.map((timing) => ({
              value: timing,
              label: timingLabel(timing)
            }))}
            onChange={(option) => {
              if (option?.value) onUpdate("paymentTiming", option.value);
            }}
          />
        </PropertyForm>
        <PropertyForm
          name="annualEscalationPercent"
          value={lease.annualEscalationPercent}
        >
          <NumberControlled
            name="annualEscalationPercent"
            label={t`Annual Escalation (%)`}
            inline
            isReadOnly={isDisabled}
            value={lease.annualEscalationPercent ?? 0}
            minValue={0}
            step={INPUT_STEP.percent}
            formatOptions={INPUT_FORMAT.percentPoints}
            onChange={(value) => {
              onUpdate(
                "annualEscalationPercent",
                String(Number.isNaN(value) ? 0 : value)
              );
            }}
          />
        </PropertyForm>
        <VStack spacing={1}>
          <span className="text-xs font-medium text-muted-foreground">
            <Trans>Currency</Trans>
          </span>
          <span>{lease.currencyCode}</span>
        </VStack>
        {!isDisabled && (
          <p className="text-xs text-muted-foreground">
            <Trans>
              Changing a payment term or a date cuts the payment rows again.
              Edited rows are replaced.
            </Trans>
          </p>
        )}
      </VStack>

      <VStack spacing={4} className="w-full border-t border-border pt-4">
        <SectionHeading>
          <Trans>Accounting Treatment</Trans>
        </SectionHeading>
        <PropertyForm name="discountRate" value={lease.discountRate}>
          <NumberControlled
            name="discountRate"
            label={t`Discount Rate (%)`}
            inline
            isReadOnly={isDisabled}
            value={lease.discountRate ?? 0}
            minValue={0}
            step={INPUT_STEP.percent}
            formatOptions={INPUT_FORMAT.percentPoints}
            onChange={(value) => {
              onUpdate("discountRate", String(Number.isNaN(value) ? 0 : value));
            }}
          />
        </PropertyForm>
        <PropertyForm name="fairValue" value={lease.fairValue}>
          <NumberControlled
            name="fairValue"
            label={t`Fair Value`}
            inline
            isReadOnly={isDisabled}
            value={lease.fairValue ?? 0}
            minValue={0}
            step={moneyStep}
            formatOptions={moneyFormat}
            onChange={(value) => {
              // An emptied input commits NaN; no fair value is null, not 0.
              onUpdate("fairValue", value > 0 ? String(value) : null);
            }}
          />
        </PropertyForm>
        <PropertyForm
          name="economicLifeMonths"
          value={lease.economicLifeMonths}
        >
          <NumberControlled
            name="economicLifeMonths"
            label={t`Economic Life (months)`}
            inline
            isReadOnly={isDisabled}
            value={lease.economicLifeMonths ?? 0}
            minValue={0}
            onChange={(value) => {
              onUpdate("economicLifeMonths", value > 0 ? String(value) : null);
            }}
          />
        </PropertyForm>
        <PropertyForm
          name="purchaseOptionAmount"
          value={lease.purchaseOptionAmount}
        >
          <NumberControlled
            name="purchaseOptionAmount"
            label={t`Purchase Option`}
            inline
            isReadOnly={isDisabled}
            value={lease.purchaseOptionAmount ?? 0}
            minValue={0}
            step={moneyStep}
            formatOptions={moneyFormat}
            onChange={(value) => {
              onUpdate(
                "purchaseOptionAmount",
                value > 0 ? String(value) : null
              );
            }}
          />
        </PropertyForm>
        <PropertyForm
          name="purchaseOptionReasonablyCertain"
          value={lease.purchaseOptionReasonablyCertain}
        >
          <Boolean
            name="purchaseOptionReasonablyCertain"
            label={t`Purchase option reasonably certain`}
            variant="small"
            isDisabled={isDisabled || !lease.purchaseOptionAmount}
            onChange={(value) => {
              onUpdate("purchaseOptionReasonablyCertain", value ? "on" : "off");
            }}
          />
        </PropertyForm>
        <PropertyForm
          name="ownershipTransfers"
          value={lease.ownershipTransfers}
        >
          <Boolean
            name="ownershipTransfers"
            label={t`Ownership transfers`}
            variant="small"
            isDisabled={isDisabled}
            onChange={(value) => {
              onUpdate("ownershipTransfers", value ? "on" : "off");
            }}
          />
        </PropertyForm>
        <PropertyForm name="specializedAsset" value={lease.specializedAsset}>
          <Boolean
            name="specializedAsset"
            label={t`Specialized asset`}
            variant="small"
            isDisabled={isDisabled}
            onChange={(value) => {
              onUpdate("specializedAsset", value ? "on" : "off");
            }}
          />
        </PropertyForm>
      </VStack>

      <VStack spacing={2}>
        <span className="text-xs font-medium text-muted-foreground">
          <Trans>Created By</Trans>
        </span>
        <EmployeeAvatar employeeId={lease.createdBy} />
      </VStack>

      <CustomFormInlineFields
        customFields={(lease.customFields ?? {}) as Record<string, Json>}
        table="lease"
        tags={[]}
        onUpdate={onUpdateCustomFields}
      />
    </VStack>
  );
};

export default LeaseProperties;
