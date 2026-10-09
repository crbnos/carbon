// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Array as ArrayInput,
  Boolean as BooleanInput,
  Hidden,
  Input,
  Number,
  SelectControlled,
  Submit,
  ValidatedForm
} from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Label,
  LabelWithHelp,
  Subheading,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import type {
  AssemblyGraphIndex,
  AssemblyStep,
  NamedUnit,
  SubAssemblyInfo
} from "@carbon/viewer";
import {
  buildSubAssemblyPlan,
  describeStep,
  groupComponentNodeIds,
  subAssemblyPartIds,
  usableSubAssemblies
} from "@carbon/viewer";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  LuBoxes,
  LuCirclePlus,
  LuEyeOff,
  LuMousePointerClick,
  LuTriangleAlert,
  LuX
} from "react-icons/lu";
import { useFetcher, useParams, useSearchParams } from "react-router";
import { UnitOfMeasure } from "~/components/Form";
import { ProcedureStepTypeIcon } from "~/components/Icons";
import { useImageUpload, usePermissions } from "~/hooks";
import { procedureStepType } from "~/modules/shared";
import { path } from "~/utils/path";
import {
  assemblyInstructionStepValidator,
  fastenerSchema,
  hasCustomMotion,
  stepPlanWarningsSchema
} from "../../production.models";
import type { FlattenedBomMaterial } from "../../production.service";
import type {
  AssemblyInstructionStepRow,
  AssemblyStepMaterial,
  AssemblyStepSlide,
  AssemblyStepTool
} from "../../types";
import PlaybackRow from "./AssemblyPlaybackRow";
import { ComponentColorSwatch } from "./AssemblyStepBom";
import { SUB_ASSEMBLY_PARAM } from "./AssemblyStepList";
import AssemblyStepMaterials from "./AssemblyStepMaterials";
import AssemblyStepSlides from "./AssemblyStepSlides";
import { AssemblyStepStatus, normalizeStepStatus } from "./AssemblyStepStatus";
import AssemblyStepTools from "./AssemblyStepTools";
import SubAssemblyPathRow from "./AssemblySubAssemblyPathRow";
import AssemblySubAssemblyProperties from "./AssemblySubAssemblyProperties";

type AssemblyInstructionPropertiesProps = {
  step: AssemblyInstructionStepRow | null;
  draftComponentNodeIds: string[] | null;
  /** Current viewer/Components-panel selection — marks the matching component rows */
  selectedNodeIds: string[];
  /** Add-mode is on — picking components appends them to this step */
  isAddingComponents: boolean;
  isDisabled: boolean;
  graphIndex: AssemblyGraphIndex | null;
  /** Authored subassembly units — a step matching one is titled by its name. */
  units: NamedUnit[];
  stepMaterials: AssemblyStepMaterial[];
  stepSlides: AssemblyStepSlide[];
  stepTools: AssemblyStepTool[];
  bomMaterials: FlattenedBomMaterial[];
  onSelectComponents: (nodeIds: string[]) => void;
  onStartAddComponents: () => void;
  onStopAddComponents: () => void;
  onRemoveComponents: (nodeIds: string[]) => void;
  hiddenNodeIds: string[];
  onSetHiddenComponents: (nodeIds: string[]) => void;
  /** The active step's motion path is open in the 3D editor */
  isEditingMotion: boolean;
  /** The sub-assembly whose joining path is open in the 3D editor, if any */
  editingUnitId: string | null;
  /** Opens the editor on a step's motion, or on a sub-assembly it carries in */
  onEditMotion: (stepId: string, unitHeaderId?: string) => void;
  onStopEditMotion: () => void;
  /** Puts back the motion a step or sub-assembly had before its path was drawn */
  onResetMotion: (stepId: string) => void;
  onSetCamera: (stepId: string) => void;
  onClearCamera: (stepId: string) => void;
  /** Every step of the instruction, in play order — numbering and sub-assemblies */
  viewerSteps: AssemblyStep[];
  onSelectStep: (stepId: string) => void;
};

const AssemblyInstructionProperties = ({
  step,
  draftComponentNodeIds,
  selectedNodeIds,
  isAddingComponents,
  isDisabled,
  graphIndex,
  units,
  stepMaterials,
  stepSlides,
  stepTools,
  bomMaterials,
  onSelectComponents,
  onStartAddComponents,
  onStopAddComponents,
  onRemoveComponents,
  hiddenNodeIds,
  onSetHiddenComponents,
  isEditingMotion,
  editingUnitId,
  onEditMotion,
  onStopEditMotion,
  onResetMotion,
  onSetCamera,
  onClearCamera,
  viewerSteps,
  onSelectStep
}: AssemblyInstructionPropertiesProps) => {
  const { id: instructionId } = useParams();
  if (!instructionId) throw new Error("Could not find id");
  const { t } = useLingui();

  const subPlan = useMemo(
    () => buildSubAssemblyPlan(viewerSteps),
    [viewerSteps]
  );
  const viewerStepsById = useMemo(
    () => new Map(viewerSteps.map((viewerStep) => [viewerStep.id, viewerStep])),
    [viewerSteps]
  );
  const titleOf = useCallback(
    (stepId: string) => {
      const viewerStep = viewerStepsById.get(stepId);
      if (!viewerStep) return "";
      if (subPlan.get(stepId)?.isHeader) {
        return viewerStep.title || t`Sub-Assembly`;
      }
      return describeStep(viewerStep, graphIndex, units) ?? t`Untitled step`;
    },
    [viewerStepsById, subPlan, graphIndex, units, t]
  );
  const info = step ? subPlan.get(step.id) : undefined;
  const isHeader = info?.isHeader === true;
  const number = info?.number ?? null;
  const memberCount = step
    ? viewerSteps.filter((viewerStep) => viewerStep.parentStepId === step.id)
        .length
    : 0;
  const partCount = useMemo(
    () =>
      step && isHeader ? subAssemblyPartIds(viewerSteps, step.id).length : 0,
    [step, isHeader, viewerSteps]
  );

  const componentCount = (draftComponentNodeIds ?? step?.componentNodeIds ?? [])
    .length;
  const title = isHeader
    ? step?.title || t`Sub-Assembly`
    : (step &&
        (step.title ||
          describeStep(toStepDescriptor(step), graphIndex, units))) ||
      t`Untitled step`;
  const planFlag = useMemo(
    () => (step ? getPlanFlag(step, graphIndex) : null),
    [step, graphIndex]
  );

  // BOM parts the author can @-mention in a step's instruction — mirrors the
  // step-description editor in JobBillOfProcess (scoped to the item's BOM).
  const itemMentions = useMemo(
    () =>
      bomMaterials.map((material) => ({
        id: material.itemId,
        label:
          material.name ?? material.readableIdWithRevision ?? material.itemId,
        helper: material.name
          ? (material.readableIdWithRevision ?? undefined)
          : undefined
      })),
    [bomMaterials]
  );

  return (
    <VStack
      spacing={0}
      className="w-[450px] bg-background/30 h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border text-sm"
    >
      {/* Sticky panel header: which step you're editing, its status, and a
          one-glance summary (component count, flagged). */}
      <div className="sticky top-0 z-10 w-full min-w-0 flex-none border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        {step ? (
          <VStack spacing={1} className="w-full min-w-0">
            <HStack className="w-full min-w-0 items-center justify-between gap-2">
              <Subheading variant="heavy" className="shrink-0 tabular-nums">
                {isHeader
                  ? t`Sub-Assembly ${number}`
                  : number
                    ? t`Step ${number}`
                    : t`Step`}
              </Subheading>
              <AssemblyStepStatus status={normalizeStepStatus(step.status)} />
            </HStack>
            <h3 className="w-full min-w-0 truncate text-sm font-medium text-foreground">
              {title}
            </h3>
            <HStack className="w-full min-w-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
              {isHeader ? (
                <span>
                  <Plural value={memberCount} one="# step" other="# steps" />
                  {" · "}
                  <Plural value={partCount} one="# part" other="# parts" />
                </span>
              ) : (
                <span>
                  <Plural
                    value={componentCount}
                    one="# component"
                    other="# components"
                  />
                </span>
              )}
              {planFlag && (
                <>
                  <span aria-hidden>·</span>
                  <PlanFlagNote blockers={planFlag.blockers} />
                </>
              )}
            </HStack>
          </VStack>
        ) : (
          <Subheading variant="heavy">
            <Trans>Step</Trans>
          </Subheading>
        )}
      </div>
      {step && isHeader ? (
        <AssemblySubAssemblyProperties
          key={step.id}
          step={step}
          viewerSteps={viewerSteps}
          subPlan={subPlan}
          titleOf={titleOf}
          isDisabled={isDisabled}
          itemMentions={itemMentions}
          onSelectStep={onSelectStep}
          onSetCamera={onSetCamera}
          onClearCamera={onClearCamera}
          editingUnitId={editingUnitId}
          onEditMotion={onEditMotion}
          onStopEditMotion={onStopEditMotion}
          onResetMotion={onResetMotion}
        />
      ) : step ? (
        <Tabs defaultValue="details" className="w-full px-4 pb-2 pt-3">
          <TabsList className="w-full mb-4">
            <TabsTrigger className="flex-1" value="details">
              <Trans>Details</Trans>
            </TabsTrigger>
            <TabsTrigger className="flex-1" value="bom">
              <Trans>BOM</Trans>
            </TabsTrigger>
            <TabsTrigger className="flex-1" value="slides">
              <Trans>Slides</Trans>
            </TabsTrigger>
          </TabsList>
          {/* forceMount keeps unsaved form edits alive while the BOM tab is open */}
          <TabsContent
            value="details"
            forceMount
            className="data-[state=inactive]:hidden"
          >
            <StepForm
              key={step.id}
              step={step}
              draftComponentNodeIds={draftComponentNodeIds}
              selectedNodeIds={selectedNodeIds}
              isAddingComponents={isAddingComponents}
              isDisabled={isDisabled}
              graphIndex={graphIndex}
              units={units}
              itemMentions={itemMentions}
              onSelectComponents={onSelectComponents}
              onStartAddComponents={onStartAddComponents}
              onStopAddComponents={onStopAddComponents}
              onRemoveComponents={onRemoveComponents}
              hiddenNodeIds={hiddenNodeIds}
              onSetHiddenComponents={onSetHiddenComponents}
              isEditingMotion={isEditingMotion}
              editingUnitId={editingUnitId}
              onEditMotion={onEditMotion}
              onStopEditMotion={onStopEditMotion}
              onResetMotion={onResetMotion}
              onSetCamera={onSetCamera}
              onClearCamera={onClearCamera}
              viewerSteps={viewerSteps}
              subPlan={subPlan}
              titleOf={titleOf}
              onSelectStep={onSelectStep}
            />
          </TabsContent>
          <TabsContent value="bom">
            <VStack spacing={4} className="w-full py-2">
              <AssemblyStepMaterials
                stepId={step.id}
                instructionId={instructionId}
                materials={stepMaterials}
                bomMaterials={bomMaterials}
                isDisabled={isDisabled}
              />
              <AssemblyStepTools
                stepId={step.id}
                instructionId={instructionId}
                tools={stepTools}
                isDisabled={isDisabled}
              />
            </VStack>
          </TabsContent>
          <TabsContent value="slides">
            <VStack spacing={4} className="w-full py-2">
              <AssemblyStepSlides
                stepId={step.id}
                instructionId={instructionId}
                slides={stepSlides}
                isDisabled={isDisabled}
              />
            </VStack>
          </TabsContent>
        </Tabs>
      ) : (
        <div className="flex w-full flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <LuMousePointerClick className="size-5" />
          </div>
          <p className="text-sm font-medium text-foreground">
            <Trans>No step selected</Trans>
          </p>
          <p className="max-w-[30ch] text-xs text-muted-foreground">
            <Trans>
              Pick a step from the list to edit its details, components, and
              materials.
            </Trans>
          </p>
        </div>
      )}
    </VStack>
  );
};

/**
 * Planner flag: no collision-free path exists for these components. The player
 * fades them in at the seated pose; a manual motion overrides the flag.
 */
function getPlanFlag(
  step: Pick<AssemblyInstructionStepRow, "warnings" | "motion">,
  graphIndex: AssemblyGraphIndex | null
): { blockers: string[] } | null {
  const parsed = stepPlanWarningsSchema.safeParse(step.warnings);
  // A hand-drawn path overrides the planner's flag.
  if (
    !parsed.success ||
    parsed.data.flagged !== true ||
    hasCustomMotion(step.warnings, step.motion)
  ) {
    return null;
  }
  const blockers = (parsed.data.blockedBy ?? [])
    .map((nodeId) => graphIndex?.nodesById.get(nodeId)?.name)
    .filter((name): name is string => Boolean(name));
  return { blockers: [...new Set(blockers)] };
}

/** "No clear path" in plain muted text; the blocking parts live in the tooltip. */
function PlanFlagNote({ blockers }: { blockers: string[] }) {
  const { t } = useLingui();
  const note = (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <LuTriangleAlert className="size-3 shrink-0 text-amber-500" />
      <Trans>No clear path</Trans>
    </span>
  );
  if (blockers.length === 0) return note;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{note}</TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {t`Blocked by ${blockers.join(", ")}`}
      </TooltipContent>
    </Tooltip>
  );
}

/** The minimal descriptor `describeStep` needs to derive a title. */
function toStepDescriptor(step: AssemblyInstructionStepRow) {
  return {
    title: null,
    componentNodeIds: step.componentNodeIds ?? [],
    fastener: fastenerSchema.safeParse(step.fastener).data ?? null
  };
}

// Memoized: skips re-render on the route's per-frame motion-drag updates
// (draftMotion) — none of this panel's props change during a waypoint drag.
export default memo(AssemblyInstructionProperties);

function StepForm({
  step,
  draftComponentNodeIds,
  selectedNodeIds,
  isAddingComponents,
  isDisabled,
  graphIndex,
  units,
  itemMentions,
  onSelectComponents,
  onStartAddComponents,
  onStopAddComponents,
  onRemoveComponents,
  hiddenNodeIds,
  onSetHiddenComponents,
  isEditingMotion,
  editingUnitId,
  onEditMotion,
  onStopEditMotion,
  onResetMotion,
  onSetCamera,
  onClearCamera,
  viewerSteps,
  subPlan,
  titleOf,
  onSelectStep
}: {
  step: AssemblyInstructionStepRow;
  draftComponentNodeIds: string[] | null;
  selectedNodeIds: string[];
  isAddingComponents: boolean;
  isDisabled: boolean;
  graphIndex: AssemblyGraphIndex | null;
  units: NamedUnit[];
  itemMentions: { id: string; label: string; helper?: string }[];
  onSelectComponents: (nodeIds: string[]) => void;
  onStartAddComponents: () => void;
  onStopAddComponents: () => void;
  onRemoveComponents: (nodeIds: string[]) => void;
  hiddenNodeIds: string[];
  onSetHiddenComponents: (nodeIds: string[]) => void;
  isEditingMotion: boolean;
  editingUnitId: string | null;
  onEditMotion: (stepId: string, unitHeaderId?: string) => void;
  onStopEditMotion: () => void;
  onResetMotion: (stepId: string) => void;
  onSetCamera: (stepId: string) => void;
  onClearCamera: (stepId: string) => void;
  viewerSteps: AssemblyStep[];
  subPlan: Map<string, SubAssemblyInfo>;
  titleOf: (stepId: string) => string;
  onSelectStep: (stepId: string) => void;
}) {
  const { id: instructionId } = useParams();
  if (!instructionId) throw new Error("Could not find id");

  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{ success: boolean }>();

  const [stepType, setStepType] = useState<(typeof procedureStepType)[number]>(
    step.type ?? "Task"
  );
  const [description, setDescription] = useState<JSONContent>(
    (step.description as JSONContent) ?? {}
  );

  const typeOptions = useMemo(
    () =>
      procedureStepType.map((type) => ({
        label: (
          <HStack>
            <ProcedureStepTypeIcon type={type} className="mr-2" />
            {type}
          </HStack>
        ),
        value: type
      })),
    []
  );

  const onUploadImage = useImageUpload(`assembly/${instructionId}`);

  const componentNodeIds = draftComponentNodeIds ?? step.componentNodeIds ?? [];

  const cannotSave = isDisabled || !permissions.can("update", "production");

  const hasCamera = step.camera != null;

  // Title shown when the title field is left blank — derived from the components
  // plus any stored fastener, matching how the step is titled elsewhere.
  const derivedTitle = useMemo(() => {
    const parsedFastener = fastenerSchema.safeParse(step.fastener);
    return describeStep(
      {
        title: null,
        componentNodeIds,
        fastener: parsedFastener.success ? parsedFastener.data : null
      },
      graphIndex,
      units
    );
  }, [componentNodeIds, step.fastener, graphIndex, units]);

  const planFlag = useMemo(
    () => getPlanFlag(step, graphIndex),
    [step, graphIndex]
  );
  const customMotion = hasCustomMotion(step.warnings, step.motion);

  const carriedIn = useMemo(
    () =>
      viewerSteps.filter(
        (viewerStep) =>
          subPlan.get(viewerStep.id)?.isHeader &&
          viewerStep.usedInStepId === step.id
      ),
    [viewerSteps, subPlan, step.id]
  );

  return (
    <ValidatedForm
      validator={assemblyInstructionStepValidator}
      method="post"
      action={path.to.assemblyInstructionStep(instructionId, step.id)}
      defaultValues={{
        id: step.id,
        assemblyInstructionId: instructionId,
        title: step.title ?? "",
        type: step.type ?? "Task",
        required: step.required ?? false,
        unitOfMeasureCode: step.unitOfMeasureCode ?? "",
        minValue: step.minValue ?? undefined,
        maxValue: step.maxValue ?? undefined,
        listValues: step.listValues ?? []
      }}
      fetcher={fetcher}
      className="w-full"
    >
      <Hidden name="id" />
      <Hidden name="assemblyInstructionId" />
      <Hidden name="description" value={JSON.stringify(description)} />
      <Hidden
        name="componentNodeIds"
        value={JSON.stringify(componentNodeIds)}
      />
      <VStack spacing={4} className="w-full pb-4">
        <SelectControlled
          name="type"
          label={t`Type`}
          options={typeOptions}
          value={stepType}
          isReadOnly={isDisabled}
          onChange={(option) => {
            if (option) {
              setStepType(option.value as (typeof procedureStepType)[number]);
            }
          }}
        />
        <Input
          name="title"
          label={t`Title`}
          placeholder={derivedTitle ?? t`Untitled step`}
        />
        <VStack spacing={2} className="w-full">
          <Label>
            <Trans>Instruction</Trans>
          </Label>
          <Editor
            initialValue={(step.description as JSONContent) ?? {}}
            onUpload={onUploadImage}
            onChange={(value) => {
              setDescription(value);
            }}
            mentions={[{ char: "@", items: itemMentions }]}
            className="[&_.is-empty]:text-muted-foreground min-h-[88px] max-h-[360px] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent p-3 rounded-lg border w-full"
          />
        </VStack>

        {stepType === "Measurement" && (
          <VStack spacing={2} className="w-full">
            <UnitOfMeasure
              name="unitOfMeasureCode"
              label={t`Unit of Measure`}
            />
            <div className="grid grid-cols-2 gap-2 w-full">
              <Number
                name="minValue"
                label={t`Minimum`}
                formatOptions={{
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 10
                }}
              />
              <Number
                name="maxValue"
                label={t`Maximum`}
                formatOptions={{
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 10
                }}
              />
            </div>
          </VStack>
        )}
        {stepType === "List" && (
          <ArrayInput name="listValues" label={t`List Options`} />
        )}
        <BooleanInput
          name="required"
          label={t`Required`}
          description={t`Operator must record this step`}
        />

        <StepComponentsEditor
          stepId={step.id}
          viewerSteps={viewerSteps}
          subPlan={subPlan}
          titleOf={titleOf}
          onSelectStep={onSelectStep}
          componentNodeIds={componentNodeIds}
          graphIndex={graphIndex}
          selectedNodeIds={selectedNodeIds}
          isAddingComponents={isAddingComponents}
          isDisabled={isDisabled}
          onSelectComponents={onSelectComponents}
          onStartAddComponents={onStartAddComponents}
          onStopAddComponents={onStopAddComponents}
          onRemoveComponents={onRemoveComponents}
        />

        <StepHiddenComponentsEditor
          hiddenNodeIds={hiddenNodeIds}
          graphIndex={graphIndex}
          isDisabled={isDisabled}
          onSetHiddenComponents={onSetHiddenComponents}
        />

        <VStack spacing={2} className="w-full">
          <Subheading as="h4" variant="heavy">
            <Trans>Playback</Trans>
          </Subheading>
          <div className="w-full divide-y divide-border rounded-lg border border-border bg-card">
            <PlaybackRow
              label={
                <LabelWithHelp termId="assembly-step-motion" variant="inline">
                  <Trans>Motion</Trans>
                </LabelWithHelp>
              }
              value={
                isEditingMotion ? (
                  <Trans>Drag the red waypoints in the viewer</Trans>
                ) : customMotion ? (
                  <Trans>Custom path</Trans>
                ) : planFlag ? (
                  <span className="inline-flex items-center gap-1">
                    <LuTriangleAlert className="size-3.5 shrink-0 text-amber-500" />
                    <Trans>No clear path</Trans>
                  </span>
                ) : componentNodeIds.length === 0 ? (
                  <Trans>Add components first</Trans>
                ) : (
                  <Trans>Automatic</Trans>
                )
              }
            >
              {!isDisabled && (
                <HStack spacing={1} className="shrink-0">
                  {customMotion && !isEditingMotion && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onResetMotion(step.id)}
                    >
                      <Trans>Reset</Trans>
                    </Button>
                  )}
                  <Button
                    variant={isEditingMotion ? "primary" : "secondary"}
                    size="sm"
                    isDisabled={componentNodeIds.length === 0}
                    onClick={() =>
                      isEditingMotion
                        ? onStopEditMotion()
                        : onEditMotion(step.id)
                    }
                  >
                    {isEditingMotion ? (
                      <Trans>Done Editing Path</Trans>
                    ) : (
                      <Trans>Edit Path</Trans>
                    )}
                  </Button>
                </HStack>
              )}
            </PlaybackRow>
            {carriedIn.map((header) => (
              <SubAssemblyPathRow
                key={header.id}
                name={titleOf(header.id)}
                hasPath={header.motion.type !== "none"}
                isEditing={editingUnitId === header.id}
                isDisabled={isDisabled}
                onEdit={() => onEditMotion(step.id, header.id)}
                onStopEdit={onStopEditMotion}
                onReset={() => onResetMotion(header.id)}
              />
            ))}
            <PlaybackRow
              label={
                <LabelWithHelp termId="assembly-step-camera" variant="inline">
                  <Trans>Camera</Trans>
                </LabelWithHelp>
              }
              value={
                hasCamera ? <Trans>Saved view</Trans> : <Trans>Automatic</Trans>
              }
            >
              {!isDisabled && (
                <HStack spacing={1}>
                  {hasCamera && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onClearCamera(step.id)}
                    >
                      <Trans>Clear</Trans>
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onSetCamera(step.id)}
                  >
                    <Trans>Use Current View</Trans>
                  </Button>
                </HStack>
              )}
            </PlaybackRow>
          </div>
        </VStack>

        {/* Pinned so Save is always on screen; the panel is the scroll container */}
        <div className="sticky bottom-0 z-10 -mx-4 w-[calc(100%+2rem)] border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
          <Submit
            isDisabled={cannotSave || fetcher.state !== "idle"}
            isLoading={fetcher.state !== "idle"}
          >
            <Trans>Save</Trans>
          </Submit>
        </div>
      </VStack>
    </ValidatedForm>
  );
}

/**
 * The step's assigned components as an explicit, editable list. Clicking a row
 * makes that component the active selection (red in the viewer, marked in the
 * Components panel); the ✕ removes it from the step. Components are only *added*
 * through "Add components", which clears the selection and appends whatever you
 * pick next — so ordinary selection never mutates a step's components. Add/remove
 * autosave immediately.
 */
function StepComponentsEditor({
  stepId,
  viewerSteps,
  subPlan,
  titleOf,
  onSelectStep,
  componentNodeIds,
  graphIndex,
  selectedNodeIds,
  isAddingComponents,
  isDisabled,
  onSelectComponents,
  onStartAddComponents,
  onStopAddComponents,
  onRemoveComponents
}: {
  stepId: string;
  viewerSteps: AssemblyStep[];
  subPlan: Map<string, SubAssemblyInfo>;
  titleOf: (stepId: string) => string;
  onSelectStep: (stepId: string) => void;
  componentNodeIds: string[];
  graphIndex: AssemblyGraphIndex | null;
  selectedNodeIds: string[];
  isAddingComponents: boolean;
  isDisabled: boolean;
  onSelectComponents: (nodeIds: string[]) => void;
  onStartAddComponents: () => void;
  onStopAddComponents: () => void;
  onRemoveComponents: (nodeIds: string[]) => void;
}) {
  const groups = useMemo(
    () =>
      graphIndex ? groupComponentNodeIds(componentNodeIds, graphIndex) : [],
    [componentNodeIds, graphIndex]
  );
  const selectedSet = useMemo(
    () => new Set(selectedNodeIds),
    [selectedNodeIds]
  );

  const { t } = useLingui();
  const { id: instructionId } = useParams();
  if (!instructionId) throw new Error("Could not find id");
  const [, setSearchParams] = useSearchParams();
  const subAssemblyFetcher = useFetcher<{ success: boolean }>();

  // Sub-assemblies this step fits as one piece, and the ones it could.
  const usedSubAssemblies = viewerSteps
    .filter(
      (viewerStep) =>
        subPlan.get(viewerStep.id)?.isHeader &&
        viewerStep.usedInStepId === stepId
    )
    .map((header) => ({
      headerId: header.id,
      number: subPlan.get(header.id)?.number ?? "",
      title: titleOf(header.id),
      partCount: subAssemblyPartIds(viewerSteps, header.id).length
    }));
  const useOptions = usableSubAssemblies(viewerSteps, stepId).map((option) => {
    const header = viewerSteps.find((s) => s.id === option.headerId);
    const usedIn = header?.usedInStepId ?? null;
    const note =
      option.reason === "own"
        ? t`This step is part of it`
        : option.reason === "before"
          ? t`Built after this step`
          : usedIn === stepId
            ? t`Used in this step`
            : usedIn
              ? t`Used in ${subPlan.get(usedIn)?.number ?? ""} — moves here`
              : null;
    return {
      headerId: option.headerId,
      label: `${subPlan.get(option.headerId)?.number ?? ""} · ${titleOf(
        option.headerId
      )}`,
      note,
      isDisabled: option.reason !== null || usedIn === stepId
    };
  });
  const setUsedIn = (headerId: string, usedInStepId: string) => {
    const formData = new FormData();
    formData.append("usedInStepId", usedInStepId);
    subAssemblyFetcher.submit(formData, {
      method: "post",
      action: path.to.assemblySubAssembly(instructionId, headerId)
    });
  };
  const openSubAssembly = (headerId: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(SUB_ASSEMBLY_PARAM, headerId);
        return next;
      },
      { preventScrollReset: true }
    );

  return (
    <VStack spacing={2} className="w-full">
      <HStack className="w-full flex-wrap justify-between gap-y-2">
        <Subheading
          as="h4"
          variant="heavy"
          className="shrink-0 whitespace-nowrap tabular-nums"
        >
          <Trans>Components</Trans> · {componentNodeIds.length}
        </Subheading>
        {!isDisabled && (
          <HStack spacing={1} className="ml-auto">
            {useOptions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="sm" leftIcon={<LuBoxes />}>
                    <Trans>Use Sub-Assembly</Trans>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="min-w-[16rem] max-w-[20rem]"
                >
                  <DropdownMenuLabel>
                    <Trans>Use a finished sub-assembly in this step</Trans>
                  </DropdownMenuLabel>
                  {useOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.headerId}
                      disabled={option.isDisabled}
                      onClick={() => setUsedIn(option.headerId, stepId)}
                    >
                      <div className="min-w-0">
                        <span className="block truncate">{option.label}</span>
                        {option.note && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {option.note}
                          </span>
                        )}
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              variant={isAddingComponents ? "primary" : "secondary"}
              size="sm"
              leftIcon={isAddingComponents ? undefined : <LuCirclePlus />}
              onClick={() =>
                isAddingComponents
                  ? onStopAddComponents()
                  : onStartAddComponents()
              }
            >
              {isAddingComponents ? (
                <Trans>Done Adding</Trans>
              ) : (
                <Trans>Add</Trans>
              )}
            </Button>
          </HStack>
        )}
      </HStack>
      {isAddingComponents && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            Click components in the viewer to add them. Shift-click adds
            several.
          </Trans>
        </p>
      )}
      {usedSubAssemblies.length > 0 && (
        <ul className="w-full divide-y divide-border rounded-lg border border-border">
          {usedSubAssemblies.map((used) => (
            <li
              key={used.headerId}
              className="group flex w-full items-center gap-2 px-2 py-1.5 text-sm"
            >
              <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground">
                <LuBoxes className="size-3.5" />
              </span>
              <button
                type="button"
                className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onClick={() => onSelectStep(used.headerId)}
              >
                <span className="block truncate font-medium">{used.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  <Trans>
                    Sub-Assembly {used.number} ·{" "}
                    <Plural
                      value={used.partCount}
                      one="# part"
                      other="# parts"
                    />
                  </Trans>
                </span>
              </button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openSubAssembly(used.headerId)}
              >
                <Trans>Open</Trans>
              </Button>
              {!isDisabled && (
                <IconButton
                  aria-label={t`Stop using ${used.title} in this step`}
                  icon={<LuX />}
                  variant="ghost"
                  size="sm"
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                  onClick={() => setUsedIn(used.headerId, "")}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {groups.length === 0 ? (
        usedSubAssemblies.length === 0 && (
          <p className="text-xs text-muted-foreground">
            <Trans>No components yet</Trans>
          </p>
        )
      ) : (
        <ul className="max-h-64 w-full divide-y divide-border overflow-y-auto rounded-lg border border-border scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
          {groups.map((group) => {
            const isSelected = group.nodeIds.every((nodeId) =>
              selectedSet.has(nodeId)
            );
            return (
              <li
                key={group.key}
                role="button"
                tabIndex={0}
                className={cn(
                  "group flex w-full cursor-pointer select-none items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent/30",
                  isSelected && "bg-blue-500/10 hover:bg-blue-500/10"
                )}
                onClick={() => onSelectComponents(group.nodeIds)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectComponents(group.nodeIds);
                  }
                }}
              >
                <ComponentColorSwatch color={group.color} />
                <span className="min-w-0 flex-1 truncate" title={group.name}>
                  {group.name}
                </span>
                {group.count > 1 && (
                  <Badge variant="secondary" className="tabular-nums">
                    ×{group.count}
                  </Badge>
                )}
                {!isDisabled && (
                  <IconButton
                    aria-label={t`Remove ${group.name} from this step`}
                    icon={<LuX />}
                    variant="ghost"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveComponents(group.nodeIds);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </VStack>
  );
}

/** Parts are hidden from the Components panel eye; here they can only be shown again. */
function StepHiddenComponentsEditor({
  hiddenNodeIds,
  graphIndex,
  isDisabled,
  onSetHiddenComponents
}: {
  hiddenNodeIds: string[];
  graphIndex: AssemblyGraphIndex | null;
  isDisabled: boolean;
  onSetHiddenComponents: (nodeIds: string[]) => void;
}) {
  const { t } = useLingui();
  // "Show all" saves at once but stays undoable for SHOW_ALL_UNDO_MS, so a stray
  // click can't silently throw away a step's tuned hidden list.
  const [undoNodeIds, setUndoNodeIds] = useState<string[] | null>(null);
  useEffect(() => {
    if (!undoNodeIds) return;
    const timer = setTimeout(() => setUndoNodeIds(null), SHOW_ALL_UNDO_MS);
    return () => clearTimeout(timer);
  }, [undoNodeIds]);
  const isUndoPending = undoNodeIds !== null;
  const listedNodeIds = undoNodeIds ?? hiddenNodeIds;

  const groups = useMemo(
    () => (graphIndex ? groupComponentNodeIds(listedNodeIds, graphIndex) : []),
    [listedNodeIds, graphIndex]
  );
  const onShow = (nodeIds: string[]) => {
    const show = new Set(nodeIds);
    onSetHiddenComponents(hiddenNodeIds.filter((nodeId) => !show.has(nodeId)));
  };

  const onShowAll = () => {
    setUndoNodeIds(hiddenNodeIds);
    onSetHiddenComponents([]);
  };

  // Restore the shown parts, keeping anything hidden elsewhere in the meantime.
  const onHideAgain = () => {
    if (!undoNodeIds) return;
    onSetHiddenComponents([...new Set([...hiddenNodeIds, ...undoNodeIds])]);
    setUndoNodeIds(null);
  };

  return (
    <VStack spacing={2} className="w-full">
      <HStack className="w-full justify-between">
        <Subheading as="h4" variant="heavy">
          <LabelWithHelp
            termId="assembly-step-hidden-components"
            variant="inline"
          >
            <Trans>Hidden on this step</Trans>
          </LabelWithHelp>
        </Subheading>
        {groups.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            <Trans>None</Trans>
          </span>
        ) : (
          !isDisabled &&
          (isUndoPending ? (
            <HideAgainButton onClick={onHideAgain} />
          ) : (
            <Button variant="secondary" size="sm" onClick={onShowAll}>
              <Trans>Show All</Trans>
            </Button>
          ))
        )}
      </HStack>
      {groups.length === 0 ? null : (
        <ul className="max-h-64 w-full divide-y divide-border overflow-y-auto rounded-lg border border-border scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
          {groups.map((group) => (
            <li
              key={group.key}
              className={cn(
                "flex w-full items-center gap-2 px-2 py-1.5 text-sm",
                isUndoPending && "opacity-50"
              )}
            >
              <ComponentColorSwatch color={group.color} />
              <span
                className="min-w-0 flex-1 truncate text-muted-foreground"
                title={group.name}
              >
                {group.name}
              </span>
              {group.count > 1 && (
                <Badge variant="secondary" className="tabular-nums">
                  ×{group.count}
                </Badge>
              )}
              {!isDisabled && !isUndoPending && (
                <IconButton
                  aria-label={t`Show ${group.name}`}
                  icon={<LuEyeOff />}
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => onShow(group.nodeIds)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </VStack>
  );
}

const SHOW_ALL_UNDO_MS = 4000;

function HideAgainButton({ onClick }: { onClick: () => void }) {
  const [isDraining, setIsDraining] = useState(false);
  useEffect(() => {
    // Start full, then drain on the next frame so the width transition runs.
    const frame = requestAnimationFrame(() => setIsDraining(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <Button
      variant="secondary"
      size="sm"
      className="relative overflow-hidden"
      onClick={onClick}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 bg-primary/15"
        style={{
          width: isDraining ? "0%" : "100%",
          transition: `width ${SHOW_ALL_UNDO_MS}ms linear`
        }}
      />
      <span className="relative">
        <Trans>Hide Again</Trans>
      </span>
    </Button>
  );
}
