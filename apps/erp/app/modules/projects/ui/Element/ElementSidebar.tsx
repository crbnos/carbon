// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { Button, Copy, cn, Progress, VStack } from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { LuBuilding2 } from "react-icons/lu";
import { Link } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { Employee, MultiSelect } from "~/components/Form";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePermissions,
  useUser
} from "~/hooks";
import { usePlanGate } from "~/hooks/usePlanGate";
import { useSettings } from "~/hooks/useSettings";
import FixedAssetStatus from "~/modules/accounting/ui/FixedAssets/FixedAssetStatus";
import { path } from "~/utils/path";
import type {
  CostTotals,
  ProjectCostObjective,
  ProjectCostTreatment
} from "../../projects.models";
import {
  projectElementPriorities,
  rdComponentTypes,
  rdSoftwareTypes,
  rollUpCostSummary
} from "../../projects.models";
import type { ProjectElementPage } from "../../projects.server";
import type { ProjectLabel, ProjectMilestone, ProjectState } from "../../types";
import {
  ElementPriorityIcon,
  sortStates,
  useElementField,
  usePriorityLabels
} from "../Elements/ElementProperties";
import { useElementTypeLabels } from "../Elements/ElementTypeIcon";
import { StateIcon } from "../Project/StateIcon";
import {
  useRdComponentTypeLabels,
  useRdSoftwareTypeLabels
} from "../RdTax/useRdTaxLabels";
import ElementEarnedValue from "./ElementEarnedValue.ee";
import { PartLink } from "./PartLink";
import { PlaceInServiceModal } from "./PlaceInServiceModal";
import {
  PropertyDate,
  PropertyField,
  PropertyGroup,
  PropertyNumber,
  PropertySelect,
  PropertySwitch
} from "./PropertyFields";

type Element = ProjectElementPage["element"];
type ListElement = ProjectElementPage["elements"][number];
type CapitalAsset = ProjectElementPage["capitalAsset"];

const NO_COST: CostTotals = {
  plan: 0,
  committed: 0,
  actual: 0,
  unallowable: 0,
  hours: 0
};

/**
 * The element page's right column, in the inline pattern of the app's
 * properties panels: the element's properties, each saving on its own, then
 * the fields that apply to its type, its costs, and the government
 * contracting fields (only with DCAA timekeeping, Layer 5).
 */
export function ElementSidebar({
  projectId,
  element,
  elements,
  capitalAsset,
  costTreatment,
  costObjective,
  costSummary,
  states,
  labels,
  milestones,
  typeBlock,
  isDisabled,
  className
}: {
  projectId: string;
  element: Element;
  elements: ListElement[];
  capitalAsset: CapitalAsset;
  costTreatment: ProjectCostTreatment | null;
  costObjective: ProjectCostObjective | null;
  costSummary: ProjectElementPage["costSummary"];
  states: ProjectState[];
  labels: ProjectLabel[];
  milestones: ProjectMilestone[];
  /** The Requirement, Test Case or Parameter fields, when the type has them. */
  typeBlock?: ReactNode;
  isDisabled: boolean;
  className?: string;
}) {
  const { t } = useLingui();
  const typeLabels = useElementTypeLabels();
  const priorityLabels = usePriorityLabels();
  const formatMoney = useCurrencyFormatter();
  const { company } = useUser();
  const currency = company.baseCurrencyCode;
  const decimals = useCurrencyDecimals(currency);
  const settings = useSettings();
  const { isGated: isGovernmentGated } = usePlanGate({
    feature: "GOVERNMENT_CONTRACTING"
  });
  // The government fields need DCAA timekeeping. With DCAA on and the
  // feature gated, only earned value's upgrade row shows.
  const isDcaa = settings.timekeepingControls === "DCAA";
  const common = { projectId, elementId: element.id, isDisabled };

  const children = elements.filter((e) => e.parentId === element.id);
  const completed = children.filter(
    (child) => child.state?.group === "Completed"
  ).length;

  const stateOptions = useMemo(
    () =>
      sortStates(states).map((state) => ({
        value: state.id,
        label: (
          <span className="flex items-center gap-2">
            <StateIcon group={state.group} color={state.color} />
            <span>{state.name}</span>
          </span>
        )
      })),
    [states]
  );

  // The element with its children: plan, actual and what is left of the
  // budget (or of the plan when no budget is set).
  const costs = useMemo(() => {
    const { byElement } = rollUpCostSummary(elements, costSummary);
    const totals = byElement.get(element.id) ?? NO_COST;
    const childrenOf = new Map<string, string[]>();
    for (const e of elements) {
      if (!e.parentId) continue;
      childrenOf.set(e.parentId, [...(childrenOf.get(e.parentId) ?? []), e.id]);
    }
    const budgets = new Map(elements.map((e) => [e.id, e.budget]));
    let budget: number | null = null;
    const stack = [element.id];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const value = budgets.get(id);
      if (value !== null && value !== undefined) {
        budget = (budget ?? 0) + Number(value);
      }
      stack.push(...(childrenOf.get(id) ?? []));
    }
    return {
      ...totals,
      remaining: (budget ?? totals.plan) - totals.committed - totals.actual
    };
  }, [elements, costSummary, element.id]);
  const hasCosts =
    costs.plan !== 0 || costs.committed !== 0 || costs.actual !== 0;
  const money = (value: number) => (
    <span className={cn("tabular-nums", value < 0 && "text-red-500")}>
      {formatMoney.format(value)}
    </span>
  );

  return (
    <VStack spacing={8} className={cn("text-sm", className)}>
      <PropertyGroup>
        <PropertySelect
          {...common}
          field="stateId"
          label={t`State`}
          value={element.stateId}
          options={stateOptions}
          isOptional={false}
        />
        <OwnerField {...common} ownerId={element.ownerId} />
        <PropertySelect
          {...common}
          field="priority"
          label={t`Priority`}
          value={element.priority ?? "None"}
          isOptional={false}
          options={projectElementPriorities.map((priority) => ({
            value: priority,
            label: (
              <span className="flex items-center gap-2">
                <ElementPriorityIcon priority={priority} />
                <span>{priorityLabels[priority]}</span>
              </span>
            )
          }))}
        />
        <PropertySelect
          {...common}
          field="milestoneId"
          label={t`Milestone`}
          value={element.milestoneId}
          options={milestones.map((milestone) => ({
            value: milestone.id,
            label: milestone.name
          }))}
        />
        <PropertyDate
          {...common}
          field="startDate"
          label={t`Start date`}
          value={element.startDate}
        />
        <PropertyDate
          {...common}
          field="targetDate"
          label={t`Target date`}
          value={element.targetDate}
        />
        <LabelsField
          {...common}
          labelIds={(element.labels ?? []).map((l) => l.projectLabelId)}
          labels={labels}
        />
        {children.length > 0 && (
          <PropertyField label={t`Children`}>
            <div className="flex w-full items-center gap-2">
              <span className="shrink-0 whitespace-nowrap tabular-nums">
                {t`${completed} of ${children.length} done`}
              </span>
              <Progress
                value={(completed / children.length) * 100}
                aria-label={t`Children done`}
                className="h-1.5 min-w-0"
                indicatorClassName="bg-foreground/70"
              />
            </div>
          </PropertyField>
        )}
      </PropertyGroup>

      {typeBlock && (
        <PropertyGroup title={typeLabels[element.type]}>
          {typeBlock}
        </PropertyGroup>
      )}

      <PropertyGroup title={t`Work`}>
        <PropertySwitch
          {...common}
          field="isChargeable"
          label={t`Chargeable`}
          value={element.isChargeable}
          isDisabled={isDisabled || element.type === "Parameter"}
        />
        <PropertyNumber
          {...common}
          field="budget"
          label={t`Budget`}
          value={element.budget === null ? null : Number(element.budget)}
          formatOptions={INPUT_FORMAT.money(currency, decimals)}
          step={INPUT_STEP.money(decimals)}
          minValue={0}
        />
        <PropertyNumber
          {...common}
          field="estimatedHours"
          label={t`Hours estimate`}
          value={
            element.estimatedHours === null
              ? null
              : Number(element.estimatedHours)
          }
          formatOptions={INPUT_FORMAT.quantity}
          step={INPUT_STEP.quantity}
          minValue={0}
        />
        {element.type !== "Parameter" && (
          <PartLink
            projectId={projectId}
            element={element}
            isDisabled={isDisabled}
          />
        )}
        {costTreatment === "Capitalize" && element.type !== "Parameter" && (
          <>
            <PropertySwitch
              {...common}
              field="isFinalAsset"
              label={t`Final asset`}
              value={element.isFinalAsset}
            />
            {element.isFinalAsset && (
              <PropertyField label={t`Asset`}>
                <CapitalAssetLink projectId={projectId} asset={capitalAsset} />
              </PropertyField>
            )}
          </>
        )}
      </PropertyGroup>

      {hasCosts && (
        <PropertyGroup title={t`Costs, with children`}>
          <PropertyField label={t`Plan`}>{money(costs.plan)}</PropertyField>
          <PropertyField label={t`Committed`}>
            {money(costs.committed)}
          </PropertyField>
          <PropertyField label={t`Actual`}>{money(costs.actual)}</PropertyField>
          <PropertyField label={t`Remaining`}>
            {money(costs.remaining)}
          </PropertyField>
          <Link
            to={path.to.projectCostsElement(projectId, element.id)}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            <Trans>View costs</Trans>
          </Link>
        </PropertyGroup>
      )}

      {element.type !== "Parameter" &&
        isDcaa &&
        (isGovernmentGated ? (
          <ElementEarnedValue
            projectId={projectId}
            element={element}
            elements={elements}
            isDisabled={isDisabled}
          />
        ) : (
          <PropertyGroup title={t`Government contracting`}>
            <PropertyField label={t`Charge number`}>
              <span className="flex items-center gap-1">
                <span className="whitespace-nowrap tabular-nums">
                  {element.readableId}
                </span>
                <Copy
                  text={element.readableId}
                  label={t`Copy charge number`}
                  variant="ghost"
                />
              </span>
            </PropertyField>
            <PropertySwitch
              {...common}
              field="isUnallowable"
              label={t`Unallowable`}
              termId="allowability"
              value={element.isUnallowable}
            />
            <PropertySwitch
              {...common}
              field="isPreproduction"
              label={t`Preproduction`}
              termId="preproduction"
              value={element.isPreproduction}
            />
            {costObjective === "Indirect" && (
              <PropertySwitch
                {...common}
                field="isLeave"
                label={t`Leave`}
                value={element.isLeave}
              />
            )}
            <BusinessComponentFields
              projectId={projectId}
              element={element}
              isDisabled={isDisabled}
            />
            <ElementEarnedValue
              projectId={projectId}
              element={element}
              elements={elements}
              isDisabled={isDisabled}
            />
          </PropertyGroup>
        ))}
    </VStack>
  );
}

/** The owner: the form `Employee` combobox in its inline mode. */
function OwnerField({
  projectId,
  elementId,
  ownerId,
  isDisabled
}: {
  projectId: string;
  elementId: string;
  ownerId: string | null;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const { pending, submit } = useElementField(projectId, elementId, "ownerId");
  const current = pending === undefined ? ownerId : pending;
  return (
    <ValidatedForm
      key={`ownerId:${ownerId ?? ""}`}
      defaultValues={{ ownerId: ownerId ?? "" }}
      validator={z.object({ ownerId: zfd.text(z.string().optional()) })}
      className="w-full"
    >
      <Employee
        name="ownerId"
        label={t`Owner`}
        inline
        isOptional
        isReadOnly={isDisabled}
        onChange={(option) => {
          const next = option?.value || null;
          if (next !== current) submit(next);
        }}
      />
    </ValidatedForm>
  );
}

/** The labels: the form `MultiSelect` in its inline mode. */
function LabelsField({
  projectId,
  elementId,
  labelIds,
  labels,
  isDisabled
}: {
  projectId: string;
  elementId: string;
  labelIds: string[];
  labels: ProjectLabel[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const { submit } = useElementField(projectId, elementId, "labelIds");
  return (
    <ValidatedForm
      key={`labelIds:${labelIds.join(",")}`}
      defaultValues={{ labelIds }}
      validator={z.object({ labelIds: z.array(z.string()).optional() })}
      className="w-full"
    >
      <MultiSelect
        name="labelIds"
        label={t`Labels`}
        inline
        isReadOnly={isDisabled}
        value={labelIds}
        options={labels.map((label) => ({
          value: label.id,
          label: label.name
        }))}
        onChange={(next) => {
          const ids = next.map((option) => option.value);
          submit(ids.length > 0 ? ids.join(",") : null);
        }}
      />
    </ValidatedForm>
  );
}

/**
 * R&D tax (Government Contracting 5d): the business component switch and,
 * while it is on, the component type and the optional software type of
 * Form 6765 Section G.
 */
function BusinessComponentFields({
  projectId,
  element,
  isDisabled
}: {
  projectId: string;
  element: Element;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const componentTypeLabels = useRdComponentTypeLabels();
  const softwareTypeLabels = useRdSoftwareTypeLabels();
  const common = { projectId, elementId: element.id, isDisabled };
  // The switch's own fetcher: its pending value shows the selects at once.
  const { pending } = useElementField(
    projectId,
    element.id,
    "isBusinessComponent"
  );
  const isOn =
    pending === undefined ? element.isBusinessComponent : pending === "true";

  return (
    <>
      <PropertySwitch
        {...common}
        field="isBusinessComponent"
        label={t`Business component (R&D)`}
        termId="business-component"
        value={element.isBusinessComponent}
      />
      {isOn && (
        <>
          <PropertySelect
            {...common}
            field="rdComponentType"
            label={t`Component type`}
            value={element.rdComponentType}
            options={rdComponentTypes.map((value) => ({
              value,
              label: componentTypeLabels[value]
            }))}
          />
          <PropertySelect
            {...common}
            field="rdSoftwareType"
            label={t`Software type`}
            value={element.rdSoftwareType}
            options={rdSoftwareTypes.map((value) => ({
              value,
              label: softwareTypeLabels[value]
            }))}
          />
        </>
      )}
    </>
  );
}

/** The final asset's asset, its status, and Place in service. */
function CapitalAssetLink({
  projectId,
  asset
}: {
  projectId: string;
  asset: CapitalAsset;
}) {
  const permissions = usePermissions();
  const [placing, setPlacing] = useState(false);
  if (!asset) {
    return (
      <span className="text-sm text-muted-foreground">
        <Trans>Created when the project is released</Trans>
      </span>
    );
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Link
        to={path.to.fixedAsset(asset.id)}
        className="font-mono text-sm hover:underline"
      >
        {asset.fixedAssetId}
      </Link>
      <FixedAssetStatus status={asset.status} />
      {asset.status === "Under Construction" && (
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<LuBuilding2 />}
          isDisabled={
            !permissions.can("create", "accounting") ||
            !permissions.can("update", "projects")
          }
          onClick={() => setPlacing(true)}
        >
          <Trans>Place in service</Trans>
        </Button>
      )}
      {placing && (
        <PlaceInServiceModal
          projectId={projectId}
          fixedAssetId={asset.id}
          onClose={() => setPlacing(false)}
        />
      )}
    </div>
  );
}
