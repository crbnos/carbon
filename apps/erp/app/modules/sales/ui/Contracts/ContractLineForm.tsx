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
import type { ContractBillingBasis } from "@carbon/utils";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  BillingElement,
  DatePicker,
  Hidden,
  Input,
  Item,
  Number,
  Select,
  SelectControlled,
  Submit
} from "~/components/Form";
import { ConfirmDelete } from "~/components/Modals";
import { useCurrencyDecimals, usePermissions, useRouteData } from "~/hooks";
import { usePlanGate } from "~/hooks/usePlanGate";
import { path } from "~/utils/path";
import {
  contractBillingMethods,
  contractBillingMethodsFor,
  contractRateUnits,
  contractRevenueMethods,
  contractRevenueMethodsFor,
  contractRevenueTypes,
  customerContractLineValidator,
  isProjectBillingMethod
} from "../../sales.models";
import {
  ContractLineBillingFields,
  ProjectRevenueUpgrade,
  useBillingMethodLabels
} from "./ContractLineBillingFields";
import ContractProject from "./ContractProject";
import type { ContractRouteData } from "./types";

type ContractLineFormValues = z.infer<typeof customerContractLineValidator>;

type ContractLineFormProps = {
  /** Discount and tax in percent points (10 = 10%), as the form posts them. */
  initialValues: ContractLineFormValues;
  currencyCode: string;
  /** A service contract (`Schedule`) bills every line on its schedule, so it
   *  has no billing method. A project contract's line is One-time: Time &
   *  Materials, Cost Plus or Fixed Price. */
  billingBasis?: ContractBillingBasis | null;
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
  billingBasis,
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
  const { isGated: projectRevenueGated } = usePlanGate({
    feature: "PROJECT_REVENUE"
  });
  const [billingMethod, setBillingMethod] = useState(
    initialValues.billingMethod
  );
  const [revenueMethod, setRevenueMethod] = useState(
    initialValues.revenueMethod
  );
  const [projectId, setProjectId] = useState(initialValues.projectId ?? "");
  const [revenueType, setRevenueType] = useState(initialValues.revenueType);
  const [startDate, setStartDate] = useState(initialValues.startDate);
  const [lineItemNumber, setLineItemNumber] = useState(
    initialValues.lineItemNumber ?? ""
  );
  // A SubCLIN's parent is a CLIN (4 digits) of the same contract. A line
  // that a later amendment replaced is not a current line.
  const routeData = useRouteData<ContractRouteData>(
    path.to.contract(initialValues.customerContractId)
  );
  const contractLines = routeData?.lines ?? [];
  const replacedLineIds = new Set(
    contractLines.map((line) => line.amendsLineId).filter(Boolean)
  );
  const parentLineOptions = contractLines
    .filter(
      (line) =>
        line.id !== initialValues.id &&
        !replacedLineIds.has(line.id) &&
        line.lineItemNumber?.length === 4
    )
    .map((line) => ({
      value: line.id,
      label: `${line.lineItemNumber} — ${
        line.description || line.item?.name || line.itemId
      }`
    }));
  const isSubClin = lineItemNumber.trim().length === 6;
  const [showRevenue, setShowRevenue] = useState(
    initialValues.revenueMethod !== "Daily" ||
      !!initialValues.revenueStartDate ||
      !!initialValues.revenueEndDate
  );
  const [showDelete, setShowDelete] = useState(false);
  // As a modal the form closes once its save has settled (the action
  // redirects back with a flash).
  const submitted = useRef(false);
  useEffect(() => {
    if (type === "modal" && fetcher.state === "idle" && submitted.current) {
      submitted.current = false;
      onClose?.();
    }
  }, [type, fetcher.state, onClose]);

  const revenueTypeLabels: Record<
    (typeof contractRevenueTypes)[number],
    string
  > = {
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
    "Even Period": t`Even Period`,
    "Right to Invoice": t`Right to Invoice`,
    "Percent Complete": t`Percent Complete`
  };
  const billingMethodLabels = useBillingMethodLabels(billingBasis);

  // A billing line bills project work: no quantity, rate or schedule. The
  // revenue methods follow the billing method (plan decision P6); Percent
  // Complete on a Fixed line also needs a billing element. Every line of a
  // project contract is One-time at quantity 1: a Fixed Price line is its
  // price.
  const isProject = billingBasis === "Project";
  const isBilling = isProjectBillingMethod(billingMethod);
  const revenueMethods = contractRevenueMethodsFor(billingBasis, billingMethod);
  const needsBillingElement = isBilling || revenueMethod === "Percent Complete";
  // Cost Plus and Percent Complete are commercial (`PROJECT_REVENUE`): kept
  // visible, with an upgrade notice and Save disabled. The route action is
  // the lock.
  const choosesProjectRevenue =
    billingMethod === "Cost Plus" || revenueMethod === "Percent Complete";
  const showUpgrade = projectRevenueGated && choosesProjectRevenue;

  const changeBillingMethod = (
    next: (typeof contractBillingMethods)[number]
  ) => {
    setBillingMethod(next);
    const allowed = contractRevenueMethodsFor(billingBasis, next);
    if (!allowed.includes(revenueMethod)) {
      setRevenueMethod(allowed[0]);
    }
    if (isProjectBillingMethod(next)) setShowRevenue(true);
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
            onSubmit={() => {
              submitted.current = true;
            }}
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
                  {isProject ? (
                    <Select
                      name="billingMethod"
                      label={t`Billing Method`}
                      termId="billing-method"
                      options={contractBillingMethodsFor("Project").map(
                        (value) => ({
                          value,
                          label: billingMethodLabels[value]
                        })
                      )}
                      onChange={(option) => {
                        const next = contractBillingMethods.find(
                          (value) => value === option?.value
                        );
                        if (next) changeBillingMethod(next);
                      }}
                    />
                  ) : (
                    // A service contract bills every line on its schedule.
                    <Hidden name="billingMethod" />
                  )}
                  <Item
                    name="itemId"
                    label={t`Service`}
                    type="Service"
                    isReadOnly={isLocked}
                  />
                  {isBilling ? (
                    // A billing line is One-time at quantity 1 and rate 0
                    // (`customerContractLine_billing_check`); its price comes
                    // from the billable items.
                    <>
                      <Hidden name="revenueType" value="One-time" />
                      <Hidden name="quantity" value={1} />
                      <Hidden name="rate" value={0} />
                      <Hidden name="discountPercent" value={0} />
                    </>
                  ) : isProject ? (
                    // A Fixed Price line is One-time at quantity 1: its rate
                    // is its price.
                    <>
                      <Hidden name="revenueType" value="One-time" />
                      <Hidden name="quantity" value={1} />
                      <Hidden name="discountPercent" value={0} />
                    </>
                  ) : (
                    <Select
                      name="revenueType"
                      label={t`Revenue Type`}
                      options={contractRevenueTypes.map((value) => ({
                        value,
                        label: revenueTypeLabels[value]
                      }))}
                      onChange={(option) => {
                        const next = contractRevenueTypes.find(
                          (value) => value === option?.value
                        );
                        if (next) setRevenueType(next);
                      }}
                    />
                  )}
                  <Input
                    name="description"
                    label={t`Description`}
                    helperText={t`Shown to the customer on the invoice`}
                  />
                  <Input
                    name="lineItemNumber"
                    label={t`CLIN / SLIN`}
                    termId="clin"
                    helperText={t`4 digits for a CLIN; 2 letters or digits more for a SubCLIN`}
                    onChange={(event) => setLineItemNumber(event.target.value)}
                  />
                  {/* Unmounted for a CLIN: only a SubCLIN has a parent. */}
                  {isSubClin && (
                    <Select
                      name="parentLineId"
                      label={t`Parent CLIN`}
                      options={parentLineOptions}
                    />
                  )}
                </div>

                {showUpgrade && billingMethod === "Cost Plus" && (
                  <ProjectRevenueUpgrade />
                )}

                {isBilling ? (
                  <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 border-t border-border pt-4">
                    <ContractLineBillingFields
                      billingMethod={billingMethod}
                      projectId={projectId}
                      currencyCode={currencyCode}
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
                ) : isProject ? (
                  <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 border-t border-border pt-4">
                    <Number
                      name="rate"
                      label={t`Price`}
                      helperText={t`Billed on the line's billing events`}
                      minValue={0}
                      step={INPUT_STEP.money(currencyDecimals)}
                      formatOptions={INPUT_FORMAT.money(
                        currencyCode,
                        currencyDecimals
                      )}
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
                ) : (
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
                    {revenueType === "Recurring" && (
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
                )}

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
                  {/* A project line is earned by its billing method, not
                      from a go-live date. */}
                  {!isProject && (
                    <DatePicker
                      name="goLiveDate"
                      label={t`Go-Live Date`}
                      minValue={minDate}
                    />
                  )}
                  <ContractProject
                    name="projectId"
                    label={t`Project`}
                    isReadOnly={isLocked}
                    onChange={(option) => setProjectId(option?.value ?? "")}
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
                    <SelectControlled
                      name="revenueMethod"
                      label={t`Revenue Method`}
                      termId="revenue-method"
                      value={revenueMethod}
                      options={revenueMethods.map((value) => ({
                        value,
                        label: revenueMethodLabels[value]
                      }))}
                      onChange={(option) => {
                        const next = contractRevenueMethods.find(
                          (value) => value === option?.value
                        );
                        if (next) setRevenueMethod(next);
                      }}
                    />
                    {/* A Fixed line recognized by progress needs the element
                        whose cost measures it. */}
                    {!isBilling && needsBillingElement && (
                      <BillingElement
                        name="projectElementId"
                        projectId={projectId}
                        helperText={t`Progress is this element's cost against its estimate at completion`}
                      />
                    )}
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
                  {showRevenue &&
                    showUpgrade &&
                    revenueMethod === "Percent Complete" &&
                    billingMethod !== "Cost Plus" && (
                      <div className="mt-4">
                        <ProjectRevenueUpgrade />
                      </div>
                    )}
                </div>
              </VStack>
            </ModalCardBody>
            {(type === "modal" || !isLocked) && (
              <ModalCardFooter>
                <HStack>
                  {!isLocked && (
                    <Submit isDisabled={isDisabled || showUpgrade}>
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
