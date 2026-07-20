import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  Button,
  ClientOnly,
  Spinner,
  toast,
  useInterval,
  useMode
} from "@carbon/react";
import type {
  AssemblyGraph,
  AssemblyPlayerHandle,
  CameraPose,
  Motion
} from "@carbon/viewer";
import { AssemblyPlayer, indexAssemblyGraph } from "@carbon/viewer";
import { msg } from "@lingui/core/macro";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useFetcher,
  useLoaderData,
  useParams,
  useRevalidator
} from "react-router";
import { Empty } from "~/components";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { usePermissions } from "~/hooks";
import {
  assemblyInstructionValidator,
  getAssemblyComponentMappings,
  getAssemblyInstruction,
  getAssemblyInstructionStepMaterials,
  getAssemblyInstructionStepRequirements,
  getAssemblyInstructionSteps,
  getAssemblyPlanJson,
  getAssemblyStandardNotes,
  getAssemblyUnits,
  getFlattenedBomMaterials,
  getLatestAssemblyPlanJob,
  isAssemblyPlanRunning,
  toViewerStep,
  upsertAssemblyInstruction
} from "~/modules/production";
import { isAssemblerServiceHealthy } from "~/modules/production/production.server";
import AssemblyInstructionExplorer from "~/modules/production/ui/Assemblies/AssemblyInstructionExplorer";
import AssemblyInstructionHeader from "~/modules/production/ui/Assemblies/AssemblyInstructionHeader";
import AssemblyInstructionProperties from "~/modules/production/ui/Assemblies/AssemblyInstructionProperties";
import { ModelConvertProgress } from "~/modules/production/ui/Assemblies/ModelConvertProgress";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { getPrivateUrl, path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Assemblies`, to: path.to.assemblyInstructions },
    (data) => data?.instruction?.name
  ),
  module: "production"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [instruction, steps, standardNotes] = await Promise.all([
    getAssemblyInstruction(client, id),
    getAssemblyInstructionSteps(client, id),
    getAssemblyStandardNotes(client, companyId)
  ]);

  const instructionError = instruction.error;
  if (instructionError || !instruction.data) {
    // A deleted/absent instruction is a normal not-found (PGRST116 = no rows),
    // not a server error. A stale tab left open on a deleted instruction keeps
    // revalidating (realtime + poll); logging error() on every hit spams the
    // service log. Log only genuine DB errors; redirect quietly otherwise.
    // Entered when there's an error OR no row. Not-found = a PGRST116 (no rows)
    // error, or the no-error-no-row case; a genuine DB error falls through to
    // error() so it's still logged.
    const notFound = !instructionError || instructionError.code === "PGRST116";
    throw redirect(
      path.to.assemblyInstructions,
      await flash(
        request,
        notFound
          ? { success: false, message: "Assembly instruction not found" }
          : error(instructionError, "Failed to load assembly instruction")
      )
    );
  }

  const stepIds = (steps.data ?? []).map((step) => step.id);
  const [
    requirements,
    stepMaterials,
    plan,
    planJob,
    componentMappings,
    units,
    bomMaterials,
    assemblerAvailable
  ] = await Promise.all([
    getAssemblyInstructionStepRequirements(client, stepIds),
    getAssemblyInstructionStepMaterials(client, stepIds),
    instruction.data.modelUploadId
      ? getAssemblyPlanJson(client, instruction.data.modelUploadId)
      : Promise.resolve(null),
    instruction.data.modelUploadId
      ? getLatestAssemblyPlanJob(client, instruction.data.modelUploadId)
      : Promise.resolve({ data: null }),
    instruction.data.modelUploadId
      ? getAssemblyComponentMappings(client, instruction.data.modelUploadId)
      : Promise.resolve({ data: [] }),
    instruction.data.modelUploadId
      ? getAssemblyUnits(client, instruction.data.modelUploadId)
      : Promise.resolve({ data: [] }),
    instruction.data.itemId
      ? getFlattenedBomMaterials(client, instruction.data.itemId, companyId)
      : Promise.resolve([]),
    isAssemblerServiceHealthy()
  ]);

  return {
    instruction: instruction.data,
    steps: steps.data ?? [],
    requirements: requirements.data ?? [],
    stepMaterials: stepMaterials.data ?? [],
    standardNotes: standardNotes.data ?? [],
    units: units.data ?? [],
    plan,
    planJob: planJob.data ?? null,
    componentMappings: componentMappings.data ?? [],
    bomMaterials,
    assemblerAvailable
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const validation = await validator(assemblyInstructionValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await upsertAssemblyInstruction(client, {
    ...validation.data,
    id,
    companyId,
    createdBy: userId,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      {},
      await flash(
        request,
        error(update.error, "Failed to update assembly instruction")
      )
    );
  }

  throw redirect(
    path.to.assemblyInstruction(id),
    await flash(request, success("Updated assembly instruction"))
  );
}

export default function AssemblyInstructionRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const {
    instruction,
    steps,
    requirements,
    stepMaterials,
    standardNotes,
    units,
    plan,
    planJob,
    componentMappings,
    bomMaterials,
    assemblerAvailable
  } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const mode = useMode();

  const isDisabled =
    instruction.status !== "Draft" || !permissions.can("update", "production");

  // Motion planning runs server-side and patches step motions when it lands
  // (the explorer polls while it runs). Until then the stored motions are
  // stale or missing — surface that over the viewer and fade "none"-motion
  // steps in rather than animating fallback paths the plan is about to replace.
  const isPlanning = isAssemblyPlanRunning(planJob);

  const [selectedStepId, setSelectedStepId] = useState<string | null>(
    steps[0]?.id ?? null
  );
  const [draftComponentNodeIds, setDraftComponentNodeIds] = useState<
    string[] | null
  >(null);
  const [graph, setGraph] = useState<AssemblyGraph | null>(null);
  const graphIndex = useMemo(
    () => (graph ? indexAssemblyGraph(graph) : null),
    [graph]
  );
  // The current component selection — a single source of truth shared by all
  // three panels: it renders red in the viewer, marks + scrolls to the row in the
  // Components panel, and (while authoring a step) stages the step's draft components.
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [hiddenNodeIds, setHiddenNodeIds] = useState<string[]>([]);
  // Isolate/focus: picking components in the Components panel shows ONLY them in
  // the viewer (everything else hidden) so the part can be inspected alone.
  // Cleared by a viewer/3D pick, a step change, add-mode, or an empty selection.
  const [focusedNodeIds, setFocusedNodeIds] = useState<string[]>([]);
  // Add-mode: while on, picking components (in the viewer or the Components panel)
  // appends them to the active step. Off by default, so plain selection never
  // mutates a step's components — you must explicitly start adding.
  const [isAddingComponents, setIsAddingComponents] = useState(false);

  const { selectedStep, activeStepIndex } = useMemo(() => {
    const step =
      steps.find((candidate) => candidate.id === selectedStepId) ??
      steps[0] ??
      null;
    return {
      selectedStep: step,
      activeStepIndex: step
        ? steps.findIndex((candidate) => candidate.id === step.id)
        : 0
    };
  }, [steps, selectedStepId]);

  // Read the latest steps inside the stable onSelectStep without widening its
  // deps (it feeds explorer effects that must not re-fire on every steps change).
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  // Autosave the active step's components (Add/remove in the Details panel) via a
  // partial-update route, mirroring the motion-path autosave — never touching
  // the title/typed fields.
  const componentsFetcher = useFetcher<{ success: boolean }>();
  const saveComponentNodeIds = useCallback(
    (stepId: string, componentNodeIds: string[]) => {
      const formData = new FormData();
      formData.set("componentNodeIds", JSON.stringify(componentNodeIds));
      componentsFetcher.submit(formData, {
        method: "post",
        action: path.to.assemblyInstructionStepComponents(id, stepId)
      });
    },
    [componentsFetcher, id]
  );

  // Bumped to preview (play) the active step — a double-click in the Explorer.
  const [playStepNonce, setPlayStepNonce] = useState(0);

  const onSelectStep = useCallback(
    (stepId: string, options?: { selectComponents?: boolean }) => {
      setSelectedStepId(stepId);
      setDraftComponentNodeIds(null);
      setIsAddingComponents(false);
      // Leave any open motion-path edit session when moving to another step.
      setEditingStepId(null);
      setDraftMotion(null);
      // Changing steps drops any isolate — the new step's parts should be visible.
      setFocusedNodeIds([]);
      // Selecting a step makes its components the active selection — red in the
      // viewer, marked in the Components panel. Viewer-driven changes (playback,
      // scrub, on-screen nav) pass selectComponents:false so auto-advance doesn't
      // stomp the selection the user is working with.
      if (options?.selectComponents !== false) {
        const step = stepsRef.current.find(
          (candidate) => candidate.id === stepId
        );
        if (step) setSelectedNodeIds(step.componentNodeIds ?? []);
      }
    },
    []
  );

  // Double-clicking a step previews it: select it, then bump the nonce so the
  // player animates its insertion (single-click just shows it seated).
  const onPreviewStep = useCallback(
    (stepId: string) => {
      onSelectStep(stepId);
      setPlayStepNonce((nonce) => nonce + 1);
    },
    [onSelectStep]
  );

  // Picking components (in the viewer or the Components panel) drives the shared
  // selection. It only touches the active step's components while add-mode is on —
  // then each selection is appended (union) and autosaved immediately.
  const onSelectComponents = useCallback(
    (nodeIds: string[]) => {
      setSelectedNodeIds(nodeIds);
      // A viewer/3D pick (or the details-panel list) drops any isolate — only
      // the Components panel isolates, via onFocusComponents below.
      setFocusedNodeIds([]);
      if (isAddingComponents && !isDisabled && selectedStep) {
        const base =
          draftComponentNodeIds ?? selectedStep.componentNodeIds ?? [];
        const next = Array.from(new Set([...base, ...nodeIds]));
        setDraftComponentNodeIds(next);
        saveComponentNodeIds(selectedStep.id, next);
      }
    },
    [
      isAddingComponents,
      isDisabled,
      selectedStep,
      draftComponentNodeIds,
      saveComponentNodeIds
    ]
  );

  // The Components panel selects AND isolates: picking a component shows only it
  // in the viewer. While add-mode is on, panel picks append to the step instead
  // (delegated to onSelectComponents) and don't isolate — you need the whole
  // model visible to pick what to add.
  const onFocusComponents = useCallback(
    (nodeIds: string[]) => {
      if (isAddingComponents) {
        onSelectComponents(nodeIds);
        return;
      }
      setSelectedNodeIds(nodeIds);
      setFocusedNodeIds(nodeIds);
    },
    [isAddingComponents, onSelectComponents]
  );

  // Enter add-mode with a clean slate: clear the selection so the components picked
  // *next* are the ones added, not whatever happened to be highlighted.
  const onStartAddComponents = useCallback(() => {
    setIsAddingComponents(true);
    setSelectedNodeIds([]);
    setFocusedNodeIds([]);
  }, []);

  const onStopAddComponents = useCallback(
    () => setIsAddingComponents(false),
    []
  );

  // Remove a component group from the active step (autosaved), dropping it from the
  // current selection so the viewer highlight stays in sync.
  const onRemoveComponents = useCallback(
    (nodeIds: string[]) => {
      if (isDisabled || !selectedStep) return;
      const remove = new Set(nodeIds);
      const base = draftComponentNodeIds ?? selectedStep.componentNodeIds ?? [];
      const next = base.filter((nodeId) => !remove.has(nodeId));
      setDraftComponentNodeIds(next);
      saveComponentNodeIds(selectedStep.id, next);
      setSelectedNodeIds((prev) =>
        prev.filter((nodeId) => !remove.has(nodeId))
      );
    },
    [isDisabled, selectedStep, draftComponentNodeIds, saveComponentNodeIds]
  );

  const viewerSteps = useMemo(() => steps.map(toViewerStep), [steps]);

  // Per-step requirements/materials for the properties panel — memoized so a
  // per-frame motion-drag re-render (draftMotion) doesn't hand the panel new
  // array identities and re-render it.
  const activeStepId = selectedStep?.id ?? null;
  const stepRequirements = useMemo(
    () =>
      activeStepId ? requirements.filter((r) => r.stepId === activeStepId) : [],
    [requirements, activeStepId]
  );
  const selectedStepMaterials = useMemo(
    () =>
      activeStepId
        ? stepMaterials.filter((m) => m.stepId === activeStepId)
        : [],
    [stepMaterials, activeStepId]
  );

  // Authored subassembly units, normalized for step-title derivation: a step
  // whose components are exactly a unit is titled by the unit's name ("Add Board").
  const namedUnits = useMemo(
    () =>
      units.map((unit) => ({
        name: unit.name,
        componentNodeIds: unit.componentNodeIds ?? []
      })),
    [units]
  );

  const modelUpload = instruction.modelUpload;
  const glbPath = modelUpload?.glbPath;
  const graphPath = modelUpload?.graphPath;

  // Conversion is lazy (kicked off when the instruction was created), so the
  // artifacts may still be in flight. A job that is actually running gets a
  // fast poll + live progress; "Idle" without artifacts (pre-pickup window, or
  // nothing triggered yet) polls gently — an eternal fast loop on the heavy
  // route loader makes the whole page feel sluggish.
  const isActivelyConverting =
    !glbPath &&
    (modelUpload?.processingStatus === "Queued" ||
      modelUpload?.processingStatus === "Processing");
  const isAwaitingPickup = !glbPath && modelUpload?.processingStatus === "Idle";
  const isConverting = isActivelyConverting || isAwaitingPickup;
  const revalidator = useRevalidator();
  useInterval(
    () => revalidator.revalidate(),
    isActivelyConverting ? 2000 : isAwaitingPickup ? 5000 : null
  );
  const cancelPlanFetcher = useFetcher<{ success: boolean }>();
  const retryFetcher = useFetcher<{}>();

  // --- Motion path + camera editing (viewer-driven) ------------------------
  // The 3D viewer edits the active step's motion path (drag waypoints) and
  // captures its camera; both autosave via a dedicated partial-update route so
  // they never round-trip the whole step form. `draftMotion` is the controlled
  // value the viewer renders while editing.
  const playerRef = useRef<AssemblyPlayerHandle>(null);
  const motionFetcher = useFetcher<{ success: boolean }>();
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [draftMotion, setDraftMotion] = useState<Motion | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveMotion = useCallback(
    (stepId: string, body: { motion?: Motion; camera?: CameraPose | null }) => {
      const formData = new FormData();
      if (body.motion !== undefined) {
        formData.set("motion", JSON.stringify(body.motion));
      }
      if (body.camera !== undefined) {
        formData.set("camera", JSON.stringify(body.camera));
      }
      motionFetcher.submit(formData, {
        method: "post",
        action: path.to.assemblyInstructionStepMotion(id, stepId)
      });
    },
    [motionFetcher, id]
  );

  const onEditMotion = useCallback(
    (stepId: string) => {
      const viewerStep = viewerSteps.find((s) => s.id === stepId);
      setSelectedStepId(stepId);
      setEditingStepId(stepId);
      setDraftMotion(viewerStep?.motion ?? { type: "none" });
    },
    [viewerSteps]
  );

  const onStopEditMotion = useCallback(() => {
    setEditingStepId(null);
    setDraftMotion(null);
  }, []);

  const onMotionChange = useCallback(
    (stepId: string, motion: Motion) => {
      setDraftMotion(motion);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => saveMotion(stepId, { motion }), 400);
    },
    [saveMotion]
  );

  const onSetCamera = useCallback(
    (stepId: string) => {
      const pose = playerRef.current?.captureCameraPose();
      if (!pose) {
        toast.error("The model isn't ready yet");
        return;
      }
      saveMotion(stepId, { camera: pose });
    },
    [saveMotion]
  );

  const onClearCamera = useCallback(
    (stepId: string) => saveMotion(stepId, { camera: null }),
    [saveMotion]
  );

  const isEditingSelectedMotion =
    editingStepId !== null && selectedStep?.id === editingStepId;

  return (
    <PanelProvider key={id}>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <AssemblyInstructionHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex grow overflow-hidden">
            <ResizablePanels
              explorer={
                <AssemblyInstructionExplorer
                  steps={steps}
                  units={units}
                  selectedStepId={selectedStep?.id ?? null}
                  isDisabled={isDisabled}
                  isConverting={isConverting}
                  assemblerAvailable={assemblerAvailable}
                  graphIndex={graphIndex}
                  hasPlan={Boolean(plan)}
                  planJob={planJob}
                  modelUploadId={instruction.modelUploadId}
                  componentMappings={componentMappings}
                  bomMaterials={bomMaterials}
                  selectedNodeIds={selectedNodeIds}
                  onSelectStep={onSelectStep}
                  onPreviewStep={onPreviewStep}
                  onHighlightComponents={onFocusComponents}
                  onHideComponents={setHiddenNodeIds}
                />
              }
              content={
                <div className="relative bg-background h-[calc(100dvh-99px)] w-full">
                  {glbPath && graphPath && isPlanning && (
                    <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-lg">
                      <Spinner className="h-3.5 w-3.5" />
                      <span className="whitespace-nowrap text-xs font-medium text-foreground">
                        Planning motion…
                      </span>
                      <cancelPlanFetcher.Form
                        method="post"
                        action={path.to.assemblyJobsCancel(id!)}
                      >
                        <input type="hidden" name="kind" value="plan" />
                        <button
                          type="submit"
                          disabled={cancelPlanFetcher.state !== "idle"}
                          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </cancelPlanFetcher.Form>
                    </div>
                  )}
                  {glbPath && graphPath ? (
                    <ClientOnly
                      fallback={
                        <div className="flex h-full w-full items-center justify-center">
                          <Spinner className="h-10 w-10" />
                        </div>
                      }
                    >
                      {() => (
                        <AssemblyPlayer
                          ref={playerRef}
                          glbUrl={getPrivateUrl(glbPath)}
                          graphUrl={getPrivateUrl(graphPath)}
                          steps={viewerSteps}
                          activeStepIndex={Math.max(activeStepIndex, 0)}
                          playStepNonce={playStepNonce}
                          onStepChange={(index) => {
                            const step = steps[index];
                            if (step)
                              onSelectStep(step.id, {
                                selectComponents: false
                              });
                          }}
                          onSelectComponents={onSelectComponents}
                          onGraphLoaded={setGraph}
                          highlightedNodeIds={selectedNodeIds}
                          hiddenNodeIds={hiddenNodeIds}
                          focusedNodeIds={focusedNodeIds}
                          readOnly={isDisabled}
                          editMotion={
                            editingStepId &&
                            selectedStep?.id === editingStepId &&
                            draftMotion
                              ? { stepId: editingStepId, motion: draftMotion }
                              : null
                          }
                          onMotionChange={onMotionChange}
                          units={namedUnits}
                          suppressFallbackMotions={isPlanning}
                          componentPickerActive={isAddingComponents}
                          autoPlay={false}
                          mode={mode}
                          className="h-full"
                        />
                      )}
                    </ClientOnly>
                  ) : (isActivelyConverting || isAwaitingPickup) &&
                    modelUpload?.id ? (
                    <ModelConvertProgress
                      modelUploadId={modelUpload.id}
                      instructionId={id!}
                    />
                  ) : modelUpload?.processingStatus === "Failed" ? (
                    <Empty>
                      <p className="text-sm font-medium text-foreground">
                        Couldn't prepare this model
                      </p>
                      <p className="max-w-[320px] text-center text-sm text-muted-foreground">
                        {modelUpload?.processingError ??
                          "Something went wrong converting the CAD file for 3D viewing."}
                      </p>
                      <retryFetcher.Form
                        method="post"
                        action={path.to.assemblyModelConvert(id!)}
                      >
                        <Button
                          type="submit"
                          variant="secondary"
                          isLoading={retryFetcher.state !== "idle"}
                          isDisabled={
                            retryFetcher.state !== "idle" ||
                            !permissions.can("update", "production")
                          }
                        >
                          Try again
                        </Button>
                      </retryFetcher.Form>
                    </Empty>
                  ) : (
                    <Empty>
                      <p className="text-sm font-medium text-foreground">
                        Model not ready yet
                      </p>
                      <p className="max-w-[320px] text-center text-sm text-muted-foreground">
                        This model hasn't been prepared for 3D viewing. It'll
                        appear here once processing starts.
                      </p>
                    </Empty>
                  )}
                </div>
              }
              properties={
                <AssemblyInstructionProperties
                  key={selectedStep?.id ?? "empty"}
                  step={selectedStep}
                  stepIndex={selectedStep ? activeStepIndex : null}
                  stepCount={steps.length}
                  draftComponentNodeIds={draftComponentNodeIds}
                  selectedNodeIds={selectedNodeIds}
                  isAddingComponents={isAddingComponents}
                  isDisabled={isDisabled}
                  graphIndex={graphIndex}
                  units={namedUnits}
                  onSelectComponents={onFocusComponents}
                  onStartAddComponents={onStartAddComponents}
                  onStopAddComponents={onStopAddComponents}
                  onRemoveComponents={onRemoveComponents}
                  isEditingMotion={isEditingSelectedMotion}
                  onEditMotion={onEditMotion}
                  onStopEditMotion={onStopEditMotion}
                  onSetCamera={onSetCamera}
                  onClearCamera={onClearCamera}
                  requirements={stepRequirements}
                  stepMaterials={selectedStepMaterials}
                  bomMaterials={bomMaterials}
                  standardNotes={standardNotes}
                />
              }
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
