// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { LuChevronRight } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Account,
  Boolean as BooleanField,
  Customer,
  DatePicker,
  Employee,
  Hidden,
  InputControlled,
  Location,
  Number as NumberField,
  Select,
  SelectControlled,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import {
  costObjectivesForTreatment,
  projectCostTreatments,
  projectElementPriorities,
  projectValidator,
  suggestProjectIdentifier
} from "../../projects.models";
import {
  getCipFixedAssetClasses,
  getPlanningGroupsList
} from "../../projects.service";
import { useGovernmentContracting } from "../useGovernmentContracting";

type ProjectFormValues = z.infer<typeof projectValidator>;

type ProjectFormProps = {
  initialValues: ProjectFormValues;
  /** Set for a new project: the form opens in a drawer. */
  onClose?: () => void;
  isDisabled?: boolean;
  /** A new project only: the projects it can copy, templates first. */
  copyFrom?: {
    options: { value: string; label: string }[];
    defaultValue?: string;
  };
  /** An existing project only: its milestones, for the plan lock. */
  milestones?: { value: string; label: string }[];
  /** Project stock is chosen while the project is Draft only. */
  isProjectStockLocked?: boolean;
};

/**
 * A new project opens in a drawer and posts to `path.to.newProject`. An
 * existing project renders as a card on its Details tab and posts to the
 * current route. The identifier is fixed once the project exists, because
 * every element's readable id starts with it.
 */
const ProjectForm = ({
  initialValues,
  onClose,
  isDisabled = false,
  copyFrom,
  milestones,
  isProjectStockLocked = false
}: ProjectFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const isGovernmentContracting = useGovernmentContracting();

  const isEditing = initialValues.id !== undefined;
  const canSave = isEditing
    ? permissions.can("update", "projects")
    : permissions.can("create", "projects");

  const [name, setName] = useState(initialValues.name ?? "");
  const [identifier, setIdentifier] = useState(initialValues.identifier ?? "");
  const [identifierEdited, setIdentifierEdited] = useState(
    Boolean(initialValues.identifier)
  );
  const shownIdentifier = identifierEdited
    ? identifier
    : name.trim()
      ? suggestProjectIdentifier(name)
      : "";

  const [costTreatment, setCostTreatment] = useState<string>(
    initialValues.costTreatment
  );
  // Only the user's pick is state. Until they pick, the saved objective shows,
  // and a new Contract project starts on Direct.
  const [pickedCostObjective, setCostObjective] = useState<string | null>(null);
  const costObjectiveOptions = costObjectivesForTreatment(costTreatment).map(
    (objective) => ({ label: objective, value: objective })
  );
  const proposedCostObjective =
    pickedCostObjective ??
    initialValues.costObjective ??
    (!isEditing && costTreatment === "Contract" ? "Direct" : "");
  // A treatment change can rule the objective out (Expense takes only IR&D,
  // B&P or Indirect): then the field is empty.
  const costObjective = costObjectiveOptions.some(
    (option) => option.value === proposedCostObjective
  )
    ? proposedCostObjective
    : "";
  const cipClasses = useCipClasses(costTreatment === "Capitalize");
  const [projectStock, setProjectStock] = useState(
    initialValues.projectStock ?? false
  );
  // A project joins a planning group after it exists, on its Details tab.
  const planningGroups = usePlanningGroups(isEditing && projectStock);

  const treatmentOptions = projectCostTreatments.map((treatment) => ({
    label: treatment,
    value: treatment
  }));
  const priorityOptions = projectElementPriorities.map((priority) => ({
    label: priority,
    value: priority
  }));

  const nameAndIdentifier = (
    <>
      <InputControlled
        name="name"
        label={t`Name`}
        value={name}
        onChange={setName}
        autoFocus={!isEditing}
      />
      <InputControlled
        name="identifier"
        label={t`Identifier`}
        value={shownIdentifier}
        isUppercase
        isReadOnly={isEditing}
        helperText={
          isEditing
            ? t`Element ids start with the identifier, so it cannot change`
            : t`2 to 6 capital letters or digits, such as SNS`
        }
        onChange={(value) => {
          setIdentifierEdited(true);
          setIdentifier(value.toUpperCase());
        }}
      />
    </>
  );
  const costTreatmentField = (
    <SelectControlled
      name="costTreatment"
      label={t`Cost Treatment`}
      options={treatmentOptions}
      value={costTreatment}
      onChange={(option) => setCostTreatment(option?.value ?? "")}
    />
  );
  const cipClassField = (
    <Select
      name="fixedAssetClassId"
      label={t`CIP Class`}
      helperText={t`Each final asset is built in this Construction in Progress class`}
      options={cipClasses.map((assetClass) => ({
        label: assetClass.name,
        value: assetClass.id
      }))}
    />
  );
  const costObjectiveField = (
    <SelectControlled
      name="costObjective"
      label={t`Cost Objective`}
      isOptional
      helperText={t`Where the project's cost lands for government contract reporting`}
      options={costObjectiveOptions}
      value={costObjective}
      onChange={(option) => setCostObjective(option?.value ?? "")}
    />
  );

  // A new project asks only what it needs to exist. Every other field is on
  // the project's settings page. Cost Objective shows only to a company that
  // does government contracting; for any other company it still posts the
  // default (Direct for a Contract project), as the visible field did.
  const createFields = (
    <>
      <div className="grid w-full grid-cols-1 gap-x-8 gap-y-4 @xl:grid-cols-2">
        {nameAndIdentifier}
        {costTreatmentField}
        {costTreatment === "Capitalize" && cipClassField}
        {isGovernmentContracting ? (
          costObjectiveField
        ) : (
          <Hidden name="costObjective" value={costObjective} />
        )}
        <Customer name="customerId" label={t`Customer`} />
        <Employee name="ownerId" label={t`Owner`} />
      </div>
      {copyFrom && copyFrom.options.length > 0 && (
        <FormSection
          title={t`Start from a copy`}
          defaultOpen={Boolean(copyFrom.defaultValue)}
        >
          <Select
            name="copyFromProjectId"
            label={t`Copy from`}
            isOptional
            helperText={t`Copies the states, labels, milestones, elements, links and plan lines`}
            options={copyFrom.options}
          />
        </FormSection>
      )}
    </>
  );

  const fields = (
    <>
      <Hidden name="id" />
      <div className="grid w-full grid-cols-1 gap-x-8 gap-y-4 @xl:grid-cols-2">
        {nameAndIdentifier}
        <div className="@xl:col-span-2">
          <TextArea name="description" label={t`Description`} />
        </div>
        {costTreatmentField}
        {costTreatment === "Capitalize" ? (
          cipClassField
        ) : (
          <Account
            name="costAccountId"
            label={t`Cost Account`}
            helperText={t`Leave empty to use the account default`}
          />
        )}
        {costObjectiveField}
        <Customer name="customerId" label={t`Customer`} />
        <Employee name="ownerId" label={t`Owner`} />
        <Location name="locationId" label={t`Location`} />
        <Select name="priority" label={t`Priority`} options={priorityOptions} />
        <DatePicker name="startDate" label={t`Start Date`} />
        <DatePicker name="endDate" label={t`End Date`} />
        <div className="flex flex-col gap-4 @xl:col-span-2">
          <BooleanField
            name="restrictCharging"
            label={t`Restrict charging to members`}
            description={t`In DCAA timekeeping, only the project's members can charge time to it`}
          />
          <BooleanField
            name="projectStock"
            label={t`Project stock`}
            description={
              isProjectStockLocked
                ? t`Chosen while the project is Draft`
                : t`Stock received for the project is the project's own, and only its demand draws it`
            }
            isDisabled={isProjectStockLocked}
            onChange={setProjectStock}
          />
          {projectStock && (
            <>
              <BooleanField
                name="chargeAtReceipt"
                label={t`Charge at receipt`}
                description={t`Charge the project when its stock is received, not when it is issued`}
              />
              <BooleanField
                name="governmentFurnished"
                label={t`Government-furnished`}
                description={t`The project's stock moves only to projects of the same customer`}
              />
            </>
          )}
          {isEditing && projectStock && (
            <div className="grid w-full grid-cols-1 gap-x-8 gap-y-4 @xl:grid-cols-2">
              <Select
                name="planningGroupId"
                label={t`Planning Group`}
                isOptional
                helperText={t`Members net their demand together in MRP. The group must be at the project's location`}
                options={planningGroups.map((group) => ({
                  label: group.name,
                  value: group.id
                }))}
              />
              <NumberField
                name="planningPriority"
                label={t`Planning Priority`}
                helperText={t`Under the Project Priority rule, a lower number gets the group's supply first`}
                minValue={0}
              />
            </div>
          )}
        </div>
        {isEditing && (
          <Select
            name="lockPlanAfterMilestoneId"
            label={t`Lock Plan After Milestone`}
            isOptional
            helperText={t`When this milestone completes, the plan changes only through a change request`}
            options={milestones ?? []}
          />
        )}
      </div>
    </>
  );

  if (isEditing) {
    return (
      <Card>
        <ValidatedForm
          method="post"
          validator={projectValidator}
          defaultValues={initialValues}
          isDisabled={isDisabled}
        >
          <CardHeader>
            <CardTitle>
              <Trans>Details</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="@container">{fields}</CardContent>
          <CardFooter>
            <Submit isDisabled={!canSave || isDisabled}>
              <Trans>Save</Trans>
            </Submit>
          </CardFooter>
        </ValidatedForm>
      </Card>
    );
  }

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={projectValidator}
            method="post"
            action={path.to.newProject}
            defaultValues={
              copyFrom?.defaultValue
                ? ({
                    ...initialValues,
                    copyFromProjectId: copyFrom.defaultValue
                  } as ProjectFormValues)
                : initialValues
            }
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>New Project</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4} className="@container">
                {createFields}
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                {/* Saving navigates to the new project, and the form is still
                    mounted and dirty at that moment. */}
                <Submit isDisabled={!canSave} withBlocker={false}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default ProjectForm;

/**
 * A folded group of form fields. A closed section only hides its fields: they
 * stay mounted, so the form still posts their values (D14). An unmounted field
 * would post nothing and the action would clear its column.
 */
function FormSection({
  title,
  defaultOpen = false,
  children
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        <LuChevronRight
          className={cn(
            "size-4 shrink-0 transition-transform duration-150",
            open && "rotate-90"
          )}
        />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent forceMount className={cn("pt-3", !open && "hidden")}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The company's active planning groups, read once when needed. */
function usePlanningGroups(enabled: boolean) {
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!enabled || !carbon) return;
    let cancelled = false;
    getPlanningGroupsList(carbon, company.id).then((result) => {
      if (!cancelled) setGroups(result.data ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, carbon, company.id]);
  return groups;
}

/** The company's Construction in Progress classes, read once when needed. */
function useCipClasses(enabled: boolean) {
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!enabled || !carbon) return;
    let cancelled = false;
    getCipFixedAssetClasses(carbon, company.id).then((result) => {
      if (!cancelled) setClasses(result.data ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, carbon, company.id]);
  return classes;
}
