// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  type EarnedValueTechnique,
  earnedValueTechniques,
  elementEarnedValueValidator
} from "@carbon/ee/project-control";
import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuChartNoAxesCombined, LuLock } from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  Boolean,
  Employee,
  Hidden,
  Number,
  Select,
  Submit
} from "~/components/Form";
import {
  UpgradeOverlayContent,
  UpgradeOverlayDescription,
  UpgradeOverlayIcon,
  UpgradeOverlayTitle,
  UpgradeOverlayUpgradeButton
} from "~/components/UpgradeOverlay";
import { usePlanGate } from "~/hooks/usePlanGate";
import { path } from "~/utils/path";
import type { ProjectElementPage } from "../../projects.server";

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

  return <EarnedValueForm {...props} />;
}

/** A property row with a lock: the upgrade copy opens in a popover. */
function EarnedValueLockedRow() {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <span className="w-[120px] shrink-0 text-xs text-muted-foreground">
        <Trans>Earned value</Trans>
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

function EarnedValueForm({
  projectId,
  element,
  elements,
  isDisabled
}: ElementEarnedValueProps) {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();
  // The user's choices before Save; the saved values otherwise.
  const [controlAccountChoice, setControlAccountChoice] = useState<
    boolean | null
  >(null);
  const [techniqueChoice, setTechniqueChoice] = useState<
    EarnedValueTechnique | "" | null
  >(null);

  const isControlAccount = controlAccountChoice ?? element.isControlAccount;
  const technique =
    techniqueChoice === null
      ? (element.earnedValueTechnique ?? "")
      : techniqueChoice;
  const canTakeTechnique =
    element.isChargeable && hasControlAccountAbove(element.id, elements);
  const showTechnique =
    !isControlAccount && (canTakeTechnique || !!element.earnedValueTechnique);

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
        (!!e.earnedValueTechnique || e.id === element.apportionedToElementId)
    )
    .map((e) => ({ value: e.id, label: `${e.readableId} ${e.name}` }));

  return (
    <div className="mt-4 flex flex-col gap-2">
      <h2 className="text-sm font-medium">
        <Trans>Earned Value</Trans>
      </h2>
      <ValidatedForm
        key={element.id}
        method="post"
        action={path.to.projectElement(projectId, element.id)}
        validator={elementEarnedValueValidator}
        defaultValues={{
          elementId: element.id,
          isControlAccount: element.isControlAccount,
          controlAccountManagerId: element.controlAccountManagerId ?? undefined,
          earnedValueTechnique: element.earnedValueTechnique ?? undefined,
          earnedValuePercent: element.earnedValuePercent ?? undefined,
          apportionedToElementId: element.apportionedToElementId ?? undefined,
          apportionedFactor: element.apportionedFactor ?? undefined
        }}
        fetcher={fetcher}
        isDisabled={isDisabled}
      >
        <Hidden name="intent" value="earned-value" />
        <Hidden name="elementId" />
        <VStack spacing={3}>
          <Boolean
            bordered
            name="isControlAccount"
            label={t`Control account`}
            description={t`Earned value rolls up to this element`}
            onChange={setControlAccountChoice}
          />
          {isControlAccount && (
            <Employee
              name="controlAccountManagerId"
              label={t`Control account manager`}
            />
          )}
          {showTechnique && (
            <Select
              name="earnedValueTechnique"
              label={t`Technique`}
              helperText={
                canTakeTechnique
                  ? undefined
                  : t`Needs a chargeable element below a control account`
              }
              options={earnedValueTechniques.map((value) => ({
                value,
                label: techniqueLabels[value]
              }))}
              onChange={(option) =>
                setTechniqueChoice(
                  (option?.value as EarnedValueTechnique | undefined) ?? ""
                )
              }
            />
          )}
          {showTechnique && technique === "Percent Complete" && (
            <Number
              name="earnedValuePercent"
              label={t`Percent complete`}
              formatOptions={INPUT_FORMAT.percent}
              step={INPUT_STEP.percent}
              minValue={0}
              maxValue={1}
            />
          )}
          {showTechnique && technique === "Apportioned" && (
            <>
              <Select
                name="apportionedToElementId"
                label={t`Base element`}
                options={baseOptions}
              />
              <Number
                name="apportionedFactor"
                label={t`Factor`}
                formatOptions={INPUT_FORMAT.quantity}
                step={INPUT_STEP.quantity}
                minValue={0}
              />
            </>
          )}
          <Submit isDisabled={isDisabled}>
            <Trans>Save</Trans>
          </Submit>
        </VStack>
      </ValidatedForm>
    </div>
  );
}
