// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuChevronRight } from "react-icons/lu";
import { useParams } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { Customer, Employee, Location } from "~/components/Form";
import { useAccounts } from "~/components/Form/Account";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import {
  costObjectivesForTreatment,
  projectCostTreatments,
  projectElementPriorities
} from "../../projects.models";
import type { Project, ProjectMilestone } from "../../types";
import type { PropertySave } from "../Element/PropertyFields";
import {
  hideOptionalTags,
  PropertyCombobox,
  PropertyDate,
  PropertyField,
  PropertyGroup,
  PropertyLayoutProvider,
  PropertyNumber,
  PropertyRow,
  PropertySaveProvider,
  PropertySelect,
  PropertySwitch,
  PropertyText,
  usePropertyFieldLabel
} from "../Element/PropertyFields";
import {
  ElementPriorityIcon,
  usePriorityLabels
} from "../Elements/ElementProperties";
import { useCipClasses, usePlanningGroups } from "../Projects/ProjectForm";
import ProjectStatus from "../Projects/ProjectStatus";
import { useGovernmentContracting } from "../useGovernmentContracting";
import ProjectControlSettings from "./ProjectControlSettings.ee";

/**
 * Saves one project field through the details route (`intent=field`), which
 * checks it against the whole project. The fetcher key is per field, so the
 * field shows its pending value.
 */
export function useProjectFieldSave(
  projectId: string,
  _elementId: string,
  field: string
): PropertySave {
  const key = `project:${projectId}:${field}`;
  const fetcher = useAction<{ error?: { message: string } | null }>({
    key,
    onError: (data) =>
      toast.error(data.error?.message ?? "Failed to save", { id: key })
  });
  const pendingValue = fetcher.formData?.get("value");
  const pending =
    typeof pendingValue === "string"
      ? pendingValue === ""
        ? null
        : pendingValue
      : undefined;
  return {
    pending,
    submit: (value) =>
      fetcher.submit(
        { intent: "field", field, value: value ?? "" },
        { method: "post", action: path.to.projectDetails(projectId) }
      )
  };
}

/**
 * The project's properties, the right column of its Overview (as an element
 * page's sidebar): each saves as it changes. The identity and dates first,
 * then accounting, stock and planning, charging and the plan lock — each
 * group only when it applies.
 */
export function ProjectProperties() {
  const { t } = useLingui();
  const { projectId } = useParams();
  if (!projectId) throw new Error("projectId not found");
  const permissions = usePermissions();
  const priorityLabels = usePriorityLabels();
  const isGovernmentContracting = useGovernmentContracting();
  const routeData = useRouteData<{
    project: Project;
    milestones: ProjectMilestone[];
    hasPlanningGroups: boolean;
  }>(path.to.project(projectId));
  const project = routeData?.project;
  const cipClasses = useCipClasses(project?.costTreatment === "Capitalize");
  const planningGroups = usePlanningGroups(
    Boolean(routeData?.hasPlanningGroups && project?.projectStock)
  );
  const accounts = useAccounts();
  const [showMore, setShowMore] = useState(false);

  if (!project) return null;

  const isDisabled =
    !permissions.can("update", "projects") || project.status === "Closed";
  const common = { projectId, elementId: "", isDisabled };

  return (
    <PropertySaveProvider value={useProjectFieldSave}>
      <PropertyLayoutProvider value="row">
        <VStack spacing={4} className={cn("w-full text-sm", hideOptionalTags)}>
          <PropertyGroup>
            <PropertyField label={t`Status`}>
              <ProjectStatus status={project.status} />
            </PropertyField>
            <PropertyText
              {...common}
              field="name"
              label={t`Name`}
              value={project.name}
            />
            <ProjectOwnerField {...common} ownerId={project.ownerId} />
            <ProjectCustomerField {...common} customerId={project.customerId} />
            <ProjectLocationField {...common} locationId={project.locationId} />
            <PropertySelect
              {...common}
              field="priority"
              label={t`Priority`}
              value={project.priority ?? null}
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
            <PropertyDate
              {...common}
              field="startDate"
              label={t`Start`}
              value={project.startDate}
            />
            <PropertyDate
              {...common}
              field="endDate"
              label={t`Due`}
              value={project.endDate}
            />
          </PropertyGroup>

          {/* The rest is set once and rarely changed: folded away. */}
          <Collapsible open={showMore} onOpenChange={setShowMore}>
            <CollapsibleTrigger className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
              <LuChevronRight
                className={cn(
                  "size-4 transition-transform duration-150",
                  showMore && "rotate-90"
                )}
              />
              <Trans>More</Trans>
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-6 pt-4">
              <PropertyGroup title={t`Accounting`}>
                <PropertySelect
                  {...common}
                  field="costTreatment"
                  label={t`Cost treatment`}
                  termId="cost-treatment"
                  value={project.costTreatment}
                  isOptional={false}
                  options={projectCostTreatments.map((treatment) => ({
                    value: treatment,
                    label: treatment
                  }))}
                />
                {project.costTreatment === "Capitalize" ? (
                  <PropertySelect
                    {...common}
                    field="fixedAssetClassId"
                    label={t`CIP class`}
                    value={project.fixedAssetClassId}
                    options={cipClasses.map((assetClass) => ({
                      value: assetClass.id,
                      label: assetClass.name
                    }))}
                  />
                ) : (
                  <PropertyCombobox
                    {...common}
                    field="costAccountId"
                    label={t`Cost account`}
                    value={project.costAccountId}
                    options={accounts.map((account) => ({
                      value: account.id,
                      label: `${account.number} ${account.name}`
                    }))}
                  />
                )}
                {isGovernmentContracting && (
                  <PropertySelect
                    {...common}
                    field="costObjective"
                    label={t`Cost objective`}
                    termId="cost-objective"
                    value={project.costObjective}
                    options={costObjectivesForTreatment(
                      project.costTreatment
                    ).map((objective) => ({
                      value: objective,
                      label: objective
                    }))}
                  />
                )}
              </PropertyGroup>

              <PropertyGroup title={t`Stock and planning`}>
                <PropertySwitch
                  {...common}
                  field="projectStock"
                  label={t`Project stock`}
                  termId="project-stock"
                  value={project.projectStock}
                  isDisabled={isDisabled || project.status !== "Draft"}
                />
                {project.projectStock && (
                  <>
                    <PropertySwitch
                      {...common}
                      field="chargeAtReceipt"
                      label={t`Charge at receipt`}
                      value={project.chargeAtReceipt}
                    />
                    <PropertySwitch
                      {...common}
                      field="governmentFurnished"
                      label={t`Government-furnished`}
                      value={project.governmentFurnished}
                    />
                  </>
                )}
                {routeData?.hasPlanningGroups && project.projectStock && (
                  <>
                    <PropertySelect
                      {...common}
                      field="planningGroupId"
                      label={t`Planning group`}
                      termId="planning-group"
                      value={project.planningGroupId}
                      options={planningGroups.map((group) => ({
                        value: group.id,
                        label: group.name
                      }))}
                    />
                    <PropertyNumber
                      {...common}
                      field="planningPriority"
                      label={t`Planning priority`}
                      value={project.planningPriority}
                      minValue={0}
                    />
                  </>
                )}
              </PropertyGroup>

              {isGovernmentContracting && (
                <PropertyGroup title={t`Charging`}>
                  <PropertySwitch
                    {...common}
                    field="restrictCharging"
                    label={t`Restrict charging to members`}
                    value={project.restrictCharging}
                  />
                </PropertyGroup>
              )}

              <ProjectControlSettings
                project={project}
                action={path.to.projectSettings(projectId)}
                isDisabled={isDisabled}
              />

              <PropertyGroup title={t`Plan lock`}>
                <PropertySelect
                  {...common}
                  field="lockPlanAfterMilestoneId"
                  label={t`Lock plan after milestone`}
                  termId="milestone"
                  value={project.lockPlanAfterMilestoneId}
                  options={(routeData?.milestones ?? []).map((milestone) => ({
                    value: milestone.id,
                    label: milestone.name
                  }))}
                />
              </PropertyGroup>
            </CollapsibleContent>
          </Collapsible>
        </VStack>
      </PropertyLayoutProvider>
    </PropertySaveProvider>
  );
}

type PartyFieldProps = {
  projectId: string;
  elementId: string;
  isDisabled: boolean;
};

/** The customer: the form `Customer` combobox in its inline mode. */
function ProjectCustomerField({
  projectId,
  isDisabled,
  customerId
}: PartyFieldProps & { customerId: string | null }) {
  const { t } = useLingui();
  const { submit } = useProjectFieldSave(projectId, "", "customerId");
  return (
    <PropertyRow label={t`Customer`}>
      <ValidatedForm
        key={`customerId:${customerId ?? ""}`}
        defaultValues={{ customerId: customerId ?? "" }}
        validator={z.object({ customerId: zfd.text(z.string().optional()) })}
        className="w-full"
      >
        <Customer
          name="customerId"
          label={usePropertyFieldLabel(t`Customer`)}
          inline
          isOptional
          isReadOnly={isDisabled}
          onChange={(option) => {
            const next = option?.value || null;
            if (next !== customerId) submit(next);
          }}
        />
      </ValidatedForm>
    </PropertyRow>
  );
}

/** The owner: the form `Employee` combobox in its inline mode. */
function ProjectOwnerField({
  projectId,
  isDisabled,
  ownerId
}: PartyFieldProps & { ownerId: string | null }) {
  const { t } = useLingui();
  const { submit } = useProjectFieldSave(projectId, "", "ownerId");
  return (
    <PropertyRow label={t`Owner`}>
      <ValidatedForm
        key={`ownerId:${ownerId ?? ""}`}
        defaultValues={{ ownerId: ownerId ?? "" }}
        validator={z.object({ ownerId: zfd.text(z.string().optional()) })}
        className="w-full"
      >
        <Employee
          name="ownerId"
          label={usePropertyFieldLabel(t`Owner`)}
          inline
          isOptional
          isReadOnly={isDisabled}
          onChange={(option) => {
            const next = option?.value || null;
            if (next !== ownerId) submit(next);
          }}
        />
      </ValidatedForm>
    </PropertyRow>
  );
}

/** The location: the form `Location` select in its inline mode. */
function ProjectLocationField({
  projectId,
  isDisabled,
  locationId
}: PartyFieldProps & { locationId: string | null }) {
  const { t } = useLingui();
  const { submit } = useProjectFieldSave(projectId, "", "locationId");
  return (
    <PropertyRow label={t`Location`}>
      <ValidatedForm
        key={`locationId:${locationId ?? ""}`}
        defaultValues={{ locationId: locationId ?? "" }}
        validator={z.object({ locationId: zfd.text(z.string().optional()) })}
        className="w-full"
      >
        <Location
          name="locationId"
          label={usePropertyFieldLabel(t`Location`)}
          inline
          isOptional
          isReadOnly={isDisabled}
          onChange={(option) => {
            const next = option?.value || null;
            if (next !== locationId) submit(next);
          }}
        />
      </ValidatedForm>
    </PropertyRow>
  );
}

/**
 * The project's description at the top of its Overview, edited in place and
 * saved on blur, as an element's.
 */
export function ProjectDescription({
  projectId,
  description,
  isDisabled
}: {
  projectId: string;
  description: string | null;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const { submit } = useProjectFieldSave(projectId, "", "description");
  return (
    <textarea
      key={description ?? ""}
      aria-label={t`Description`}
      defaultValue={description ?? ""}
      placeholder={t`Add a description…`}
      disabled={isDisabled}
      rows={1}
      className="-mx-1 w-full resize-none rounded-md bg-transparent px-1 py-0.5 text-sm outline-none [field-sizing:content] placeholder:text-muted-foreground hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:ring-1 focus-visible:ring-ring disabled:hover:bg-transparent"
      onBlur={(event) => {
        const next = event.target.value.trim() || null;
        if (next !== (description ?? null)) submit(next);
      }}
    />
  );
}
