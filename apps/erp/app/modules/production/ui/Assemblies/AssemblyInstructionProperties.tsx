import { useCarbon } from "@carbon/auth";
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
  HStack,
  IconButton,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import type { AssemblyGraphIndex, NamedUnit } from "@carbon/viewer";
import { describeStep, groupComponentNodeIds } from "@carbon/viewer";
import { nanoid } from "nanoid";
import { memo, useMemo, useState } from "react";
import {
  LuCirclePlus,
  LuMousePointerClick,
  LuTriangleAlert,
  LuX
} from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { UnitOfMeasure } from "~/components/Form";
import { ProcedureStepTypeIcon } from "~/components/Icons";
import { usePermissions, useUser } from "~/hooks";
import { procedureStepType } from "~/modules/shared";
import { getPrivateUrl, path } from "~/utils/path";
import {
  assemblyInstructionStepValidator,
  fastenerSchema,
  stepPlanWarningsSchema
} from "../../production.models";
import type { FlattenedBomMaterial } from "../../production.service";
import type {
  AssemblyInstructionStepRow,
  AssemblyStandardNote,
  AssemblyStepMaterial,
  AssemblyStepRequirement
} from "../../types";
import AssemblyStepBom, { ComponentColorSwatch } from "./AssemblyStepBom";
import AssemblyStepMaterials from "./AssemblyStepMaterials";
import AssemblyStepRequirements from "./AssemblyStepRequirements";

type AssemblyInstructionPropertiesProps = {
  step: AssemblyInstructionStepRow | null;
  /** Zero-based index of the selected step; null when nothing is selected */
  stepIndex: number | null;
  /** Total step count, for the "Step N of M" header */
  stepCount: number;
  draftComponentNodeIds: string[] | null;
  /** Current viewer/Components-panel selection — marks the matching component rows */
  selectedNodeIds: string[];
  /** Add-mode is on — picking components appends them to this step */
  isAddingComponents: boolean;
  isDisabled: boolean;
  graphIndex: AssemblyGraphIndex | null;
  /** Authored subassembly units — a step matching one is titled by its name. */
  units: NamedUnit[];
  requirements: AssemblyStepRequirement[];
  stepMaterials: AssemblyStepMaterial[];
  bomMaterials: FlattenedBomMaterial[];
  standardNotes: AssemblyStandardNote[];
  onSelectComponents: (nodeIds: string[]) => void;
  onStartAddComponents: () => void;
  onStopAddComponents: () => void;
  onRemoveComponents: (nodeIds: string[]) => void;
  /** The active step's motion path is open in the 3D editor */
  isEditingMotion: boolean;
  onEditMotion: (stepId: string) => void;
  onStopEditMotion: () => void;
  onSetCamera: (stepId: string) => void;
  onClearCamera: (stepId: string) => void;
};

const AssemblyInstructionProperties = ({
  step,
  stepIndex,
  stepCount,
  draftComponentNodeIds,
  selectedNodeIds,
  isAddingComponents,
  isDisabled,
  graphIndex,
  units,
  requirements,
  stepMaterials,
  bomMaterials,
  standardNotes,
  onSelectComponents,
  onStartAddComponents,
  onStopAddComponents,
  onRemoveComponents,
  isEditingMotion,
  onEditMotion,
  onStopEditMotion,
  onSetCamera,
  onClearCamera
}: AssemblyInstructionPropertiesProps) => {
  const { id: instructionId } = useParams();
  if (!instructionId) throw new Error("Could not find id");

  const componentCount = (draftComponentNodeIds ?? step?.componentNodeIds ?? [])
    .length;
  const title =
    (step &&
      (step.title ||
        describeStep(toStepDescriptor(step), graphIndex, units))) ||
    "Untitled step";
  const flagged =
    step != null &&
    stepPlanWarningsSchema.safeParse(step.warnings).data?.flagged === true;

  return (
    <VStack
      spacing={0}
      className="w-[450px] bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border text-sm"
    >
      {/* Sticky panel header: which step you're editing, its status, and a
          one-glance summary (component count, flagged). */}
      <div className="sticky top-0 z-10 w-full min-w-0 flex-none border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
        {step ? (
          <VStack spacing={1} className="w-full min-w-0">
            <HStack className="w-full min-w-0 items-center justify-between gap-2">
              <span className="shrink-0 text-xxs font-medium uppercase tracking-wide text-muted-foreground tabular-nums">
                {stepIndex != null
                  ? `Step ${stepIndex + 1} of ${stepCount}`
                  : "Step"}
              </span>
              <StepStatusPill status={normalizeStatus(step.status)} />
            </HStack>
            <h3 className="w-full min-w-0 truncate text-sm font-medium text-foreground">
              {title}
            </h3>
            <HStack className="w-full min-w-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
              <span>
                {componentCount}{" "}
                {componentCount === 1 ? "component" : "components"}
              </span>
              {flagged && (
                <>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500">
                    <LuTriangleAlert className="size-3" />
                    No collision-free path
                  </span>
                </>
              )}
            </HStack>
          </VStack>
        ) : (
          <span className="text-xxs font-medium uppercase tracking-wide text-muted-foreground">
            Step
          </span>
        )}
      </div>
      {step ? (
        <Tabs defaultValue="details" className="w-full px-4 pb-2 pt-3">
          <TabsList className="w-full mb-4">
            <TabsTrigger className="flex-1" value="details">
              Details
            </TabsTrigger>
            <TabsTrigger className="flex-1" value="bom">
              BOM
            </TabsTrigger>
            <TabsTrigger className="flex-1" value="requirements">
              Requirements
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
              onSelectComponents={onSelectComponents}
              onStartAddComponents={onStartAddComponents}
              onStopAddComponents={onStopAddComponents}
              onRemoveComponents={onRemoveComponents}
              isEditingMotion={isEditingMotion}
              onEditMotion={onEditMotion}
              onStopEditMotion={onStopEditMotion}
              onSetCamera={onSetCamera}
              onClearCamera={onClearCamera}
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
              <AssemblyStepBom
                componentNodeIds={
                  draftComponentNodeIds ?? step.componentNodeIds ?? []
                }
                graphIndex={graphIndex}
              />
            </VStack>
          </TabsContent>
          <TabsContent value="requirements">
            <AssemblyStepRequirements
              stepId={step.id}
              instructionId={instructionId}
              requirements={requirements}
              standardNotes={standardNotes}
              isDisabled={isDisabled}
            />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="flex w-full flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <LuMousePointerClick className="size-5" />
          </div>
          <p className="text-sm font-medium text-foreground">
            No step selected
          </p>
          <p className="max-w-[30ch] text-xs text-muted-foreground">
            Pick a step from the list to edit its details, components, and
            materials.
          </p>
        </div>
      )}
    </VStack>
  );
};

const stepStatusStyles: Record<string, string> = {
  Todo: "bg-red-500",
  Review: "bg-yellow-500",
  Done: "bg-green-500"
};

function normalizeStatus(status: string | null | undefined): string {
  return status && status in stepStatusStyles ? status : "Todo";
}

/** Compact status chip for the panel header — mirrors the Explorer's status dot. */
function StepStatusPill({ status }: { status: string }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md border border-border px-1.5 text-xxs font-medium text-foreground">
      <span
        className={cn(
          "block size-1.5 shrink-0 rounded-full",
          stepStatusStyles[status] ?? stepStatusStyles.Todo
        )}
      />
      {status}
    </span>
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
  onSelectComponents,
  onStartAddComponents,
  onStopAddComponents,
  onRemoveComponents,
  isEditingMotion,
  onEditMotion,
  onStopEditMotion,
  onSetCamera,
  onClearCamera
}: {
  step: AssemblyInstructionStepRow;
  draftComponentNodeIds: string[] | null;
  selectedNodeIds: string[];
  isAddingComponents: boolean;
  isDisabled: boolean;
  graphIndex: AssemblyGraphIndex | null;
  units: NamedUnit[];
  onSelectComponents: (nodeIds: string[]) => void;
  onStartAddComponents: () => void;
  onStopAddComponents: () => void;
  onRemoveComponents: (nodeIds: string[]) => void;
  isEditingMotion: boolean;
  onEditMotion: (stepId: string) => void;
  onStopEditMotion: () => void;
  onSetCamera: (stepId: string) => void;
  onClearCamera: (stepId: string) => void;
}) {
  const { id: instructionId } = useParams();
  if (!instructionId) throw new Error("Could not find id");

  const permissions = usePermissions();
  const fetcher = useFetcher<{ success: boolean }>();
  const { carbon } = useCarbon();
  const {
    company: { id: companyId }
  } = useUser();

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

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/assembly/${instructionId}/${nanoid()}.${fileType}`;

    const result = await carbon?.storage.from("private").upload(fileName, file);

    if (result?.error) {
      toast.error("Failed to upload image");
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

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

  // Planner flag: no collision-free path exists for these components. The player
  // fades them in at the seated pose; a manual motion overrides the flag.
  const planFlag = useMemo(() => {
    const parsed = stepPlanWarningsSchema.safeParse(step.warnings);
    if (!parsed.success || parsed.data.flagged !== true) return null;
    const blockers = (parsed.data.blockedBy ?? [])
      .map((nodeId) => graphIndex?.nodesById.get(nodeId)?.name)
      .filter((name): name is string => Boolean(name));
    return { blockers: [...new Set(blockers)] };
  }, [step.warnings, graphIndex]);

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
          label="Type"
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
          label="Title"
          placeholder={derivedTitle ?? "Untitled step"}
        />
        <VStack spacing={2} className="w-full">
          <Label>Instruction</Label>
          <Editor
            initialValue={(step.description as JSONContent) ?? {}}
            onUpload={onUploadImage}
            onChange={(value) => {
              setDescription(value);
            }}
            className="[&_.is-empty]:text-muted-foreground min-h-[88px] max-h-[360px] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent p-3 rounded-lg border w-full"
          />
        </VStack>

        {stepType === "Measurement" && (
          <VStack spacing={2} className="w-full">
            <UnitOfMeasure name="unitOfMeasureCode" label="Unit of Measure" />
            <div className="grid grid-cols-2 gap-2 w-full">
              <Number
                name="minValue"
                label="Minimum"
                formatOptions={{
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 10
                }}
              />
              <Number
                name="maxValue"
                label="Maximum"
                formatOptions={{
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 10
                }}
              />
            </div>
          </VStack>
        )}
        {stepType === "List" && (
          <ArrayInput name="listValues" label="List Options" />
        )}
        <BooleanInput
          name="required"
          label="Required"
          description="Operators must record this step to complete the operation"
        />

        <h4 className="w-full pt-1 text-xxs font-medium uppercase tracking-wide text-muted-foreground">
          Playback &amp; components
        </h4>
        <VStack
          spacing={2}
          className="w-full rounded-lg border border-border bg-muted/40 p-3"
        >
          <HStack className="w-full justify-between">
            <Label className="text-xxs font-medium uppercase tracking-wide text-muted-foreground">
              Motion
            </Label>
            {!isDisabled && (
              <Button
                variant={isEditingMotion ? "primary" : "secondary"}
                size="sm"
                isDisabled={componentNodeIds.length === 0}
                onClick={() =>
                  isEditingMotion ? onStopEditMotion() : onEditMotion(step.id)
                }
              >
                {isEditingMotion ? "Done editing path" : "Edit path"}
              </Button>
            )}
          </HStack>
          {componentNodeIds.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Assign components to this step to edit its motion path.
            </p>
          ) : isEditingMotion ? (
            <p className="text-xs text-muted-foreground">
              Drag the red waypoints in the viewer to shape the insertion path.
              Double-click the path to add a waypoint; select one and press
              Delete to remove it.
            </p>
          ) : planFlag ? (
            <p className="text-xs text-muted-foreground">
              No collision-free insertion path was found
              {planFlag.blockers.length > 0
                ? ` — blocked by ${planFlag.blockers.join(", ")}`
                : ""}
              . Edit the path to author one.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Edit the path to adjust how these components move into place.
            </p>
          )}
        </VStack>

        <VStack
          spacing={2}
          className="w-full rounded-lg border border-border bg-muted/40 p-3"
        >
          <Label className="text-xxs font-medium uppercase tracking-wide text-muted-foreground">
            Camera
          </Label>
          <p className="text-xs text-muted-foreground">
            {hasCamera
              ? "A saved view frames this step during playback."
              : "This step auto-frames during playback. Orbit to the angle you want, then save it."}
          </p>
          {!isDisabled && (
            <HStack spacing={2}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onSetCamera(step.id)}
              >
                Set camera to current view
              </Button>
              {hasCamera && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onClearCamera(step.id)}
                >
                  Clear view
                </Button>
              )}
            </HStack>
          )}
        </VStack>

        <StepComponentsEditor
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

        <Submit
          isDisabled={cannotSave || fetcher.state !== "idle"}
          isLoading={fetcher.state !== "idle"}
        >
          Save Step
        </Submit>
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

  return (
    <VStack
      spacing={2}
      className="w-full rounded-lg border border-border bg-muted/40 p-3"
    >
      <HStack className="w-full justify-between">
        <Label className="text-xxs font-medium uppercase tracking-wide text-muted-foreground">
          Components
        </Label>
        {!isDisabled && (
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
            {isAddingComponents ? "Done adding" : "Add components"}
          </Button>
        )}
      </HStack>
      {isAddingComponents && (
        <p className="text-xs text-muted-foreground">
          Click components in the viewer or the Components panel to add them to
          this step. Shift-click to add several.
        </p>
      )}
      {groups.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {isAddingComponents
            ? "No components yet — pick components in the viewer to add them."
            : "No components assigned. Click Add components, then pick components in the viewer."}
        </p>
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
                <Badge variant="secondary" className="tabular-nums">
                  ×{group.count}
                </Badge>
                {!isDisabled && (
                  <IconButton
                    aria-label={`Remove ${group.name} from this step`}
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
