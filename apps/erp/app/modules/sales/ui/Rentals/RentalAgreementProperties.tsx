// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Json } from "@carbon/database";
import {
  Boolean,
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
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useCallback, useEffect } from "react";
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
  Location,
  PaymentTerm
} from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import { useCurrencyDecimals, usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import { rentalBillingCycles, rentalBillingTimings } from "../../sales.models";
import type { RentalAgreement, RentalAgreementRouteData } from "./types";

type Term =
  | "customerId"
  | "customerLocationId"
  | "customerContactId"
  | "salesPersonId"
  | "locationId"
  | "startDate"
  | "endDate"
  | "billingCycle"
  | "billingTiming"
  | "paymentTermId"
  | "currencyCode"
  | "depositAmount"
  | "taxPercent"
  | "discountRate"
  | "ownershipTransfers"
  | "specializedAsset"
  | "purchaseOptionAmount"
  | "purchaseOptionReasonablyCertain"
  | "notes";

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

/** The agreement's terms, in the properties panel every document with an
 *  explorer has. Editable while Draft; after activation they are fixed (the
 *  billing periods and the lease classification were cut from them) and read
 *  only. */
const RentalAgreementProperties = () => {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<RentalAgreementRouteData>(
    path.to.rentalAgreement(id)
  );
  const agreement = routeData?.rentalAgreement;
  const permissions = usePermissions();
  const currencyCode = agreement?.currencyCode ?? "";
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
      const current = agreement?.[field as keyof RentalAgreement];
      if ((current ?? null) === (value ?? null) || String(current) === value) {
        return;
      }
      const formData = new FormData();
      formData.append("id", id);
      formData.append("field", field);
      formData.append("value", value ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.rentalAgreementUpdate
      });
    },
    [id, agreement]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is stable
  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();
      formData.append("ids", id);
      formData.append("table", "rentalAgreement");
      formData.append("value", value);
      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields
      });
    },
    [id]
  );

  if (!agreement) return null;

  const isDisabled =
    agreement.status !== "Draft" || !permissions.can("update", "sales");
  const moneyFormat = INPUT_FORMAT.money(currencyCode, currencyDecimals);
  const moneyStep = INPUT_STEP.money(currencyDecimals);
  // Only a fixed term can be a sales-type lease, so these inputs matter only
  // once there is an end date.
  const hasEndDate = !!agreement.endDate;

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
                      window.location.origin +
                        path.to.rentalAgreementDetails(id)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy link to agreement</Trans>
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
                    copyToClipboard(agreement.rentalAgreementId ?? "")
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy agreement number</Trans>
                </span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm">{agreement.rentalAgreementId}</span>
      </VStack>

      <PropertyForm name="customerId" value={agreement.customerId}>
        <Customer
          name="customerId"
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) onUpdate("customerId", value.value);
          }}
        />
      </PropertyForm>
      <PropertyForm
        name="customerLocationId"
        value={agreement.customerLocationId}
      >
        <CustomerLocation
          name="customerLocationId"
          label={t`Rental Site`}
          customer={agreement.customerId ?? ""}
          inline
          isReadOnly={isDisabled}
          onChange={(location) => {
            if (location?.id) onUpdate("customerLocationId", location.id);
          }}
        />
      </PropertyForm>
      <PropertyForm
        name="customerContactId"
        value={agreement.customerContactId}
      >
        <CustomerContact
          name="customerContactId"
          label={t`Customer Contact`}
          customer={agreement.customerId ?? ""}
          inline
          isReadOnly={isDisabled}
          onChange={(contact) => {
            if (contact?.id) onUpdate("customerContactId", contact.id);
          }}
        />
      </PropertyForm>
      <PropertyForm name="salesPersonId" value={agreement.salesPersonId}>
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
      <PropertyForm name="locationId" value={agreement.locationId}>
        <Location
          name="locationId"
          label={t`Shipping Location`}
          inline
          isReadOnly={isDisabled}
          onChange={(location) => {
            if (location?.value) onUpdate("locationId", location.value);
          }}
        />
      </PropertyForm>
      <PropertyForm name="startDate" value={agreement.startDate}>
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
      <PropertyForm name="endDate" value={agreement.endDate}>
        <DatePicker
          name="endDate"
          label={t`End Date`}
          inline
          isDisabled={isDisabled}
          onChange={(date) => {
            onUpdate("endDate", date || null);
          }}
        />
      </PropertyForm>
      <PropertyForm name="billingCycle" value={agreement.billingCycle}>
        <Select
          name="billingCycle"
          label={t`Billing Cycle`}
          termId="billing-cycle"
          inline={(value) => <span>{value}</span>}
          isReadOnly={isDisabled}
          options={rentalBillingCycles.map((cycle) => ({
            value: cycle,
            label: cycle
          }))}
          onChange={(option) => {
            if (option?.value) onUpdate("billingCycle", option.value);
          }}
        />
      </PropertyForm>
      <PropertyForm name="billingTiming" value={agreement.billingTiming}>
        <Select
          name="billingTiming"
          label={t`Billing Timing`}
          termId="billing-timing"
          inline={(value) => <span>{value}</span>}
          isReadOnly={isDisabled}
          options={rentalBillingTimings.map((timing) => ({
            value: timing,
            label: timing
          }))}
          onChange={(option) => {
            if (option?.value) onUpdate("billingTiming", option.value);
          }}
        />
      </PropertyForm>
      <PropertyForm name="paymentTermId" value={agreement.paymentTermId}>
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
      <PropertyForm name="currencyCode" value={agreement.currencyCode}>
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
      <PropertyForm name="depositAmount" value={agreement.depositAmount}>
        <NumberControlled
          name="depositAmount"
          label={t`Deposit`}
          inline
          isReadOnly={isDisabled}
          value={agreement.depositAmount ?? 0}
          minValue={0}
          step={moneyStep}
          formatOptions={moneyFormat}
          onChange={(value) => {
            onUpdate("depositAmount", String(Number.isNaN(value) ? 0 : value));
          }}
        />
      </PropertyForm>
      <PropertyForm name="taxPercent" value={agreement.taxPercent}>
        <NumberControlled
          name="taxPercent"
          label={t`Tax Percent`}
          inline
          isReadOnly={isDisabled}
          value={agreement.taxPercent ?? 0}
          minValue={0}
          maxValue={1}
          step={INPUT_STEP.percent}
          formatOptions={INPUT_FORMAT.percent}
          onChange={(value) => {
            onUpdate("taxPercent", String(Number.isNaN(value) ? 0 : value));
          }}
        />
      </PropertyForm>

      <VStack spacing={4} className="w-full border-t border-border pt-4">
        <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
          <Trans>Accounting Treatment</Trans>
        </h3>
        <PropertyForm name="discountRate" value={agreement.discountRate}>
          <NumberControlled
            name="discountRate"
            label={t`Discount Rate (%)`}
            inline
            isReadOnly={isDisabled}
            value={agreement.discountRate ?? 0}
            minValue={0}
            step={INPUT_STEP.percent}
            formatOptions={INPUT_FORMAT.percentPoints}
            onChange={(value) => {
              onUpdate("discountRate", String(Number.isNaN(value) ? 0 : value));
            }}
          />
        </PropertyForm>
        <PropertyForm
          name="purchaseOptionAmount"
          value={agreement.purchaseOptionAmount}
        >
          <NumberControlled
            name="purchaseOptionAmount"
            label={t`Purchase Option`}
            inline
            isReadOnly={isDisabled}
            value={agreement.purchaseOptionAmount ?? 0}
            minValue={0}
            step={moneyStep}
            formatOptions={moneyFormat}
            onChange={(value) => {
              // An emptied input commits NaN; no option is null, not 0.
              onUpdate(
                "purchaseOptionAmount",
                value > 0 ? String(value) : null
              );
            }}
          />
        </PropertyForm>
        <PropertyForm
          name="purchaseOptionReasonablyCertain"
          value={agreement.purchaseOptionReasonablyCertain}
        >
          <Boolean
            name="purchaseOptionReasonablyCertain"
            label={t`Purchase option reasonably certain`}
            variant="small"
            isDisabled={
              isDisabled || !hasEndDate || !agreement.purchaseOptionAmount
            }
            onChange={(value) => {
              onUpdate("purchaseOptionReasonablyCertain", value ? "on" : "off");
            }}
          />
        </PropertyForm>
        <PropertyForm
          name="ownershipTransfers"
          value={agreement.ownershipTransfers}
        >
          <Boolean
            name="ownershipTransfers"
            label={t`Ownership transfers`}
            variant="small"
            isDisabled={isDisabled || !hasEndDate}
            onChange={(value) => {
              onUpdate("ownershipTransfers", value ? "on" : "off");
            }}
          />
        </PropertyForm>
        <PropertyForm
          name="specializedAsset"
          value={agreement.specializedAsset}
        >
          <Boolean
            name="specializedAsset"
            label={t`Specialized asset`}
            variant="small"
            isDisabled={isDisabled || !hasEndDate}
            onChange={(value) => {
              onUpdate("specializedAsset", value ? "on" : "off");
            }}
          />
        </PropertyForm>
        {!hasEndDate && (
          <p className="text-xs text-muted-foreground">
            <Trans>
              An open-ended agreement is always a rental. Set an end date to use
              these.
            </Trans>
          </p>
        )}
      </VStack>

      <PropertyForm name="notes" value={agreement.notes}>
        <InputControlled
          name="notes"
          label={t`Notes`}
          size="sm"
          inline
          isReadOnly={isDisabled}
          value={agreement.notes ?? ""}
          onBlur={(e) => {
            onUpdate("notes", e.target.value || null);
          }}
        />
      </PropertyForm>

      <VStack spacing={2}>
        <span className="text-xs font-medium text-muted-foreground">
          <Trans>Created By</Trans>
        </span>
        <EmployeeAvatar employeeId={agreement.createdBy} />
      </VStack>

      <CustomFormInlineFields
        customFields={(agreement.customFields ?? {}) as Record<string, Json>}
        table="rentalAgreement"
        tags={[]}
        onUpdate={onUpdateCustomFields}
      />
    </VStack>
  );
};

export default RentalAgreementProperties;
