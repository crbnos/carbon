// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  budgetControls,
  MATERIAL_MEASUREMENT_POINTS,
  type MaterialMeasurementPoint,
  projectControlSettingsValidator
} from "@carbon/ee/project-control";
import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useFetcher } from "react-router";
import { Hidden, Number, Select, Submit } from "~/components/Form";
import { UpgradeOverlayRow } from "~/components/UpgradeOverlay";
import { usePlanGate } from "~/hooks/usePlanGate";
import type { Project } from "../../types";

type ProjectControlSettingsProps = {
  project: Pick<
    Project,
    | "id"
    | "budgetControl"
    | "budgetTolerancePercent"
    | "materialMeasurementPoint"
  >;
  /** The project's Settings route. */
  action: string;
  isDisabled: boolean;
};

/**
 * The control settings of a project (Government Contracting 5c): budget
 * control with its tolerance, and the material point of measurement. A
 * company without government contracting sees one upgrade row.
 */
export default function ProjectControlSettings(
  props: ProjectControlSettingsProps
) {
  const { isGated } = usePlanGate({ feature: "GOVERNMENT_CONTRACTING" });

  // Layer 5: a company without the feature sees one compact row, not a
  // full overlay inside the settings page.
  if (isGated) {
    return (
      <UpgradeOverlayRow
        title={<Trans>Project Control</Trans>}
        plan={<Trans>Business</Trans>}
      />
    );
  }

  return <ProjectControlCard {...props} />;
}

function ProjectControlCard({
  project,
  action,
  isDisabled
}: ProjectControlSettingsProps) {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();

  const controlLabels: Record<(typeof budgetControls)[number], string> = {
    None: t`None`,
    Warn: t`Warn`,
    Block: t`Block`
  };
  const pointLabels: Record<MaterialMeasurementPoint, string> = {
    Receipt: t`Receipt`,
    Issue: t`Issue`
  };

  return (
    <Card>
      <ValidatedForm
        method="post"
        action={action}
        validator={projectControlSettingsValidator}
        defaultValues={{
          projectId: project.id,
          budgetControl: project.budgetControl,
          budgetTolerancePercent: project.budgetTolerancePercent ?? undefined,
          materialMeasurementPoint:
            project.materialMeasurementPoint as MaterialMeasurementPoint
        }}
        fetcher={fetcher}
        isDisabled={isDisabled}
      >
        <CardHeader>
          <CardTitle>
            <Trans>Project Control</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Check each charge against the budget of its nearest budgeted
              element. A timesheet only warns.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Hidden name="intent" value="control-settings" />
          <Hidden name="projectId" />
          <div className="@container w-full">
            <div className="grid w-full grid-cols-1 gap-4 @md:grid-cols-2">
              <Select
                name="budgetControl"
                label={t`Budget Control`}
                helperText={t`Warn saves the charge and shows the overrun. Block refuses it.`}
                options={budgetControls.map((control) => ({
                  label: controlLabels[control],
                  value: control
                }))}
              />
              <Number
                name="budgetTolerancePercent"
                label={t`Tolerance`}
                helperText={t`How far over the budget a charge may go`}
                formatOptions={INPUT_FORMAT.percent}
                step={INPUT_STEP.percent}
                minValue={0}
              />
              <Select
                name="materialMeasurementPoint"
                label={t`Material Measurement Point`}
                helperText={t`Receipt counts material when it is received. Issue counts it when project stock is issued.`}
                options={MATERIAL_MEASUREMENT_POINTS.map((point) => ({
                  label: pointLabels[point],
                  value: point
                }))}
              />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={isDisabled}>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
}
