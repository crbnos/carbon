// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Combobox,
  Input,
  NumberField,
  NumberInput,
  Status
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { DateTime, EmployeeAvatar } from "~/components";
import { usePercentFormatter, useQuantityFormatter } from "~/hooks";
import { path } from "~/utils/path";
import type {
  ParameterSource,
  ProjectElementEditableField,
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
import { useElementField } from "../Elements/ElementProperties";
import { VerificationStatus } from "../Elements/VerificationStatus";

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

/** One row: a 140 px label column and the value. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <span className="w-[140px] shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {children}
      </div>
    </div>
  );
}

function Block({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-1 rounded-lg border border-border px-4 py-3 text-sm">
      {children}
    </div>
  );
}

/** An enum or reference field as a button combobox. */
function SelectField({
  projectId,
  elementId,
  field,
  value,
  options,
  placeholder,
  isClearable = true,
  isDisabled
}: {
  projectId: string;
  elementId: string;
  field: ProjectElementEditableField;
  value: string | null;
  options: { value: string; label: string; helper?: string }[];
  placeholder: string;
  isClearable?: boolean;
  isDisabled: boolean;
}) {
  const { pending, submit } = useElementField(projectId, elementId, field);
  const shown = pending === undefined ? value : pending;
  return (
    <div className="w-full max-w-64">
      <Combobox
        asButton
        size="sm"
        value={shown ?? ""}
        options={options}
        isClearable={isClearable}
        isReadOnly={isDisabled}
        placeholder={placeholder}
        onChange={(next) => {
          if ((next || null) !== shown) submit(next || null);
        }}
      />
    </div>
  );
}

/** A number field that saves on commit. */
function NumberValueField({
  projectId,
  elementId,
  field,
  value,
  label,
  kind,
  isDisabled
}: {
  projectId: string;
  elementId: string;
  field: ProjectElementEditableField;
  value: number | null;
  label: string;
  kind: "quantity" | "percent";
  isDisabled: boolean;
}) {
  const { pending, submit } = useElementField(projectId, elementId, field);
  const shown =
    pending === undefined ? value : pending === null ? null : Number(pending);
  return (
    <NumberField
      aria-label={label}
      value={shown === null ? Number.NaN : Number(shown)}
      isDisabled={isDisabled}
      formatOptions={
        kind === "percent" ? INPUT_FORMAT.percent : INPUT_FORMAT.quantity
      }
      step={kind === "percent" ? INPUT_STEP.percent : INPUT_STEP.quantity}
      minValue={kind === "percent" ? 0 : undefined}
      maxValue={kind === "percent" ? 1 : undefined}
      onChange={(next) => {
        const nextValue = Number.isNaN(next) ? null : next;
        if (nextValue !== shown) {
          submit(nextValue === null ? null : String(nextValue));
        }
      }}
    >
      <NumberInput size="sm" className="w-32 tabular-nums" />
    </NumberField>
  );
}

/** A free-text field (a unit) that saves on blur. */
function TextValueField({
  projectId,
  elementId,
  field,
  value,
  label,
  placeholder,
  isDisabled
}: {
  projectId: string;
  elementId: string;
  field: ProjectElementEditableField;
  value: string | null;
  label: string;
  placeholder: string;
  isDisabled: boolean;
}) {
  const { submit } = useElementField(projectId, elementId, field);
  return (
    <Input
      key={value ?? ""}
      size="sm"
      aria-label={label}
      placeholder={placeholder}
      defaultValue={value ?? ""}
      isDisabled={isDisabled}
      className="w-24"
      onBlur={(event) => {
        const next = event.target.value.trim() || null;
        if (next !== value) submit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
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
    <Block>
      <Row label={t`Category`}>
        <SelectField
          {...common}
          field="requirementCategory"
          value={element.requirementCategory}
          placeholder={t`No category`}
          options={requirementCategories.map((value) => ({
            value,
            label: categoryLabels[value]
          }))}
        />
      </Row>
      <Row label={t`Target`}>
        <div className="w-36">
          <SelectField
            {...common}
            field="targetOperator"
            value={element.targetOperator}
            placeholder={t`No target`}
            options={requirementTargetOperators.map((value) => ({
              value,
              label: operatorLabels[value]
            }))}
          />
        </div>
        {operator && (
          <NumberValueField
            {...common}
            field="targetValue"
            value={element.targetValue}
            label={operator === "Range" ? t`Lower value` : t`Target value`}
            kind="quantity"
          />
        )}
        {operator === "Range" && (
          <>
            <span className="text-xs text-muted-foreground">
              <Trans>to</Trans>
            </span>
            <NumberValueField
              {...common}
              field="targetUpperValue"
              value={element.targetUpperValue}
              label={t`Upper value`}
              kind="quantity"
            />
          </>
        )}
        {operator && (
          <TextValueField
            {...common}
            field="targetUnit"
            value={element.targetUnit}
            label={t`Unit`}
            placeholder={t`Unit`}
          />
        )}
      </Row>
      <Row label={t`Verification method`}>
        <SelectField
          {...common}
          field="verificationMethod"
          value={element.verificationMethod}
          placeholder={t`No method`}
          options={requirementVerificationMethods.map((value) => ({
            value,
            label: methodLabels[value]
          }))}
        />
      </Row>
      <Row label={t`Actual parameter`}>
        <SelectField
          {...common}
          field="actualParameterId"
          value={element.actualParameterId}
          placeholder={t`No parameter`}
          options={parameterOptions}
        />
        {element.actualParameterId && (
          <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
            {actual === null ? (
              <Trans>No value</Trans>
            ) : (
              `${formatQuantity(actual)}${actualUnit ? ` ${actualUnit}` : ""}`
            )}
          </span>
        )}
      </Row>
      <Row label={t`Status`}>
        <VerificationStatus status={requirementStatus[element.id]} />
        {own?.kind === "Requirement" && own.checkCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {own.checkCount === 1 ? t`1 check` : t`${own.checkCount} checks`}
          </span>
        )}
      </Row>
    </Block>
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
    <Block>
      <Row label={t`Verdict`}>
        <SelectField
          {...common}
          field="verdict"
          value={element.verdict}
          placeholder={t`No verdict`}
          options={testCaseVerdicts.map((value) => ({
            value,
            label: verdictLabels[value]
          }))}
        />
      </Row>
      <Row label={t`Procedure`}>
        <SelectField
          {...common}
          field="qualityDocumentId"
          value={element.qualityDocumentId}
          placeholder={t`No procedure`}
          options={qualityDocuments.map((doc) => ({
            value: doc.id,
            label: doc.name,
            helper: t`Version ${doc.version}`
          }))}
        />
        {element.qualityDocumentId && (
          <Link
            to={path.to.qualityDocument(element.qualityDocumentId)}
            className="text-xs text-muted-foreground hover:underline"
          >
            <Trans>Open</Trans>
          </Link>
        )}
      </Row>
      {element.verdictAt && element.verdictBy && (
        <Row label={t`Last run`}>
          <span className="inline-flex items-center gap-2 text-sm">
            <EmployeeAvatar employeeId={element.verdictBy} size="xxs" />
            <DateTime value={element.verdictAt} />
          </span>
        </Row>
      )}
    </Block>
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
    <Block>
      <Row label={t`Source`}>
        <div className="w-full max-w-64">
          <Combobox
            asButton
            size="sm"
            value={shownSource}
            options={parameterSources.map((value) => ({
              value,
              label: sourceLabels[value]
            }))}
            isReadOnly={isDisabled}
            onChange={(next) => {
              if (!next || next === shownSource) return;
              if (next === "Formula" && !element.parameterFormula) {
                setFormulaDraft(true);
                return;
              }
              setFormulaDraft(false);
              submitSource(next);
            }}
          />
        </div>
      </Row>
      {shownSource === "Manual" && (
        <Row label={t`Value`}>
          <NumberValueField
            {...common}
            field="parameterValue"
            value={element.parameterValue}
            label={t`Value`}
            kind="quantity"
          />
        </Row>
      )}
      <Row label={t`Unit`}>
        <TextValueField
          {...common}
          field="parameterUnit"
          value={element.parameterUnit}
          label={t`Unit`}
          placeholder={t`Unit`}
        />
      </Row>
      {shownSource === "Formula" && (
        <Row label={t`Formula`}>
          <FormulaField
            projectId={projectId}
            elementId={element.id}
            formula={element.parameterFormula}
            elements={elements}
            isDisabled={isDisabled}
            onSaved={() => setFormulaDraft(false)}
          />
        </Row>
      )}
      {shownSource === "Item" && (
        <Row label={t`Part field`}>
          <SelectField
            {...common}
            field="parameterItemField"
            value={element.parameterItemField ?? PARAMETER_ITEM_UNIT_COST}
            placeholder={t`Choose a field`}
            isClearable={false}
            options={[
              { value: PARAMETER_ITEM_UNIT_COST, label: t`Unit cost` },
              ...itemFields.map((field) => ({
                value: field.id,
                label: field.name
              }))
            ]}
          />
        </Row>
      )}
      <Row label={t`Allocation`}>
        <NumberValueField
          {...common}
          field="allocationPercent"
          value={element.allocationPercent}
          label={t`Allocation`}
          kind="percent"
        />
      </Row>
      <Row label={t`Contingency`}>
        <NumberValueField
          {...common}
          field="parameterContingencyPercent"
          value={element.parameterContingencyPercent}
          label={t`Contingency`}
          kind="percent"
        />
      </Row>
      <Row label={t`Computed value`}>
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
      </Row>
      {contingency > 0 &&
        result?.checkedHigh !== null &&
        result?.checkedLow !== null &&
        result && (
          <Row label={t`Checked value`}>
            <span className="tabular-nums">
              {withUnit(result.checkedLow!)} – {withUnit(result.checkedHigh!)}
            </span>
            <span className="text-xs text-muted-foreground">
              {t`with ${percentFormatter.format(contingency)} contingency`}
            </span>
          </Row>
        )}
      {result?.budgetValue !== null &&
        result?.budgetValue !== undefined &&
        result.parentValue !== null &&
        element.allocationPercent !== null && (
          <Row label={t`Budget`}>
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
          </Row>
        )}
    </Block>
  );
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
      { method: "post", action: path.to.projectElementLinks(projectId) }
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
