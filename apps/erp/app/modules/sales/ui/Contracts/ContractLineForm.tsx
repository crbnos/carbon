// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  DatePicker,
  Hidden,
  Input,
  Item,
  Number,
  Select,
  Submit
} from "~/components/Form";
import { ConfirmDelete } from "~/components/Modals";
import { useCurrencyDecimals, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  contractRateUnits,
  contractRevenueMethods,
  customerContractLineKinds,
  customerContractLineValidator
} from "../../sales.models";
import ContractProject from "./ContractProject";

type ContractLineFormValues = z.infer<typeof customerContractLineValidator>;

type ContractLineFormProps = {
  /** Discount and tax in percent points (10 = 10%), as the form posts them. */
  initialValues: ContractLineFormValues;
  currencyCode: string;
  /** The line's name when editing — its description, else its item. */
  title?: string;
  /** Only a Draft contract's lines change; an Active one changes through
   *  Amend. */
  isLocked?: boolean;
  /** A card in the contract's center pane (new line or the line's own
   *  page), or a modal. */
  type?: "card" | "modal";
  onClose?: () => void;
};

/** One contract line: what it bills, when, and how its revenue falls. */
const ContractLineForm = ({
  initialValues,
  currencyCode,
  title,
  isLocked = false,
  type = "card",
  onClose
}: ContractLineFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const currencyDecimals = useCurrencyDecimals(currencyCode);

  const isEditing = initialValues.id !== undefined;
  const [kind, setKind] = useState(initialValues.kind);
  const [startDate, setStartDate] = useState(initialValues.startDate);
  const [showRevenue, setShowRevenue] = useState(
    initialValues.revenueMethod !== "Daily" ||
      !!initialValues.revenueStartDate ||
      !!initialValues.revenueEndDate
  );
  const [showDelete, setShowDelete] = useState(false);

  const kindLabels: Record<(typeof customerContractLineKinds)[number], string> =
    {
      "One-time": t`One-time`,
      Recurring: t`Recurring`
    };
  const rateUnitLabels: Record<(typeof contractRateUnits)[number], string> = {
    Day: t`Day`,
    Week: t`Week`,
    Month: t`Month`,
    Quarter: t`Quarter`,
    Year: t`Year`
  };
  const revenueMethodLabels: Record<
    (typeof contractRevenueMethods)[number],
    string
  > = {
    Daily: t`Daily`,
    "Even Period": t`Even Period`
  };

  const isDisabled =
    isLocked ||
    (isEditing
      ? !permissions.can("update", "sales")
      : !permissions.can("create", "sales"));
  const canDelete =
    isEditing && !isLocked && permissions.can("delete", "sales");

  const minDate = startDate ? safeParseDate(startDate) : undefined;
  const lineName = title ?? t`Line`;

  return (
    <ModalCardProvider type={type}>
      <ModalCard onClose={onClose}>
        <ModalCardContent size="xlarge">
          <ValidatedForm
            defaultValues={initialValues}
            validator={customerContractLineValidator}
            method="post"
            action={
              isEditing
                ? path.to.contractLine(
                    initialValues.customerContractId,
                    initialValues.id!
                  )
                : path.to.newContractLine(initialValues.customerContractId)
            }
            fetcher={fetcher}
            className="w-full"
            isDisabled={isLocked}
          >
            <ModalCardHeader>
              <ModalCardTitle>
                {isEditing ? lineName : <Trans>Add Line</Trans>}
              </ModalCardTitle>
              {isLocked && (
                <ModalCardDescription>
                  <Trans>Change lines with Amend.</Trans>
                </ModalCardDescription>
              )}
            </ModalCardHeader>
            <ModalCardBody>
              <Hidden name="id" />
              <Hidden name="customerContractId" />
              <VStack spacing={4}>
                <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                  <Item
                    name="itemId"
                    label={t`Service`}
                    type="Service"
                    isReadOnly={isLocked}
                  />
                  <Select
                    name="kind"
                    label={t`Kind`}
                    options={customerContractLineKinds.map((value) => ({
                      value,
                      label: kindLabels[value]
                    }))}
                    onChange={(option) => {
                      const next = customerContractLineKinds.find(
                        (value) => value === option?.value
                      );
                      if (next) setKind(next);
                    }}
                  />
                  <Input
                    name="description"
                    label={t`Description`}
                    helperText={t`Shown to the customer on the invoice`}
                  />
                </div>

                <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 border-t border-border pt-4">
                  <Number
                    name="quantity"
                    label={t`Quantity`}
                    minValue={0}
                    step={INPUT_STEP.quantity}
                    formatOptions={INPUT_FORMAT.quantity}
                  />
                  <Number
                    name="rate"
                    label={t`Rate`}
                    minValue={0}
                    step={INPUT_STEP.rate}
                    formatOptions={INPUT_FORMAT.rate(
                      currencyCode,
                      currencyDecimals
                    )}
                  />
                  {/* Unmounted for a one-time line: the validator refuses a
                      rate unit on one. */}
                  {kind === "Recurring" && (
                    <Select
                      name="rateUnit"
                      label={t`Per`}
                      options={contractRateUnits.map((value) => ({
                        value,
                        label: rateUnitLabels[value]
                      }))}
                    />
                  )}
                  <Number
                    name="discountPercent"
                    label={t`Discount (%)`}
                    minValue={0}
                    maxValue={100}
                    step={INPUT_STEP.percent}
                    formatOptions={INPUT_FORMAT.percentPoints}
                  />
                  <DatePicker
                    name="discountEndsOn"
                    label={t`Discount Ends On`}
                    minValue={minDate}
                  />
                  <Number
                    name="taxPercent"
                    label={t`Tax (%)`}
                    minValue={0}
                    maxValue={100}
                    step={INPUT_STEP.percent}
                    formatOptions={INPUT_FORMAT.percentPoints}
                  />
                </div>

                <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 border-t border-border pt-4">
                  <DatePicker
                    name="startDate"
                    label={t`Start Date`}
                    onChange={(date) => setStartDate(date ?? "")}
                  />
                  <DatePicker
                    name="endDate"
                    label={t`End Date`}
                    minValue={minDate}
                  />
                  <DatePicker
                    name="goLiveDate"
                    label={t`Go-Live Date`}
                    minValue={minDate}
                  />
                  <ContractProject
                    name="projectId"
                    label={t`Project`}
                    isReadOnly={isLocked}
                  />
                </div>

                <div className="w-full border-t border-border pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-2"
                    leftIcon={
                      showRevenue ? <LuChevronDown /> : <LuChevronRight />
                    }
                    onClick={() => setShowRevenue((open) => !open)}
                  >
                    <Trans>Revenue</Trans>
                  </Button>
                  {/* Hidden rather than unmounted: the fields must still post,
                      or saving with the section collapsed would clear them. */}
                  <div
                    className={
                      showRevenue
                        ? "mt-4 grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3"
                        : "hidden"
                    }
                  >
                    <Select
                      name="revenueMethod"
                      label={t`Revenue Method`}
                      options={contractRevenueMethods.map((value) => ({
                        value,
                        label: revenueMethodLabels[value]
                      }))}
                    />
                    <DatePicker
                      name="revenueStartDate"
                      label={t`Revenue Start`}
                      helperText={t`Defaults to the go-live or start date`}
                    />
                    <DatePicker
                      name="revenueEndDate"
                      label={t`Revenue End`}
                      helperText={t`Defaults to the end date`}
                    />
                  </div>
                </div>
              </VStack>
            </ModalCardBody>
            {(type === "modal" || !isLocked) && (
              <ModalCardFooter>
                <HStack>
                  {!isLocked && (
                    <Submit isDisabled={isDisabled}>
                      <Trans>Save</Trans>
                    </Submit>
                  )}
                  {canDelete && (
                    <Button
                      size="md"
                      variant="secondary"
                      onClick={() => setShowDelete(true)}
                    >
                      <Trans>Delete</Trans>
                    </Button>
                  )}
                  {type === "modal" && (
                    <Button size="md" variant="solid" onClick={onClose}>
                      {isLocked ? <Trans>Close</Trans> : <Trans>Cancel</Trans>}
                    </Button>
                  )}
                </HStack>
              </ModalCardFooter>
            )}
          </ValidatedForm>
        </ModalCardContent>
      </ModalCard>
      {/* Outside the line's form: a form inside another form's React tree
          would bubble its submit through the portal to the outer one. */}
      {showDelete && initialValues.id && (
        <ConfirmDelete
          action={path.to.deleteContractLine(
            initialValues.customerContractId,
            initialValues.id
          )}
          isOpen
          name={lineName}
          text={t`Are you sure you want to remove ${lineName} from this contract?`}
          onCancel={() => setShowDelete(false)}
          onSubmit={() => setShowDelete(false)}
        />
      )}
    </ModalCardProvider>
  );
};

/** A typed date as a picker bound; a half-typed one bounds nothing. */
function safeParseDate(date: string) {
  try {
    return parseDate(date);
  } catch {
    return undefined;
  }
}

export default ContractLineForm;
