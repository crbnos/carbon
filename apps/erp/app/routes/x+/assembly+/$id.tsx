// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useRevalidator } from "@carbon/query";
import {
  Button,
  ClientOnly,
  Spinner,
  toast,
  useInterval,
  useMode
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import type {
  AssemblyGraph,
  AssemblyPlayerHandle,
  CameraPose,
  Motion
} from "@carbon/viewer";
import {
  AssemblyPlayer,
  buildSubAssemblyPlan,
  indexAssemblyGraph,
  subAssemblyPartIds
} from "@carbon/viewer";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  useFetcher,
  useLoaderData,
  useParams,
  useSearchParams
} from "react-router";
import { Empty } from "~/components";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { usePermissions } from "~/hooks";
import {
  assemblyInstructionValidator,
  getAssemblyComponentMappings,
  getAssemblyInstruction,
  getAssemblyInstructionStepMaterials,
  getAssemblyInstructionStepSlides,
  getAssemblyInstructionSteps,
  getAssemblyInstructionStepTools,
  getAssemblyInstructionVersions,
  getAssemblyPlanJson,
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
import { SUB_ASSEMBLY_PARAM } from "~/modules/production/ui/Assemblies/AssemblyStepList";
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

  const [instruction, steps] = await Promise.all([
    getAssemblyInstruction(client, id),
    getAssemblyInstructionSteps(client, id)
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
    stepMaterials,
    stepSlides,
    stepTools,
    plan,
    planJob,
    componentMappings,
    units,
    bomMaterials,
    assemblerAvailable,
    versions
  ] = await Promise.all([
    getAssemblyInstructionStepMaterials(client, stepIds),
    getAssemblyInstructionStepSlides(client, stepIds),
    getAssemblyInstructionStepTools(client, stepIds),
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
    isAssemblerServiceHealthy(),
    getAssemblyInstructionVersions(client, instruction.data)
  ]);

  return {
    instruction: instruction.data,
    steps: steps.data ?? [],
    stepMaterials: stepMaterials.data ?? [],
    stepSlides: stepSlides.data ?? [],
    stepTools: stepTools.data ?? [],
    units: units.data ?? [],
    plan,
    planJob: planJob.data ?? null,
    componentMappings: componentMappings.data ?? [],
    bomMaterials,
    assemblerAvailable,
    versions: versions.data ?? []
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
    stepMaterials,
    stepSlides,
    stepTools,
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

  // null = the default below (the first row of the list).
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
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
  // null = read from the step; reset on step change, like the components draft.
  const [draftHiddenNodeIds, setDraftHiddenNodeIds] = useState<string[] | null>(
    null
  );
  // Isolate/focus: picking components in the Components panel shows ONLY them in
  // the viewer (everything else hidden) so the part can be inspected alone.
  // Cleared by a viewer/3D pick, a step change, add-mode, or an empty selection.
  const [focusedNodeIds, setFocusedNodeIds] = useState<string[]>([]);
  // Add-mode: while on, picking components (in the viewer or the Components panel)
  // appends them to the active step. Off by default, so plain selection never
  // mutates a step's components — you must explicitly start adding.
  const [isAddingComponents, setIsAddingComponents] = useState(false);

  const { selectedStep, activeStepIndex } = useMemo(() => {
    // Default to the first row of the list (a sub-assembly's steps are stored
    // before its header).
    const step =
      steps.find((candidate) => candidate.id === selectedStepId) ??
      steps.find((candidate) => !candidate.parentStepId) ??
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

  const hiddenFetcher = useFetcher<{ success: boolean }>();
  const saveHiddenNodeIds = useCallback(
    (stepId: string, hiddenNodeIds: string[]) => {
      const formData = new FormData();
      formData.set("hiddenComponentNodeIds", JSON.stringify(hiddenNodeIds));
      hiddenFetcher.submit(formData, {
        method: "post",
        action: path.to.assemblyInstructionStepHiddenComponents(id, stepId)
      });
    },
    [hiddenFetcher, id]
  );
  // A failed save must not keep showing the unsaved list: fall back to the step's saved one.
  useEffect(() => {
    if (
      hiddenFetcher.state === "idle" &&
      hiddenFetcher.data?.success === false
    ) {
      setDraftHiddenNodeIds(null);
    }
  }, [hiddenFetcher.state, hiddenFetcher.data]);

  // The selected step shows its hidden draft before the autosave round-trips.
  const viewerSteps = useMemo(
    () =>
      steps.map((step) => {
        const viewerStep = toViewerStep(step);
        return draftHiddenNodeIds && step.id === selectedStep?.id
          ? { ...viewerStep, hiddenComponentNodeIds: draftHiddenNodeIds }
          : viewerStep;
      }),
    [steps, draftHiddenNodeIds, selectedStep]
  );

  const subPlan = useMemo(
    () => buildSubAssemblyPlan(viewerSteps),
    [viewerSteps]
  );

  // A step that carries a finished sub-assembly in also "owns" its parts:
  // they move on it, so they get the This-step badge and can't be hidden there.
  const selectedOwnNodeIds = useMemo(() => {
    const own = draftComponentNodeIds ?? selectedStep?.componentNodeIds ?? [];
    if (!selectedStep) return own;
    const carried = (subPlan.get(selectedStep.id)?.carriesIn ?? []).flatMap(
      (headerId) => subAssemblyPartIds(viewerSteps, headerId)
    );
    return carried.length === 0 ? own : [...new Set([...own, ...carried])];
  }, [draftComponentNodeIds, selectedStep, viewerSteps, subPlan]);
  // Mirrors the DB trigger for the in-flight drafts: a part the step installs is
  // never listed as hidden on it (e.g. right after adding it to the step).
  const selectedHiddenNodeIds = useMemo(() => {
    const own = new Set(selectedOwnNodeIds);
    return (
      draftHiddenNodeIds ??
      selectedStep?.hiddenComponentNodeIds ??
      []
    ).filter((nodeId) => !own.has(nodeId));
  }, [draftHiddenNodeIds, selectedStep, selectedOwnNodeIds]);

  const onSetHiddenComponents = useCallback(
    (nodeIds: string[]) => {
      if (isDisabled || !selectedStep) return;
      setDraftHiddenNodeIds(nodeIds);
      saveHiddenNodeIds(selectedStep.id, nodeIds);
    },
    [isDisabled, selectedStep, saveHiddenNodeIds]
  );

  // An opened sub-assembly (?subAssembly=) scopes the player to its steps.
  const { t } = useLingui();
  const [searchParams] = useSearchParams();
  const requestedSubAssembly = searchParams.get(SUB_ASSEMBLY_PARAM);
  const openSubAssemblyId =
    requestedSubAssembly && subPlan.get(requestedSubAssembly)?.isHeader
      ? requestedSubAssembly
      : null;
  const scopeStepIds = useMemo(
    () =>
      openSubAssemblyId
        ? viewerSteps
            .filter((step) => step.parentStepId === openSubAssemblyId)
            .map((step) => step.id)
        : null,
    [openSubAssemblyId, viewerSteps]
  );

  // A used sub-assembly's header plays nothing (the unit joins at the step
  // that uses it), so selecting it shows its finished last step instead.
  const playerStepIndex = useMemo(() => {
    const info = selectedStep ? subPlan.get(selectedStep.id) : undefined;
    if (!info?.isHeader || info.plays) return activeStepIndex;
    const members = viewerSteps.filter(
      (step) => step.parentStepId === info.stepId
    );
    const last = members[members.length - 1];
    return last
      ? viewerSteps.findIndex((step) => step.id === last.id)
      : activeStepIndex;
  }, [selectedStep, subPlan, viewerSteps, activeStepIndex]);

  // With a sub-assembly row selected, Play builds it from its first step.
  const playFromStepIndex = useMemo(() => {
    if (!selectedStep?.isSubAssembly) return null;
    const first = viewerSteps.findIndex(
      (step) => step.parentStepId === selectedStep.id
    );
    return first >= 0 ? first : null;
  }, [selectedStep, viewerSteps]);

  const subAssemblyName = useCallback(
    (headerId: string) =>
      viewerSteps.find((step) => step.id === headerId)?.title ||
      t`Sub-Assembly`,
    [viewerSteps, t]
  );
  // Labels follow the step the player shows (a used header shows its last step).
  const playerStepId = viewerSteps[playerStepIndex]?.id;
  const activeInfo = playerStepId ? subPlan.get(playerStepId) : undefined;
  const isolationLabel =
    activeInfo && !activeInfo.isHeader && activeInfo.headerId
      ? t`Sub-Assembly ${subPlan.get(activeInfo.headerId)?.number ?? ""} · ${subAssemblyName(
          activeInfo.headerId
        )} — shown on its own`
      : null;
  const carriedIn = (activeInfo?.carriesIn ?? []).filter(
    (headerId) => headerId !== playerStepId
  );
  const pathToolLabels = useMemo(
    () => ({ move: t`Move`, rotate: t`Rotate` }),
    [t]
  );
  const carryInLabel =
    carriedIn.length > 0
      ? carriedIn
          .map(
            (headerId) =>
              t`Uses ${subPlan.get(headerId)?.number ?? ""} · ${subAssemblyName(headerId)}`
          )
          .join(", ")
      : null;

  // Bumped to preview (play) the active step — a double-click in the Explorer.
  const [playStepNonce, setPlayStepNonce] = useState(0);

  const onSelectStep = useCallback(
    (stepId: string, options?: { selectComponents?: boolean }) => {
      setSelectedStepId(stepId);
      setDraftComponentNodeIds(null);
      setDraftHiddenNodeIds(null);
      setIsAddingComponents(false);
      // Leave any open motion-path edit session when moving to another step.
      setEditingStepId(null);
      setEditingUnitId(null);
      setDraftMotion(null);
      // Changing steps drops any isolate — the new step's parts should be visible.
      setFocusedNodeIds([]);
      // Selecting a step makes its components the active selection — red in the
      // viewer, marked in the Components panel. Viewer-driven changes (playback,
      // scrub, on-screen nav) pass selectComponents:false so auto-advance doesn't
      // stomp the selection the user is working with.
      const step = stepsRef.current.find(
        (candidate) => candidate.id === stepId
      );
      if (options?.selectComponents !== false && step) {
        setSelectedNodeIds(step.componentNodeIds ?? []);
      }
    },
    []
  );

  // Opening a sub-assembly lands on its first step (the player only plays its
  // steps). Keyed on the opened id alone so picking another step afterwards
  // (its header in Properties, say) isn't bounced back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs only when a sub-assembly is opened
  useEffect(() => {
    if (!scopeStepIds || scopeStepIds.length === 0) return;
    if (selectedStep && scopeStepIds.includes(selectedStep.id)) return;
    onSelectStep(scopeStepIds[0]);
  }, [openSubAssemblyId]);

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

  // Per-step slides/tools/materials for the properties panel — memoized so a
  // per-frame motion-drag re-render (draftMotion) doesn't hand the panel new
  // array identities and re-render it.
  const activeStepId = selectedStep?.id ?? null;
  const selectedStepMaterials = useMemo(
    () =>
      activeStepId
        ? stepMaterials.filter((m) => m.stepId === activeStepId)
        : [],
    [stepMaterials, activeStepId]
  );
  const selectedStepSlides = useMemo(
    () =>
      activeStepId ? stepSlides.filter((s) => s.stepId === activeStepId) : [],
    [stepSlides, activeStepId]
  );
  const selectedStepTools = useMemo(
    () =>
      activeStepId ? stepTools.filter((t) => t.stepId === activeStepId) : [],
    [stepTools, activeStepId]
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
  // Editing the path of a sub-assembly the step carries in (saved on its
  // header row) instead of the step's own motion.
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [draftMotion, setDraftMotion] = useState<Motion | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveMotion = useCallback(
    (
      stepId: string,
      body: { motion?: Motion; camera?: CameraPose | null; reset?: boolean }
    ) => {
      const formData = new FormData();
      if (body.reset) formData.set("reset", "on");
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
    (stepId: string, unitHeaderId?: string) => {
      const edited = viewerSteps.find((s) => s.id === (unitHeaderId ?? stepId));
      setSelectedStepId(stepId);
      setEditingStepId(stepId);
      setEditingUnitId(unitHeaderId ?? null);
      setDraftMotion(edited?.motion ?? { type: "none" });
    },
    [viewerSteps]
  );

  const onStopEditMotion = useCallback(() => {
    setEditingStepId(null);
    setEditingUnitId(null);
    setDraftMotion(null);
  }, []);

  const onMotionChange = useCallback(
    (stepId: string, motion: Motion) => {
      setDraftMotion(motion);
      // A sub-assembly's path lives on its header row.
      const targetId = editingUnitId ?? stepId;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(
        () => saveMotion(targetId, { motion }),
        400
      );
    },
    [saveMotion, editingUnitId]
  );

  const onResetMotion = useCallback(
    (stepId: string) => saveMotion(stepId, { reset: true }),
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

  const isEditingSelected =
    editingStepId !== null && selectedStep?.id === editingStepId;
  const isEditingSelectedMotion = isEditingSelected && editingUnitId === null;
  const editingUnitPartIds = useMemo(
    () =>
      editingUnitId ? subAssemblyPartIds(viewerSteps, editingUnitId) : null,
    [editingUnitId, viewerSteps]
  );

  return (
    <PanelProvider key={id}>
      <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
        <AssemblyInstructionHeader />
        <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
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
                  hasSelectedStep={Boolean(selectedStep)}
                  ownNodeIds={selectedOwnNodeIds}
                  hiddenNodeIds={selectedHiddenNodeIds}
                  onSetHiddenComponents={onSetHiddenComponents}
                  openSubAssemblyId={openSubAssemblyId}
                />
              }
              content={
                <div className="relative bg-card h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] w-full">
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
                          scopeStepIds={scopeStepIds}
                          isolationLabel={isolationLabel}
                          carryInLabel={carryInLabel}
                          pathToolLabels={pathToolLabels}
                          activeStepIndex={Math.max(playerStepIndex, 0)}
                          playFromStepIndex={playFromStepIndex}
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
                          focusedNodeIds={focusedNodeIds}
                          readOnly={isDisabled}
                          editMotion={
                            editingStepId && isEditingSelected && draftMotion
                              ? {
                                  stepId: editingStepId,
                                  motion: draftMotion,
                                  ...(editingUnitPartIds
                                    ? { nodeIds: editingUnitPartIds }
                                    : {})
                                }
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
                  hiddenNodeIds={selectedHiddenNodeIds}
                  onSetHiddenComponents={onSetHiddenComponents}
                  isEditingMotion={isEditingSelectedMotion}
                  editingUnitId={isEditingSelected ? editingUnitId : null}
                  onEditMotion={onEditMotion}
                  onStopEditMotion={onStopEditMotion}
                  onResetMotion={onResetMotion}
                  onSetCamera={onSetCamera}
                  onClearCamera={onClearCamera}
                  stepMaterials={selectedStepMaterials}
                  stepSlides={selectedStepSlides}
                  stepTools={selectedStepTools}
                  bomMaterials={bomMaterials}
                  viewerSteps={viewerSteps}
                  onSelectStep={onSelectStep}
                />
              }
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
