// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  budgetControls,
  MATERIAL_MEASUREMENT_POINTS,
  type MaterialMeasurementPoint
} from "@carbon/ee/project-control";
import { useAction } from "@carbon/query";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { createContext, useContext, useMemo } from "react";
import { UpgradeOverlayRow } from "~/components/UpgradeOverlay";
import { usePlanGate } from "~/hooks/usePlanGate";
import type { Project } from "../../types";
import type { PropertySave } from "../Element/PropertyFields";
import {
  PropertyGroup,
  PropertyNumber,
  PropertySaveProvider,
  PropertySelect
} from "../Element/PropertyFields";

type ProjectControlSettingsProps = {
  project: Pick<
    Project,
    | "id"
    | "budgetControl"
    | "budgetTolerancePercent"
    | "materialMeasurementPoint"
  >;
  /** The route that saves them (`intent=control-settings`). */
  action: string;
  isDisabled: boolean;
};

/**
 * The control settings of a project (Government Contracting 5c), as a group
 * of the project's properties column: budget control with its tolerance, and
 * the material point of measurement, each saved as it changes. A company
 * without government contracting sees one upgrade row.
 */
export default function ProjectControlSettings(
  props: ProjectControlSettingsProps
) {
  const { isGated } = usePlanGate({ feature: "GOVERNMENT_CONTRACTING" });

  // Layer 5: a company without the feature sees one compact row.
  if (isGated) {
    return (
      <UpgradeOverlayRow
        title={<Trans>Project Control</Trans>}
        plan={<Trans>Business</Trans>}
      />
    );
  }

  return <ProjectControlProperties {...props} />;
}

function ProjectControlProperties({
  project,
  action,
  isDisabled
}: ProjectControlSettingsProps) {
  const { t } = useLingui();
  const controlLabels: Record<(typeof budgetControls)[number], string> = {
    None: t`None`,
    Warn: t`Warn`,
    Block: t`Block`
  };
  const pointLabels: Record<MaterialMeasurementPoint, string> = {
    Receipt: t`Receipt`,
    Issue: t`Issue`
  };

  // The action validates the three settings together: each field posts
  // them all, with its own changed.
  const control = useMemo(
    () => ({
      projectId: project.id,
      action,
      current: {
        budgetControl: project.budgetControl ?? "",
        budgetTolerancePercent:
          project.budgetTolerancePercent === null
            ? ""
            : String(project.budgetTolerancePercent),
        materialMeasurementPoint: project.materialMeasurementPoint ?? ""
      }
    }),
    [
      project.id,
      project.budgetControl,
      project.budgetTolerancePercent,
      project.materialMeasurementPoint,
      action
    ]
  );

  const common = { projectId: project.id, elementId: "", isDisabled };

  return (
    <ProjectControlContext.Provider value={control}>
      <PropertySaveProvider value={useControlFieldSave}>
        <PropertyGroup title={t`Project control`}>
          <PropertySelect
            {...common}
            field="budgetControl"
            label={t`Budget control`}
            value={project.budgetControl}
            isOptional={false}
            options={budgetControls.map((control) => ({
              value: control,
              label: controlLabels[control]
            }))}
          />
          <PropertyNumber
            {...common}
            field="budgetTolerancePercent"
            label={t`Tolerance`}
            value={project.budgetTolerancePercent}
            formatOptions={INPUT_FORMAT.percent}
            step={INPUT_STEP.percent}
            minValue={0}
          />
          <PropertySelect
            {...common}
            field="materialMeasurementPoint"
            label={t`Material measurement point`}
            value={project.materialMeasurementPoint}
            isOptional={false}
            options={MATERIAL_MEASUREMENT_POINTS.map((point) => ({
              value: point,
              label: pointLabels[point]
            }))}
          />
        </PropertyGroup>
      </PropertySaveProvider>
    </ProjectControlContext.Provider>
  );
}

type ProjectControlValues = {
  projectId: string;
  action: string;
  current: Record<string, string>;
};

const ProjectControlContext = createContext<ProjectControlValues | null>(null);

/** One control setting's save: all three post, with this one changed. */
function useControlFieldSave(
  _projectId: string,
  _elementId: string,
  field: string
): PropertySave {
  const control = useContext(ProjectControlContext);
  const key = `project-control:${control?.projectId}:${field}`;
  const fetcher = useAction({ key });
  const pendingValue = fetcher.formData?.get(field);
  return {
    pending:
      typeof pendingValue === "string"
        ? pendingValue === ""
          ? null
          : pendingValue
        : undefined,
    submit: (value) => {
      if (!control) return;
      fetcher.submit(
        {
          intent: "control-settings",
          projectId: control.projectId,
          ...control.current,
          [field]: value ?? ""
        },
        { method: "post", action: control.action }
      );
    }
  };
}
