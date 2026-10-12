// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import { Input, Status } from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { z } from "zod";
import { DateTime, EmployeeAvatar } from "~/components";
import { Select } from "~/components/Form";
import { usePercentFormatter, useQuantityFormatter } from "~/hooks";
import { path } from "~/utils/path";
import type {
  ParameterSource,
  RequirementCategory,
  RequirementTargetOperator,
  RequirementVerificationMethod,
  TestCaseVerdict
} from "../../projects.models";
import {
  formatAllocation,
  PARAMETER_ITEM_UNIT_COST,
  parameterSources,
  parseParameterFormula,
  requirementCategories,
  requirementTargetOperators,
  requirementVerificationMethods,
  testCaseVerdicts
} from "../../projects.models";
import type { ProjectElementPage } from "../../projects.server";
import {
  useActiveChangeRequestId,
  withChangeRequest
} from "../ChangeRequests/useActiveChangeRequest";
import { useElementField } from "../Elements/ElementProperties";
import { VerificationStatusText } from "../Elements/VerificationStatus";
import {
  PropertyCombobox,
  PropertyField,
  PropertyNumber,
  PropertySelect,
  PropertyText
} from "./PropertyFields";

type Element = ProjectElementPage["element"];

type ElementTypeBlockProps = {
  projectId: string;
  element: Element;
  elements: ProjectElementPage["elements"];
  verification: ProjectElementPage["verification"];
  requirementStatus: ProjectElementPage["requirementStatus"];
  qualityDocuments: ProjectElementPage["qualityDocuments"];
  itemFields: ProjectElementPage["itemFields"];
  isDisabled: boolean;
};

/** Whether the element type has a type block: Requirement, Test Case, Parameter. */
export function hasTypeBlock(type: Element["type"]) {
  return type === "Requirement" || type === "Test Case" || type === "Parameter";
}

/**
 * The fields of a Requirement (target, method, actual parameter, status), a
 * Test Case (verdict, procedure) or a Parameter (source, value, formula,
 * allocation, contingency, computed value). Each field saves on its own.
 */
export function ElementTypeBlock(props: ElementTypeBlockProps) {
  switch (props.element.type) {
    case "Requirement":
      return <RequirementBlock {...props} />;
    case "Test Case":
      return <TestCaseBlock {...props} />;
    case "Parameter":
      return <ParameterBlock {...props} />;
    default:
      return null;
  }
}

function useParameterOptions(elements: ProjectElementPage["elements"]) {
  return useMemo(
    () =>
      elements
        .filter((e) => e.type === "Parameter")
        .map((e) => ({ value: e.id, label: e.readableId, helper: e.name })),
    [elements]
  );
}

function RequirementBlock({
  projectId,
  element,
  elements,
  verification,
  requirementStatus,
  isDisabled
}: ElementTypeBlockProps) {
  const { t } = useLingui();
  const formatQuantity = useQuantityFormatter();
  const parameterOptions = useParameterOptions(elements);
  const common = { projectId, elementId: element.id, isDisabled };
  const own = verification[element.id];
  const { pending: pendingOperator } = useElementField(
    projectId,
    element.id,
    "targetOperator"
  );
  const operator =
    pendingOperator === undefined ? element.targetOperator : pendingOperator;

  const categoryLabels: Record<RequirementCategory, string> = {
    Functional: t`Functional`,
    Performance: t`Performance`,
    Interface: t`Interface`,
    Environmental: t`Environmental`,
    "Design Constraint": t`Design Constraint`
  };
  const operatorLabels: Record<RequirementTargetOperator, string> = {
    "≤": t`≤ at most`,
    "≥": t`≥ at least`,
    "=": t`= equal to`,
    Range: t`Range`
  };
  const methodLabels: Record<RequirementVerificationMethod, string> = {
    Test: t`Test`,
    Analysis: t`Analysis`,
    Inspection: t`Inspection`,
    Demonstration: t`Demonstration`
  };

  const parameter = element.actualParameterId
    ? verification[element.actualParameterId]
    : undefined;
  const actual =
    parameter?.kind === "Parameter" ? parameter.computedValue : null;
  const actualUnit = elements.find(
    (e) => e.id === element.actualParameterId
  )?.parameterUnit;

  return (
    <>
      <PropertySelect
        {...common}
        field="requirementCategory"
        label={t`Category`}
        value={element.requirementCategory}
        options={requirementCategories.map((value) => ({
          value,
          label: categoryLabels[value]
        }))}
      />
      <PropertySelect
        {...common}
        field="targetOperator"
        label={t`Target`}
        value={element.targetOperator}
        options={requirementTargetOperators.map((value) => ({
          value,
          label: operatorLabels[value]
        }))}
      />
      {operator && (
        <PropertyNumber
          {...common}
          field="targetValue"
          label={operator === "Range" ? t`Lower value` : t`Target value`}
          value={numberOrNull(element.targetValue)}
          formatOptions={INPUT_FORMAT.quantity}
          step={INPUT_STEP.quantity}
        />
      )}
      {operator === "Range" && (
        <PropertyNumber
          {...common}
          field="targetUpperValue"
          label={t`Upper value`}
          value={numberOrNull(element.targetUpperValue)}
          formatOptions={INPUT_FORMAT.quantity}
          step={INPUT_STEP.quantity}
        />
      )}
      {operator && (
        <PropertyText
          {...common}
          field="targetUnit"
          label={t`Unit`}
          value={element.targetUnit}
        />
      )}
      <PropertySelect
        {...common}
        field="verificationMethod"
        label={t`Verification method`}
        value={element.verificationMethod}
        options={requirementVerificationMethods.map((value) => ({
          value,
          label: methodLabels[value]
        }))}
      />
      <PropertyCombobox
        {...common}
        field="actualParameterId"
        label={t`Actual parameter`}
        value={element.actualParameterId}
        options={parameterOptions}
      />
      {element.actualParameterId && (
        <PropertyField label={t`Actual value`}>
          <span className="tabular-nums">
            {actual === null ? (
              <span className="text-muted-foreground">
                <Trans>No value</Trans>
              </span>
            ) : (
              `${formatQuantity(actual)}${actualUnit ? ` ${actualUnit}` : ""}`
            )}
          </span>
        </PropertyField>
      )}
      <PropertyField label={t`Verification`}>
        <span className="flex items-center gap-2">
          <VerificationStatusText status={requirementStatus[element.id]} />
          {own?.kind === "Requirement" && own.checkCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {own.checkCount === 1 ? t`1 check` : t`${own.checkCount} checks`}
            </span>
          )}
        </span>
      </PropertyField>
    </>
  );
}

function TestCaseBlock({
  projectId,
  element,
  qualityDocuments,
  isDisabled
}: ElementTypeBlockProps) {
  const { t } = useLingui();
  const common = { projectId, elementId: element.id, isDisabled };
  const verdictLabels: Record<TestCaseVerdict, string> = {
    "Not Run": t`Not Run`,
    Pass: t`Pass`,
    Fail: t`Fail`,
    Inconclusive: t`Inconclusive`
  };
  return (
    <>
      <PropertySelect
        {...common}
        field="verdict"
        label={t`Verdict`}
        value={element.verdict}
        options={testCaseVerdicts.map((value) => ({
          value,
          label: verdictLabels[value]
        }))}
      />
      <PropertyCombobox
        {...common}
        field="qualityDocumentId"
        label={t`Procedure`}
        value={element.qualityDocumentId}
        options={qualityDocuments.map((doc) => ({
          value: doc.id,
          label: doc.name,
          helper: t`Version ${doc.version}`
        }))}
        renderValue={(value) => (
          <Link
            to={path.to.qualityDocument(value)}
            className="truncate hover:underline"
          >
            {qualityDocuments.find((doc) => doc.id === value)?.name ?? value}
          </Link>
        )}
      />
      {element.verdictAt && element.verdictBy && (
        <PropertyField label={t`Last run`}>
          <span className="inline-flex items-center gap-2">
            <EmployeeAvatar employeeId={element.verdictBy} size="xxs" />
            <DateTime value={element.verdictAt} />
          </span>
        </PropertyField>
      )}
    </>
  );
}

function ParameterBlock({
  projectId,
  element,
  elements,
  verification,
  itemFields,
  isDisabled
}: ElementTypeBlockProps) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const formatQuantity = useQuantityFormatter();
  const percentFormatter = usePercentFormatter();
  const common = { projectId, elementId: element.id, isDisabled };
  const { pending: pendingSource, submit: submitSource } = useElementField(
    projectId,
    element.id,
    "parameterSource"
  );
  // Formula is picked here before a formula exists: the formula save sets
  // the source, because the database needs a formula with it.
  const [formulaDraft, setFormulaDraft] = useState(false);
  const source: ParameterSource =
    (pendingSource === undefined
      ? element.parameterSource
      : (pendingSource as ParameterSource | null)) ?? "Manual";
  const shownSource: ParameterSource = formulaDraft ? "Formula" : source;

  const sourceLabels: Record<ParameterSource, string> = {
    Manual: t`Manual`,
    Sum: t`Sum of children`,
    Min: t`Smallest child`,
    Max: t`Largest child`,
    Formula: t`Formula`,
    Item: t`Linked part`
  };

  const own = verification[element.id];
  const result = own?.kind === "Parameter" ? own : null;
  const unit = element.parameterUnit;
  const withUnit = (value: number) =>
    `${formatQuantity(value)}${unit ? ` ${unit}` : ""}`;
  const contingency = Number(element.parameterContingencyPercent ?? 0);

  return (
    <>
      <ValidatedForm
        key={`parameterSource:${shownSource}`}
        defaultValues={{ parameterSource: shownSource }}
        validator={z.object({ parameterSource: z.string().min(1) })}
        className="w-full"
      >
        <Select
          name="parameterSource"
          label={t`Source`}
          isReadOnly={isDisabled}
          options={parameterSources.map((value) => ({
            value,
            label: sourceLabels[value]
          }))}
          inline={(value) => (
            <span>{sourceLabels[value as ParameterSource] ?? value}</span>
          )}
          onChange={(option) => {
            const next = option?.value;
            if (!next || next === shownSource) return;
            if (next === "Formula" && !element.parameterFormula) {
              setFormulaDraft(true);
              return;
            }
            setFormulaDraft(false);
            submitSource(next);
          }}
        />
      </ValidatedForm>
      {shownSource === "Manual" && (
        <PropertyNumber
          {...common}
          field="parameterValue"
          label={t`Value`}
          value={numberOrNull(element.parameterValue)}
          formatOptions={INPUT_FORMAT.quantity}
          step={INPUT_STEP.quantity}
        />
      )}
      <PropertyText
        {...common}
        field="parameterUnit"
        label={t`Unit`}
        value={element.parameterUnit}
      />
      {shownSource === "Formula" && (
        <PropertyField label={t`Formula`}>
          <FormulaField
            projectId={projectId}
            elementId={element.id}
            formula={element.parameterFormula}
            elements={elements}
            isDisabled={isDisabled}
            onSaved={() => setFormulaDraft(false)}
          />
        </PropertyField>
      )}
      {shownSource === "Item" && (
        <PropertySelect
          {...common}
          field="parameterItemField"
          label={t`Part field`}
          value={element.parameterItemField ?? PARAMETER_ITEM_UNIT_COST}
          isOptional={false}
          options={[
            { value: PARAMETER_ITEM_UNIT_COST, label: t`Unit cost` },
            ...itemFields.map((field) => ({
              value: field.id,
              label: field.name
            }))
          ]}
        />
      )}
      <PropertyNumber
        {...common}
        field="allocationPercent"
        label={t`Allocation`}
        value={numberOrNull(element.allocationPercent)}
        formatOptions={INPUT_FORMAT.percent}
        step={INPUT_STEP.percent}
        minValue={0}
        maxValue={1}
      />
      <PropertyNumber
        {...common}
        field="parameterContingencyPercent"
        label={t`Contingency`}
        value={numberOrNull(element.parameterContingencyPercent)}
        formatOptions={INPUT_FORMAT.percent}
        step={INPUT_STEP.percent}
        minValue={0}
        maxValue={1}
      />
      <PropertyField label={t`Computed value`}>
        <span className="flex flex-wrap items-center gap-2">
          {result?.computedValue !== null &&
          result?.computedValue !== undefined ? (
            <span className="font-medium tabular-nums">
              {withUnit(result.computedValue)}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {result?.reason ?? t`No value`}
            </span>
          )}
          {result?.mixedUnits && (
            <span className="text-xs text-amber-600 dark:text-amber-500">
              <Trans>Some inputs have another unit and are left out</Trans>
            </span>
          )}
        </span>
      </PropertyField>
      {contingency > 0 &&
        result?.checkedHigh !== null &&
        result?.checkedLow !== null &&
        result && (
          <PropertyField label={t`Checked value`}>
            <span className="flex flex-wrap items-center gap-2">
              <span className="tabular-nums">
                {withUnit(result.checkedLow!)} – {withUnit(result.checkedHigh!)}
              </span>
              <span className="text-xs text-muted-foreground">
                {t`with ${percentFormatter.format(contingency)} contingency`}
              </span>
            </span>
          </PropertyField>
        )}
      {result?.budgetValue !== null &&
        result?.budgetValue !== undefined &&
        result.parentValue !== null &&
        element.allocationPercent !== null && (
          <PropertyField label={t`Budget`}>
            <span className="flex flex-wrap items-center gap-2">
              <span className="tabular-nums">
                {formatAllocation(
                  result.budgetValue,
                  Number(element.allocationPercent),
                  result.parentValue,
                  unit,
                  locale
                )}
              </span>
              {result.budgetPass !== null && (
                <Status color={result.budgetPass ? "green" : "red"}>
                  {result.budgetPass ? t`Pass` : t`Fail`}
                </Status>
              )}
            </span>
          </PropertyField>
        )}
    </>
  );
}

function numberOrNull(value: number | string | null | undefined) {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * The formula input. It checks the text as it is typed, shows each readable
 * id as a link, and saves on blur or Enter through the links route.
 */
function FormulaField({
  projectId,
  elementId,
  formula,
  elements,
  isDisabled,
  onSaved
}: {
  projectId: string;
  elementId: string;
  formula: string | null;
  elements: ProjectElementPage["elements"];
  isDisabled: boolean;
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const [text, setText] = useState<string | null>(null);
  const changeRequestId = useActiveChangeRequestId();
  const value = text ?? formula ?? "=";
  const fetcher = useAction<{
    success?: boolean;
    error?: { message: string } | null;
  }>({
    key: `element:${elementId}:formula`,
    onSuccess: () => {
      setText(null);
      onSaved();
    }
  });
  const parsed = parseParameterFormula(value);
  const byReadableId = useMemo(
    () => new Map(elements.map((e) => [e.readableId, e])),
    [elements]
  );
  const serverError =
    fetcher.state === "idle" && fetcher.data?.error
      ? fetcher.data.error.message
      : null;

  const save = () => {
    if (value === (formula ?? "=") || "error" in parsed) return;
    fetcher.submit(
      { intent: "saveFormula", elementId, formula: value },
      {
        method: "post",
        action: withChangeRequest(
          path.to.projectElementLinks(projectId),
          changeRequestId
        )
      }
    );
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      <Input
        size="sm"
        aria-label={t`Formula`}
        value={value}
        isDisabled={isDisabled}
        className="font-mono"
        placeholder="= SNS-20 - SNS-21"
        onChange={(event) => setText(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
          if (event.key === "Escape") setText(null);
        }}
      />
      {"error" in parsed
        ? value.trim() !== "=" && (
            <span className="text-xs text-red-500">{parsed.error}</span>
          )
        : parsed.refs.length > 0 && (
            <span className="flex flex-wrap gap-2 text-xs">
              {parsed.refs.map((ref) => {
                const target = byReadableId.get(ref);
                return target ? (
                  <Link
                    key={ref}
                    to={path.to.projectElement(projectId, target.id)}
                    className="font-mono hover:underline"
                  >
                    {ref}
                  </Link>
                ) : (
                  <span key={ref} className="font-mono text-red-500">
                    {t`${ref} not found`}
                  </span>
                );
              })}
            </span>
          )}
      {serverError && (
        <span className="text-xs text-red-500">{serverError}</span>
      )}
    </div>
  );
}
