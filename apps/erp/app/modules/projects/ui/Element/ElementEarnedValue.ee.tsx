// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  type EarnedValueTechnique,
  earnedValueTechniques
} from "@carbon/ee/project-control";
import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  LabelWithHelp,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuChartNoAxesCombined, LuLock } from "react-icons/lu";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { Employee } from "~/components/Form";
import {
  UpgradeOverlayContent,
  UpgradeOverlayDescription,
  UpgradeOverlayIcon,
  UpgradeOverlayTitle,
  UpgradeOverlayUpgradeButton
} from "~/components/UpgradeOverlay";
import { usePlanGate } from "~/hooks/usePlanGate";
import { path } from "~/utils/path";
import type { ProjectElementPage } from "../../projects.service";
import {
  PropertyNumber,
  type PropertySave,
  PropertySaveProvider,
  PropertySelect,
  PropertySwitch
} from "./PropertyFields";

type Element = ProjectElementPage["element"];
type ListElement = ProjectElementPage["elements"][number];

type ElementEarnedValueProps = {
  projectId: string;
  element: Element;
  elements: ListElement[];
  isDisabled: boolean;
};

/** True when a control account is an ancestor of the element (C7). */
function hasControlAccountAbove(elementId: string, elements: ListElement[]) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const seen = new Set<string>([elementId]);
  let parentId = byId.get(elementId)?.parentId ?? null;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) return false;
    if (parent.isControlAccount) return true;
    parentId = parent.parentId;
  }
  return false;
}

/**
 * The earned value fields of an element (Government Contracting 5c): a
 * control account with its manager, or a work package's technique. A company
 * without government contracting sees one locked row: the sidebar shows on
 * every element, so the full overlay stays on the Costs tab.
 */
export default function ElementEarnedValue(props: ElementEarnedValueProps) {
  const { isGated } = usePlanGate({ feature: "GOVERNMENT_CONTRACTING" });

  if (isGated) return <EarnedValueLockedRow />;

  // Keyed by element: a held-back choice belongs to one element.
  return <EarnedValueForm key={props.element.id} {...props} />;
}

/** A property row with a lock: the upgrade copy opens in a popover. */
function EarnedValueLockedRow() {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <span className="w-[120px] shrink-0 text-xs text-muted-foreground">
        <LabelWithHelp termId="earned-value" variant="inline">
          <Trans>Earned value</Trans>
        </LabelWithHelp>
      </span>
      <div className="flex min-w-0 flex-1 items-center">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" leftIcon={<LuLock />}>
              <Trans>Upgrade</Trans>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="flex w-72 flex-col items-center gap-3 text-center"
          >
            <UpgradeOverlayIcon>
              <LuChartNoAxesCombined className="size-6 text-muted-foreground" />
            </UpgradeOverlayIcon>
            <UpgradeOverlayContent>
              <UpgradeOverlayTitle>
                <Trans>Earned Value</Trans>
              </UpgradeOverlayTitle>
              <UpgradeOverlayDescription>
                <Trans>
                  Earned value: CPI, SPI and EAC per control account.
                </Trans>
              </UpgradeOverlayDescription>
            </UpgradeOverlayContent>
            <UpgradeOverlayUpgradeButton />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

/** The earned value fields of the element, as one row of the update. */
type EarnedValues = {
  isControlAccount: boolean;
  controlAccountManagerId: string | null;
  earnedValueTechnique: EarnedValueTechnique | null;
  earnedValuePercent: number | null;
  apportionedToElementId: string | null;
  apportionedFactor: number | null;
};

type EarnedValueField = keyof EarnedValues;

function savedValues(element: Element): EarnedValues {
  return {
    isControlAccount: element.isControlAccount,
    controlAccountManagerId: element.controlAccountManagerId,
    earnedValueTechnique: element.earnedValueTechnique,
    earnedValuePercent:
      element.earnedValuePercent === null
        ? null
        : Number(element.earnedValuePercent),
    apportionedToElementId: element.apportionedToElementId,
    apportionedFactor:
      element.apportionedFactor === null
        ? null
        : Number(element.apportionedFactor)
  };
}

/** The values a save in flight is sending, read back from its form data. */
function submittedValues(formData: FormData): EarnedValues {
  const text = (name: EarnedValueField) => {
    const value = formData.get(name);
    return typeof value === "string" && value !== "" ? value : null;
  };
  const numeric = (name: EarnedValueField) => {
    const value = text(name);
    return value === null ? null : Number(value);
  };
  return {
    isControlAccount: formData.get("isControlAccount") === "on",
    controlAccountManagerId: text("controlAccountManagerId"),
    earnedValueTechnique: text("earnedValueTechnique") as EarnedValueTechnique,
    earnedValuePercent: numeric("earnedValuePercent"),
    apportionedToElementId: text("apportionedToElementId"),
    apportionedFactor: numeric("apportionedFactor")
  };
}

/**
 * Each field saves on change, in the inline pattern of the sidebar's other
 * properties. The earned value route saves the fields together (the ee lock
 * checks them as one), so every change sends all of them: the saved values,
 * under the save in flight, under the change. Apportioned waits for its base
 * element and factor before it saves.
 */
function EarnedValueForm({
  projectId,
  element,
  elements,
  isDisabled
}: ElementEarnedValueProps) {
  const { t } = useLingui();
  const fetcher = useAction<{
    success?: boolean;
    error?: { message: string } | null;
  }>({
    key: `earned-value:${element.id}`,
    onError: (data) =>
      toast.error(data.error?.message ?? t`Failed to save the earned value`, {
        id: `earned-value:${element.id}`
      })
  });
  // A choice held back until the fields it needs are set (Apportioned).
  const [draft, setDraft] = useState<Partial<EarnedValues>>({});

  const values: EarnedValues = {
    ...(fetcher.formData
      ? submittedValues(fetcher.formData)
      : savedValues(element)),
    ...draft
  };

  const change = (patch: Partial<EarnedValues>) => {
    const next = { ...values, ...patch };
    if (
      !next.isControlAccount &&
      next.earnedValueTechnique === "Apportioned" &&
      !(next.apportionedToElementId && (next.apportionedFactor ?? 0) > 0)
    ) {
      setDraft((current) => ({ ...current, ...patch }));
      return;
    }
    setDraft({});
    const formData = new FormData();
    formData.set("intent", "earned-value");
    formData.set("elementId", element.id);
    if (next.isControlAccount) formData.set("isControlAccount", "on");
    for (const field of [
      "controlAccountManagerId",
      "earnedValueTechnique",
      "earnedValuePercent",
      "apportionedToElementId",
      "apportionedFactor"
    ] as const) {
      const value = next[field];
      if (value !== null) formData.set(field, String(value));
    }
    fetcher.submit(formData, {
      method: "post",
      action: path.to.projectElement(projectId, element.id)
    });
  };

  // The sidebar's property fields, saving into `change`.
  const save = (
    _projectId: string,
    _elementId: string,
    field: string
  ): PropertySave => ({
    pending: undefined,
    submit: (value) => {
      const name = field as EarnedValueField;
      if (name === "isControlAccount") {
        change({ isControlAccount: value === "true" });
      } else if (
        name === "earnedValuePercent" ||
        name === "apportionedFactor"
      ) {
        change({ [name]: value === null ? null : Number(value) });
      } else {
        change({ [name]: value } as Partial<EarnedValues>);
      }
    }
  });

  const technique = values.earnedValueTechnique;
  const canTakeTechnique =
    element.isChargeable && hasControlAccountAbove(element.id, elements);
  const showTechnique =
    !values.isControlAccount &&
    (canTakeTechnique || !!element.earnedValueTechnique);
  const common = { projectId, elementId: element.id, isDisabled };

  const techniqueLabels: Record<EarnedValueTechnique, string> = {
    "0/100": t`0/100`,
    "50/50": t`50/50`,
    "Percent Complete": t`Percent Complete`,
    Milestone: t`Milestone`,
    "Level of Effort": t`Level of Effort`,
    Apportioned: t`Apportioned`
  };
  // An Apportioned element earns a factor of another work package's value.
  const baseOptions = elements
    .filter(
      (e) =>
        e.id !== element.id &&
        (!!e.earnedValueTechnique || e.id === values.apportionedToElementId)
    )
    .map((e) => ({ value: e.id, label: `${e.readableId} ${e.name}` }));

  return (
    <div className="mt-4 flex flex-col gap-4">
      <h2 className="text-sm font-medium">
        <LabelWithHelp termId="earned-value" variant="inline">
          <Trans>Earned Value</Trans>
        </LabelWithHelp>
      </h2>
      <PropertySaveProvider value={save}>
        {/* Drawn as the sidebar's other switches. */}
        <PropertySwitch
          {...common}
          field="isControlAccount"
          label={t`Control account`}
          termId="control-account"
          value={values.isControlAccount}
        />
        {values.isControlAccount && (
          <ValidatedForm
            key={`controlAccountManagerId:${values.controlAccountManagerId ?? ""}`}
            defaultValues={{
              controlAccountManagerId: values.controlAccountManagerId ?? ""
            }}
            validator={z.object({
              controlAccountManagerId: zfd.text(z.string().optional())
            })}
            className="w-full"
          >
            <Employee
              name="controlAccountManagerId"
              label={t`Control account manager`}
              inline
              isOptional
              isReadOnly={isDisabled}
              onChange={(option) => {
                const next = option?.value || null;
                if (next !== values.controlAccountManagerId) {
                  change({ controlAccountManagerId: next });
                }
              }}
            />
          </ValidatedForm>
        )}
        {showTechnique && (
          <VStack spacing={1}>
            <PropertySelect
              {...common}
              field="earnedValueTechnique"
              label={t`Technique`}
              value={technique}
              options={earnedValueTechniques.map((value) => ({
                value,
                label: techniqueLabels[value]
              }))}
            />
            {!canTakeTechnique && (
              <p className="text-xs text-muted-foreground">
                <Trans>
                  Needs a chargeable element below a control account
                </Trans>
              </p>
            )}
          </VStack>
        )}
        {showTechnique && technique === "Percent Complete" && (
          <PropertyNumber
            {...common}
            field="earnedValuePercent"
            label={t`Percent complete`}
            value={values.earnedValuePercent}
            formatOptions={INPUT_FORMAT.percent}
            step={INPUT_STEP.percent}
            minValue={0}
            maxValue={1}
          />
        )}
        {showTechnique && technique === "Apportioned" && (
          <>
            <PropertySelect
              {...common}
              field="apportionedToElementId"
              label={t`Base element`}
              value={values.apportionedToElementId}
              options={baseOptions}
            />
            <PropertyNumber
              {...common}
              field="apportionedFactor"
              label={t`Factor`}
              value={values.apportionedFactor}
              formatOptions={INPUT_FORMAT.quantity}
              step={INPUT_STEP.quantity}
              minValue={0}
            />
          </>
        )}
      </PropertySaveProvider>
    </div>
  );
}
