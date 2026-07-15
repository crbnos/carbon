import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useDebounce,
  useInterval,
  VStack
} from "@carbon/react";
import type { AssemblyGraphIndex } from "@carbon/viewer";
import {
  describeStep,
  groupComponentNodeIds,
  synthesizeFallbackMotion
} from "@carbon/viewer";
import type { DragControls } from "framer-motion";
import { MotionConfig, Reorder, useDragControls } from "framer-motion";
import type { ReactNode } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuChevronDown,
  LuCirclePlus,
  LuEllipsisVertical,
  LuGripVertical,
  LuHand,
  LuSearch,
  LuSparkles,
  LuTrash,
  LuTriangleAlert,
  LuWaypoints
} from "react-icons/lu";
import {
  useFetcher,
  useParams,
  useRevalidator,
  useSearchParams
} from "react-router";
import { Empty } from "~/components";
import { ProcedureStepTypeIcon } from "~/components/Icons";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRealtime } from "~/hooks";
import { path } from "~/utils/path";
import { isAssemblyPlanRunning } from "../../production.models";
import type { FlattenedBomMaterial } from "../../production.service";
import { toViewerStep } from "../../production.service";
import type {
  AssemblyComponentMapping,
  AssemblyInstructionStepRow,
  AssemblyUnit
} from "../../types";
import AssemblyBomTree from "./AssemblyBomTree";

type AssemblyInstructionExplorerProps = {
  steps: AssemblyInstructionStepRow[];
  units: AssemblyUnit[];
  selectedStepId: string | null;
  isDisabled: boolean;
  /** The CAD model is still being converted — block step generation until it lands */
  isConverting: boolean;
  /** The geometry service is reachable — required to convert models and plan steps */
  assemblerAvailable: boolean;
  graphIndex: AssemblyGraphIndex | null;
  /** A successful motion plan exists for the model */
  hasPlan: boolean;
  /** Latest plan job in any state — drives the generate-steps wait UI */
  planJob: {
    id: string;
    status: string;
    error: string | null;
    createdAt: string;
  } | null;
  modelUploadId: string | null;
  componentMappings: AssemblyComponentMapping[];
  bomMaterials: FlattenedBomMaterial[];
  /** Current component selection (shared with the viewer) — highlighted in the Components tab */
  selectedNodeIds: string[];
  onSelectStep: (stepId: string) => void;
  /** Double-click a step — preview (play) its insertion motion */
  onPreviewStep: (stepId: string) => void;
  onHighlightComponents: (nodeIds: string[]) => void;
  onHideComponents: (nodeIds: string[]) => void;
};

// Memoized: the parent route re-renders on every motion-drag frame
// (draftMotion state) but none of this panel's props change during a drag, so
// the ~30 step rows skip re-rendering entirely.
function AssemblyInstructionExplorer({
  steps,
  units,
  selectedStepId,
  isDisabled,
  isConverting,
  assemblerAvailable,
  graphIndex,
  hasPlan,
  planJob,
  modelUploadId,
  componentMappings,
  bomMaterials,
  selectedNodeIds,
  onSelectStep,
  onPreviewStep,
  onHighlightComponents,
  onHideComponents
}: AssemblyInstructionExplorerProps) {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const permissions = usePermissions();
  const revalidator = useRevalidator();

  const sortOrderFetcher = useFetcher<{ success: boolean }>();
  const newStepFetcher = useFetcher<{ success: boolean; id?: string }>();
  const generateFetcher = useFetcher<{
    success: boolean;
    planning?: boolean;
  }>();

  // Generate Steps needs a motion plan. Planning is lazy (nothing runs until
  // the user asks), so the first click usually lands before plan.json exists —
  // the action then (idempotently) kicks the planner and returns
  // planning:true. We hold the button in a pending state until the plan lands,
  // then generate the steps automatically — the click already expressed the
  // intent. The intent persists per-instruction in sessionStorage so it
  // survives a remount or navigating away and back mid-plan (first-time plans
  // run for tens of seconds); without it the auto-generate effect never fires
  // and the plan lands Success with zero steps and no path forward except a
  // second manual click.
  const awaitingPlanKey = `assembly-awaiting-plan:${id}`;
  const [isAwaitingPlan, setIsAwaitingPlanState] = useState(() => {
    try {
      return sessionStorage.getItem(awaitingPlanKey) === "1";
    } catch {
      return false;
    }
  });
  const setIsAwaitingPlan = useCallback(
    (value: boolean) => {
      setIsAwaitingPlanState(value);
      try {
        if (value) {
          sessionStorage.setItem(awaitingPlanKey, "1");
        } else {
          sessionStorage.removeItem(awaitingPlanKey);
        }
      } catch {
        // sessionStorage unavailable — fall back to ephemeral state only
      }
    },
    [awaitingPlanKey]
  );

  // Plan completion is pushed: the worker flips assemblyPlanJob to
  // Success/Failed, realtime revalidates the loader, and the awaiting effect
  // below generates the steps — the 5s poll stays only as a fallback.
  useRealtime(
    "assemblyPlanJob",
    `modelUploadId=eq.${modelUploadId ?? "__none__"}`
  );

  // Controlled so the Components tab knows when it becomes active — it scrolls the
  // current selection into view on activation
  const [tab, setTab] = useState<"steps" | "components">("steps");
  // A pre-existing Failed job stays the latest row until the freshly
  // triggered run inserts its own — remember it so it doesn't read as the
  // outcome of the run we're waiting on. Persisted next to the awaiting flag:
  // after a remount mid-plan the flag survives, so this must too, or the stale
  // failure reads as ours.
  const ignoredFailedKey = `assembly-ignored-failed:${id}`;
  const ignoredFailedJobId = useRef<string | null>(
    (() => {
      try {
        return sessionStorage.getItem(ignoredFailedKey);
      } catch {
        return null;
      }
    })()
  );
  const setIgnoredFailedJobId = useCallback(
    (value: string | null) => {
      ignoredFailedJobId.current = value;
      try {
        if (value) {
          sessionStorage.setItem(ignoredFailedKey, value);
        } else {
          sessionStorage.removeItem(ignoredFailedKey);
        }
      } catch {
        // sessionStorage unavailable — ref only
      }
    },
    [ignoredFailedKey]
  );
  const planFailed =
    isAwaitingPlan &&
    planJob?.status === "Failed" &&
    planJob.id !== ignoredFailedJobId.current;

  useEffect(() => {
    if (generateFetcher.data?.planning) {
      setIsAwaitingPlan(true);
    } else if (generateFetcher.data?.success) {
      setIsAwaitingPlan(false);
    }
  }, [generateFetcher.data]);

  const [showRerunConfirm, setShowRerunConfirm] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  // Which generate mode the pending click asked for — the awaiting-plan effect
  // re-submits after the plan lands, and a "Regenerate Steps" click must stay
  // a regenerate (a plain re-submit would no-op with "steps-exist").
  const generateModeRef = useRef<"generate" | "regenerate">("generate");
  const submitGenerate = useCallback(
    (mode: "generate" | "regenerate") => {
      generateModeRef.current = mode;
      const formData = new FormData();
      formData.set("mode", mode);
      generateFetcher.submit(formData, {
        method: "post",
        action: path.to.generateAssemblyInstructionSteps(id)
      });
    },
    [generateFetcher, id]
  );

  // Poll while planning runs (awaiting-plan generate flow, or an explicit
  // re-plan) so the fresh plan and its generated steps surface on their own
  const isPlanning = isAssemblyPlanRunning(planJob);
  useInterval(
    () => revalidator.revalidate(),
    (isAwaitingPlan && !hasPlan && !planFailed) || isPlanning ? 5000 : null
  );

  // Surface elapsed time while the planner runs so the wait shows a rough
  // expectation and forward progress instead of an open-ended spinner. A plan
  // runs server-side, so reflect a Processing plan job (isPlanning) too — the
  // "solving" state must survive navigating away and back, when the ephemeral
  // isAwaitingPlan flag is gone but the plan is still running.
  const isSolving =
    generateFetcher.state !== "idle" ||
    (isAwaitingPlan && !planFailed) ||
    (isPlanning && steps.length === 0);
  const [solveStartedAt, setSolveStartedAt] = useState<number | null>(null);
  const [solveNow, setSolveNow] = useState(() => Date.now());
  useEffect(() => {
    setSolveStartedAt((prev) => {
      if (!isSolving) return null;
      if (prev != null) return prev;
      // Anchor elapsed to the plan job's real start when a plan is running, so
      // the timer is accurate even after leaving and returning to the page.
      if (isPlanning && planJob?.createdAt) {
        return new Date(planJob.createdAt).getTime();
      }
      return Date.now();
    });
  }, [isSolving, isPlanning, planJob?.createdAt]);
  useInterval(
    () => setSolveNow(Date.now()),
    solveStartedAt != null ? 1000 : null
  );
  const solveElapsedSeconds =
    solveStartedAt != null
      ? Math.max(0, Math.round((solveNow - solveStartedAt) / 1000))
      : 0;
  const solveElapsedLabel = `${Math.floor(solveElapsedSeconds / 60)}:${String(
    solveElapsedSeconds % 60
  ).padStart(2, "0")}`;

  const rerunPlanFetcher = useFetcher<{ success: boolean }>();
  // Any planner work in flight — a re-motion run, a regenerate solve, or the
  // submit round-trips themselves. Drives the footer's planner-menu spinner.
  const isPlannerBusy =
    isPlanning ||
    isSolving ||
    rerunPlanFetcher.state !== "idle" ||
    generateFetcher.state !== "idle";

  // ?autogen=1 (set by the create-assembly redirect): a model-backed
  // instruction generates its steps without a click. One Generate submit —
  // if the plan is already there the steps land instantly; otherwise the
  // action kicks planning and returns planning:true, which arms the same
  // persisted awaiting machinery a manual click would. The param is stripped
  // immediately so reloads and shared links don't re-fire it.
  const [searchParams, setSearchParams] = useSearchParams();
  const autogenFired = useRef(false);
  useEffect(() => {
    if (searchParams.get("autogen") !== "1" || autogenFired.current) return;
    autogenFired.current = true;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("autogen");
        return next;
      },
      { replace: true }
    );
    if (steps.length > 0 || !permissions.can("update", "production")) return;
    submitGenerate("generate");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // The user's click is waiting on a plan. When it lands, generate the steps —
  // no second click. If the wait stalls with nothing running (the click raced
  // the model conversion, and planning is no longer chained to conversion),
  // re-submit so the action kicks the planner. Fetcher "idle" implies the
  // post-action revalidation is done, so isPlanning/isConverting are fresh.
  useEffect(() => {
    if (
      !isAwaitingPlan ||
      generateFetcher.state !== "idle" ||
      rerunPlanFetcher.state !== "idle"
    ) {
      return;
    }
    // Still working — keep waiting. Checked BEFORE hasPlan so a fresh re-plan
    // (Regenerate) isn't short-circuited by a STALE plan that still exists:
    // wait for the running plan, then generate from it.
    if (isConverting || isPlanning || planFailed) return;
    if (hasPlan) setIsAwaitingPlan(false);
    submitGenerate(generateModeRef.current);
  }, [
    isAwaitingPlan,
    hasPlan,
    isConverting,
    isPlanning,
    planFailed,
    generateFetcher,
    rerunPlanFetcher.state,
    submitGenerate,
    id
  ]);

  const [stepToDelete, setStepToDelete] =
    useState<AssemblyInstructionStepRow | null>(null);

  const [sortOrder, setSortOrder] = useState<string[]>(
    steps.map((step) => step.id)
  );
  // A local reorder saves on a 2500ms debounce; until it lands, a revalidation
  // still carries the PRE-reorder server order. Track the pending save so the
  // sync effect below doesn't snap the user's drag back.
  const orderSavePendingRef = useRef(false);

  useEffect(() => {
    setSortOrder((prev) => {
      const nextIds = steps.map((step) => step.id);
      const prevSet = new Set(prev);
      const sameSet =
        prev.length === nextIds.length &&
        nextIds.every((id) => prevSet.has(id));
      if (sameSet) {
        // Same steps, possibly reordered upstream. Keep the local order while a
        // save is in flight; otherwise adopt the server order (source of truth).
        const savePending =
          orderSavePendingRef.current || sortOrderFetcher.state !== "idle";
        if (savePending) return prev;
        const sameOrder = nextIds.every((id, i) => prev[i] === id);
        return sameOrder ? prev : nextIds;
      }
      // Steps added or removed — resync to the server list.
      return nextIds;
    });
  }, [steps, sortOrderFetcher.state]);

  useEffect(() => {
    if (sortOrderFetcher.state === "idle" && sortOrderFetcher.data?.success) {
      orderSavePendingRef.current = false;
    }
  }, [sortOrderFetcher.state, sortOrderFetcher.data]);

  // Select the newly created step
  useEffect(() => {
    if (newStepFetcher.data?.success && newStepFetcher.data.id) {
      onSelectStep(newStepFetcher.data.id);
    }
  }, [newStepFetcher.data, onSelectStep]);

  const stepMap = useMemo(
    () => new Map(steps.map((step) => [step.id, step])),
    [steps]
  );

  // Authored subassembly units, normalized for step-title derivation: a step
  // whose components are exactly a unit is titled by its name, not by every component.
  const namedUnits = useMemo(
    () =>
      units.map((unit) => ({
        name: unit.name,
        componentNodeIds: unit.componentNodeIds ?? []
      })),
    [units]
  );

  // Derive the viewer shape once — both stepTitles and searchText need it, and
  // toViewerStep otherwise runs twice per step per render.
  const viewerStepMap = useMemo(
    () => new Map(steps.map((step) => [step.id, toViewerStep(step)])),
    [steps]
  );

  const stepTitles = useMemo(
    () =>
      new Map(
        steps.map((step) => [
          step.id,
          describeStep(
            viewerStepMap.get(step.id) ?? toViewerStep(step),
            graphIndex,
            namedUnits
          ) ?? "Untitled step"
        ])
      ),
    [steps, viewerStepMap, graphIndex, namedUnits]
  );

  const [search, setSearch] = useState("");
  const isSearching = search.trim().length > 0;

  /** stepId → lowercase haystack of title, component names, and fastener spec */
  const searchText = useMemo(() => {
    const map = new Map<string, string>();
    for (const step of steps) {
      const viewerStep = viewerStepMap.get(step.id) ?? toViewerStep(step);
      const componentNames = graphIndex
        ? groupComponentNodeIds(viewerStep.componentNodeIds, graphIndex)
            .map((group) => group.name)
            .join(" ")
        : "";
      map.set(
        step.id,
        [
          step.title ?? "",
          stepTitles.get(step.id) ?? "",
          componentNames,
          viewerStep.fastener?.spec ?? "",
          step.instructionText ?? ""
        ]
          .join(" ")
          .toLowerCase()
      );
    }
    return map;
  }, [steps, viewerStepMap, graphIndex, stepTitles]);

  const visibleOrder = useMemo(() => {
    if (!isSearching) return sortOrder;
    const needle = search.trim().toLowerCase();
    return sortOrder.filter((stepId) =>
      searchText.get(stepId)?.includes(needle)
    );
  }, [sortOrder, isSearching, search, searchText]);

  const updateSortOrder = useDebounce(
    (updates: Record<string, number>) => {
      const formData = new FormData();
      formData.append("updates", JSON.stringify(updates));
      sortOrderFetcher.submit(formData, {
        method: "post",
        action: path.to.assemblyInstructionStepOrder(id)
      });
    },
    2500,
    true
  );

  const onReorder = (newOrder: string[]) => {
    if (isDisabled || isSearching) return;

    const updates: Record<string, number> = {};
    newOrder.forEach((stepId, index) => {
      updates[stepId] = index + 1;
    });
    orderSavePendingRef.current = true;
    setSortOrder(newOrder);
    updateSortOrder(updates);
  };

  const onAddStep = () => {
    const formData = new FormData();
    formData.append("assemblyInstructionId", id);

    // When components are selected, seed the new step with the components and a
    // basic synthesized insertion animation. Otherwise create an empty
    // process-only step. The title is left blank on purpose — it derives live
    // from the components (describeStep) everywhere it is displayed.
    if (selectedNodeIds.length > 0) {
      // The new step appends after every existing step, so its obstacle world
      // is everything those steps install ("none" fades in when blocked)
      const present = new Set(
        steps.flatMap((step) => step.componentNodeIds ?? [])
      );
      const motion = graphIndex
        ? synthesizeFallbackMotion(graphIndex, selectedNodeIds, present)
        : null;
      formData.append("componentNodeIds", JSON.stringify(selectedNodeIds));
      formData.append("motion", JSON.stringify(motion ?? { type: "none" }));
    } else {
      formData.append("motion", JSON.stringify({ type: "none" }));
    }

    newStepFetcher.submit(formData, {
      method: "post",
      action: path.to.newAssemblyInstructionStep(id)
    });
  };

  return (
    <>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as "steps" | "components")}
        className="flex h-[calc(100dvh-99px)] w-full flex-col"
      >
        <TabsList className="w-auto flex-none gap-1 mx-3 mt-3">
          <TabsTrigger className="flex-1" value="steps">
            Steps
          </TabsTrigger>
          <TabsTrigger className="flex-1" value="components">
            Components
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="steps"
          className="flex min-h-0 flex-1 flex-col justify-between"
        >
          {steps.length > 0 && (
            <div className="relative w-full flex-none border-b border-border px-2 py-1.5">
              <LuSearch className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search steps"
                placeholder="Search steps"
                size="sm"
                className="pl-7"
                value={search}
                onChange={(searchEvent) => setSearch(searchEvent.target.value)}
              />
            </div>
          )}
          <VStack
            className="w-full flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
            spacing={0}
          >
            {steps.length > 0 ? (
              <MotionConfig reducedMotion="user">
                <Reorder.Group
                  axis="y"
                  values={visibleOrder}
                  onReorder={onReorder}
                  className="w-full"
                  disabled={isDisabled || isSearching}
                >
                  {visibleOrder.map((stepId) => {
                    const step = stepMap.get(stepId);
                    if (!step) return null;
                    return (
                      <DraggableStepItem
                        key={stepId}
                        stepId={stepId}
                        isDisabled={isDisabled || isSearching}
                      >
                        {(dragControls) => (
                          <StepItem
                            step={step}
                            title={stepTitles.get(stepId) ?? "Untitled step"}
                            index={sortOrder.indexOf(stepId)}
                            isDisabled={isDisabled || isSearching}
                            isSelected={stepId === selectedStepId}
                            dragControls={dragControls}
                            onSelect={() => onSelectStep(stepId)}
                            onPreview={() => onPreviewStep(stepId)}
                            onDelete={() => setStepToDelete(step)}
                          />
                        )}
                      </DraggableStepItem>
                    );
                  })}
                </Reorder.Group>
              </MotionConfig>
            ) : permissions.can("update", "production") ? (
              <div className="flex h-full w-full flex-col items-center justify-center px-6 py-10">
                <div className="flex w-full max-w-[280px] flex-col items-center text-center">
                  <div
                    className={cn(
                      "mb-4 flex size-12 items-center justify-center rounded-full",
                      planFailed
                        ? "bg-destructive/10 text-destructive"
                        : "bg-primary/10 text-primary"
                    )}
                  >
                    {isSolving ? (
                      <Spinner className="size-5" />
                    ) : planFailed ? (
                      <LuTriangleAlert className="size-5" />
                    ) : (
                      <LuSparkles className="size-5" />
                    )}
                  </div>
                  <h3 className="text-sm font-medium text-foreground">
                    {planFailed
                      ? "Couldn't generate steps"
                      : isSolving
                        ? "Solving assembly motions"
                        : "No steps yet"}
                  </h3>
                  <p className="mt-1 text-pretty text-xs text-muted-foreground">
                    {planFailed
                      ? (planJob?.error ??
                        "Motion planning failed. Retry to run it again.")
                      : isSolving
                        ? "Reading the model's geometry to work out the build order. Usually 1–3 minutes."
                        : hasPlan
                          ? "Generate draft steps with motions solved from the model, or add one yourself."
                          : "Run the motion planner over the model to create draft steps, or add one yourself."}
                  </p>
                  {isSolving && (
                    <p className="mt-1.5 text-[0.6875rem] tabular-nums text-muted-foreground/70">
                      {solveElapsedLabel} elapsed
                    </p>
                  )}
                  {!assemblerAvailable && !hasPlan && !isSolving && (
                    <p className="mt-2 text-pretty text-xs text-amber-600 dark:text-amber-500">
                      The geometry service is offline — motion planning is
                      unavailable right now.
                    </p>
                  )}
                  <div className="mt-5 flex w-full flex-col gap-2">
                    <Button
                      className="w-full"
                      isDisabled={
                        isDisabled ||
                        isConverting ||
                        isSolving ||
                        (!assemblerAvailable && !hasPlan)
                      }
                      isLoading={isSolving}
                      leftIcon={planFailed ? undefined : <LuSparkles />}
                      onClick={() => {
                        // The action starts a fresh planner run when the
                        // latest one failed — don't read that stale failure
                        // as this run's outcome
                        setIgnoredFailedJobId(
                          planJob?.status === "Failed" ? planJob.id : null
                        );
                        setIsAwaitingPlan(false);
                        submitGenerate("generate");
                      }}
                    >
                      {planFailed ? "Retry Generate Steps" : "Generate Steps"}
                    </Button>
                    <Button
                      className="w-full"
                      isDisabled={isDisabled}
                      leftIcon={<LuCirclePlus />}
                      variant="secondary"
                      onClick={onAddStep}
                    >
                      Add step manually
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <Empty />
            )}
            {steps.length > 0 && isSearching && visibleOrder.length === 0 && (
              <p className="w-full px-4 py-3 text-center text-xs text-muted-foreground">
                No steps match "{search.trim()}"
              </p>
            )}
          </VStack>
          {steps.length > 0 && (
            <div className="flex w-full flex-none items-center gap-2 border-t border-border p-4">
              <Button
                className="flex-1"
                isDisabled={
                  isDisabled ||
                  !permissions.can("update", "production") ||
                  newStepFetcher.state !== "idle"
                }
                isLoading={newStepFetcher.state !== "idle"}
                leftIcon={<LuCirclePlus />}
                variant="secondary"
                onClick={onAddStep}
              >
                Add Step
              </Button>
              {modelUploadId && permissions.can("update", "production") && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label={
                        isPlannerBusy
                          ? "Motion planning in progress"
                          : "Motion planner actions"
                      }
                      icon={
                        isPlannerBusy ? (
                          <Spinner className="size-4" />
                        ) : (
                          <LuSparkles />
                        )
                      }
                      isDisabled={isDisabled || isPlannerBusy}
                      variant="secondary"
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {!assemblerAvailable && (
                      <p className="px-2 py-1.5 text-xs text-amber-600 dark:text-amber-500">
                        Geometry service offline — motion planning unavailable.
                      </p>
                    )}
                    <DropdownMenuItem
                      disabled={!assemblerAvailable}
                      onClick={() => setShowRerunConfirm(true)}
                    >
                      <DropdownMenuIcon icon={<LuWaypoints />} />
                      <div>
                        Run Motion Planning
                        <p className="text-xs text-muted-foreground">
                          Recompute motions, keep step order
                        </p>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      destructive
                      disabled={!assemblerAvailable}
                      onClick={() => setShowRegenerateConfirm(true)}
                    >
                      <DropdownMenuIcon icon={<LuSparkles />} />
                      <div>
                        Regenerate Steps
                        <p className="text-xs text-muted-foreground">
                          Replace all steps from the latest plan
                        </p>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
        </TabsContent>
        {/* forceMount keeps the BOM selection (and viewer highlight) alive across tab switches */}
        <TabsContent
          value="components"
          forceMount
          className="min-h-0 flex-1 data-[state=inactive]:hidden"
        >
          <AssemblyBomTree
            graphIndex={graphIndex}
            steps={steps}
            units={units}
            isDisabled={isDisabled}
            modelUploadId={modelUploadId}
            componentMappings={componentMappings}
            bomMaterials={bomMaterials}
            selectedNodeIds={selectedNodeIds}
            isActive={tab === "components"}
            isAddingStep={newStepFetcher.state !== "idle"}
            onHighlightComponents={onHighlightComponents}
            onHideComponents={onHideComponents}
            onSelectStep={onSelectStep}
            onAddStep={onAddStep}
          />
        </TabsContent>
      </Tabs>
      {stepToDelete && (
        <ConfirmDelete
          action={path.to.deleteAssemblyInstructionStep(id, stepToDelete.id)}
          name={stepTitles.get(stepToDelete.id) ?? "this step"}
          text={`Are you sure you want to delete the step: ${
            stepTitles.get(stepToDelete.id) ?? stepToDelete.id
          }? This cannot be undone.`}
          onCancel={() => setStepToDelete(null)}
          onSubmit={() => setStepToDelete(null)}
        />
      )}
      {showRegenerateConfirm && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setShowRegenerateConfirm(false);
          }}
        >
          <ModalContent>
            <ModalHeader>
              <ModalTitle>Regenerate steps?</ModalTitle>
              <ModalDescription>
                Replaces all existing steps with fresh drafts from the latest
                motion plan — titles, descriptions, and other edits on the
                current steps are lost. Refused if any step is manually authored
                or marked Done.
              </ModalDescription>
            </ModalHeader>
            <ModalFooter>
              <Button
                variant="secondary"
                onClick={() => setShowRegenerateConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                isDisabled={
                  generateFetcher.state !== "idle" ||
                  rerunPlanFetcher.state !== "idle"
                }
                isLoading={
                  generateFetcher.state !== "idle" ||
                  rerunPlanFetcher.state !== "idle"
                }
                onClick={() => {
                  // Regenerate = re-plan from scratch, then rebuild steps from
                  // the fresh plan. Kick a fresh DERIVE plan and arm the
                  // awaiting machinery in regenerate mode; when the plan lands
                  // it replaces the steps. (A stored plan is never reused —
                  // that's what made planner changes invisible.)
                  setIgnoredFailedJobId(
                    planJob?.status === "Failed" ? planJob.id : null
                  );
                  generateModeRef.current = "regenerate";
                  setIsAwaitingPlan(true);
                  const formData = new FormData();
                  formData.set("fresh", "1");
                  rerunPlanFetcher.submit(formData, {
                    method: "post",
                    action: path.to.assemblyPlanRerun(id)
                  });
                  setShowRegenerateConfirm(false);
                }}
              >
                Regenerate
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
      {showRerunConfirm && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setShowRerunConfirm(false);
          }}
        >
          <ModalContent>
            <ModalHeader>
              <ModalTitle>Run motion planning?</ModalTitle>
              <ModalDescription>
                Recomputes how each step's components move into place, using the
                current step order and avoiding collisions with components from
                earlier steps. Steps you've marked Done are left as-is.
              </ModalDescription>
            </ModalHeader>
            <ModalFooter>
              <Button
                variant="secondary"
                onClick={() => setShowRerunConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                isDisabled={rerunPlanFetcher.state !== "idle"}
                isLoading={rerunPlanFetcher.state !== "idle"}
                onClick={() => {
                  rerunPlanFetcher.submit(new FormData(), {
                    method: "post",
                    action: path.to.assemblyPlanRerun(id)
                  });
                  setShowRerunConfirm(false);
                }}
              >
                Run
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </>
  );
}

const stepStatusOrder = ["Todo", "Review", "Done"] as const;
type StepStatus = (typeof stepStatusOrder)[number];

const stepStatusStyles: Record<StepStatus, string> = {
  Todo: "bg-red-500",
  Review: "bg-yellow-500",
  Done: "bg-green-500"
};

const StepStatusDot = ({ status }: { status: StepStatus }) => (
  <span
    className={cn(
      "block size-2 shrink-0 rounded-full",
      stepStatusStyles[status] ?? stepStatusStyles.Todo
    )}
  />
);

function StepStatusControl({
  stepId,
  status,
  isDisabled
}: {
  stepId: string;
  status: StepStatus;
  isDisabled: boolean;
}) {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const fetcher = useFetcher<{ success: boolean }>();

  // Optimistic: show the in-flight status while the fetcher is busy
  const displayed =
    fetcher.state !== "idle" && fetcher.formData
      ? ((fetcher.formData.get("status") as StepStatus) ?? status)
      : status;

  const onSelect = (value: string) => {
    if (value === status) return;
    const formData = new FormData();
    formData.append("status", value);
    fetcher.submit(formData, {
      method: "post",
      action: path.to.assemblyInstructionStepStatus(id, stepId)
    });
  };

  // Non-interactive: a labeled chip so the status is legible without the dot
  // color code (published/archived instructions can't be edited)
  if (isDisabled) {
    return (
      <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-border px-1.5 text-xs text-foreground">
        <StepStatusDot status={displayed} />
        {displayed}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Step status: ${displayed}. Change status`}
          className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-1.5 text-xs text-foreground shadow-button-base hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98]"
          onClick={(e) => e.stopPropagation()}
        >
          <StepStatusDot status={displayed} />
          {displayed}
          <LuChevronDown className="size-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[8rem]"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuRadioGroup value={displayed} onValueChange={onSelect}>
          {stepStatusOrder.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              <span className="flex items-center gap-2">
                <StepStatusDot status={option} />
                {option}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DraggableStepItem({
  stepId,
  isDisabled,
  children
}: {
  stepId: string;
  isDisabled: boolean;
  children: (dragControls: DragControls) => ReactNode;
}) {
  const dragControls = useDragControls();
  return (
    <Reorder.Item
      key={stepId}
      value={stepId}
      dragListener={false}
      dragControls={dragControls}
    >
      {children(dragControls)}
    </Reorder.Item>
  );
}

type StepItemProps = {
  step?: AssemblyInstructionStepRow;
  title: string;
  index: number;
  isDisabled: boolean;
  isSelected: boolean;
  dragControls?: DragControls;
  onSelect: () => void;
  onPreview: () => void;
  onDelete: () => void;
};

function StepItem({
  step,
  title,
  index,
  isDisabled,
  isSelected,
  dragControls,
  onSelect,
  onPreview,
  onDelete
}: StepItemProps) {
  const permissions = usePermissions();
  if (!step) return null;

  const componentCount = step.componentNodeIds?.length ?? 0;

  const needsSupport = (step.warnings as { needsSupport?: boolean } | null)
    ?.needsSupport;

  return (
    <div
      className={cn(
        "group relative flex w-full cursor-pointer select-none items-center gap-1.5 border-b border-border bg-card py-3 pl-1.5 pr-2.5 hover:bg-accent/30",
        isSelected && "bg-accent/40 hover:bg-accent/40"
      )}
      onClick={onSelect}
      onDoubleClick={onPreview}
      title="Double-click to play this step"
    >
      {isSelected && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-primary"
        />
      )}
      <IconButton
        aria-label="Drag handle"
        icon={<LuGripVertical />}
        variant="ghost"
        size="sm"
        disabled={isDisabled}
        className="size-6 shrink-0 cursor-grab text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
        onPointerDown={(e) => {
          if (!isDisabled && dragControls) dragControls.start(e);
        }}
        style={{ touchAction: "none" }}
      />
      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      <ProcedureStepTypeIcon
        type={step.type ?? "Task"}
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <span
        className="min-w-0 flex-1 truncate text-sm text-foreground"
        title={title}
      >
        {title}
      </span>
      {needsSupport && (
        <span
          className="shrink-0 text-amber-600 dark:text-amber-500"
          title="A part in this step may tip once placed — consider a fixture or a second person."
        >
          <LuHand className="size-3.5" />
        </span>
      )}
      <span
        className="shrink-0 text-xs tabular-nums text-muted-foreground"
        title={`${componentCount} component${componentCount === 1 ? "" : "s"}`}
      >
        ×{componentCount}
      </span>
      <StepStatusControl
        stepId={step.id}
        status={step.status ?? "Todo"}
        isDisabled={isDisabled}
      />
      {!isDisabled && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              aria-label="More"
              size="sm"
              variant="ghost"
              className="size-6 shrink-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
              icon={<LuEllipsisVertical />}
              onClick={(e) => e.stopPropagation()}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              destructive
              disabled={!permissions.can("delete", "production")}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <DropdownMenuIcon icon={<LuTrash />} />
              Delete Step
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export default memo(AssemblyInstructionExplorer);
