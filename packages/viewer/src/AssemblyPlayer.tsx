import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react";
import type { BufferGeometry } from "three";
import {
  AnimationMixer,
  Box3,
  Color,
  LoopOnce,
  type Material,
  Mesh,
  type MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Vector3
} from "three";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
  SAH
} from "three-mesh-bvh";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { AssemblyViewer } from "./AssemblyViewer";
import { fitFraming } from "./camera";
import { describeStep, type NamedUnit } from "./describe";
import { indexAssemblyGraph } from "./graph";
import { MotionPathEditor } from "./MotionPathEditor";
import {
  buildStepClip,
  displayMotionForStep,
  naturalizeMotion,
  stepTimelineSeconds
} from "./motion";
import type {
  AssemblyGraph,
  AssemblyStep,
  CameraPose,
  Motion,
  Vec3
} from "./types";
import { useAssembly } from "./useAssembly";
import { cn } from "./utils";
import {
  type ComponentVisual,
  type FutureComponentsMode,
  visualForComponent
} from "./visibility";

export type { FutureComponentsMode } from "./visibility";

/** Marquee rectangle in canvas-local CSS pixels while box-selecting. */
type BoxRect = { left: number; top: number; width: number; height: number };

export type AssemblyPlayerProps = {
  glbUrl: string;
  graphUrl: string;
  steps: AssemblyStep[];
  activeStepIndex: number;
  onStepChange?: (index: number) => void;
  /**
   * Bumped by the host to preview (play) the active step from its start. In the
   * editor, selecting a step just shows it seated; a double-click bumps this to
   * animate the insertion. Ignored on its initial value.
   */
  playStepNonce?: number;
  /** Click-to-select component nodeIds for the editor (additive with shift held) */
  onSelectComponents?: (nodeIds: string[]) => void;
  /** Surfaces the parsed graph.json once loaded (for BOM/title derivation) */
  onGraphLoaded?: (graph: AssemblyGraph) => void;
  /**
   * External (e.g. BOM-driven) highlight. Highlighted components render with an
   * emissive tint and stay visible even when their step would hide them.
   * Independent of click-selection.
   */
  highlightedNodeIds?: string[];
  /** Components hidden from the viewer entirely (fixtures, reference geometry) */
  hiddenNodeIds?: string[];
  /**
   * Isolate/focus set. When non-empty, ONLY these components render — everything
   * else is hidden so the user can inspect the selection in isolation. Empty =
   * no isolation. Cleared automatically when playback starts (the build-up needs
   * every part).
   */
  focusedNodeIds?: string[];
  /** Disables component selection (MES playback) */
  readOnly?: boolean;
  /**
   * Puts the active step's insertion motion into the draggable red-path editor.
   * Must reference the active step; the draft `motion` is what renders (so the
   * route can hold it as controlled state). Playback is paused while set.
   */
  editMotion?: { stepId: string; motion: Motion } | null;
  /** Drag/insert/delete of a waypoint emits the new relative motion. */
  onMotionChange?: (stepId: string, motion: Motion) => void;
  /** Initial render mode for future-step components */
  defaultFutureMode?: FutureComponentsMode;
  /** Picking components to add to a step: ghost every not-yet-installed part so
   * un-animated parts are visible and clickable (x-ray). */
  componentPickerActive?: boolean;
  /**
   * When true (default), the whole sequence auto-plays on load and runs through
   * every step. When false, the player starts paused: selecting a step plays
   * just that step, and it only continues through the rest once Play is pressed.
   */
  autoPlay?: boolean;
  /**
   * Named subassembly units (authored "plan as one component" groups). A step whose
   * components are exactly one of these is titled by the unit's name rather than by
   * listing every component inside it.
   */
  units?: NamedUnit[];
  /**
   * Skips AABB fallback synthesis for steps stored with motion "none" so they
   * fade in at the seated pose instead. Set while motion planning is running —
   * the fresh plan is about to replace those motions, so animating a fabricated
   * path would be misleading.
   */
  suppressFallbackMotions?: boolean;
  mode?: "dark" | "light";
  className?: string;
};

/** Imperative handle for reading the live camera (per-step "Set view"). */
export type AssemblyPlayerHandle = {
  /** The current camera pose, or null before the scene is ready. */
  captureCameraPose: () => CameraPose | null;
};

/**
 * Animated assembly playback per the assembly contracts (section 5):
 * - components of steps before the active step are shown solid at their final pose
 * - components of the active step play their insertion motion once, holding the
 *   seated pose; flagged steps (no collision-free path) fade in instead
 * - components of later steps render per the future-components mode: ghosted at low
 *   opacity in their original color (default), hidden, or solid
 * - components no step installs are never present: they render like future-step
 *   components (hidden during playback, the future-components mode while paused)
 *
 * All steps form one continuous timeline: playing advances through steps
 * automatically, the scrubber maps to global seconds (step boundaries are
 * tick marks), and the footer shows elapsed / total time.
 */
export const AssemblyPlayer = forwardRef<
  AssemblyPlayerHandle,
  AssemblyPlayerProps
>(function AssemblyPlayer(
  {
    glbUrl,
    graphUrl,
    steps,
    activeStepIndex,
    onStepChange,
    playStepNonce,
    onSelectComponents,
    onGraphLoaded,
    highlightedNodeIds,
    hiddenNodeIds,
    focusedNodeIds,
    readOnly = false,
    editMotion,
    onMotionChange,
    defaultFutureMode = "ghost",
    componentPickerActive = false,
    autoPlay = true,
    units,
    suppressFallbackMotions = false,
    mode = "dark",
    className
  },
  ref
) {
  const { scene, nodesById, graph, isLoading, error } = useAssembly(
    glbUrl,
    graphUrl
  );
  // With autoPlay, the sequence runs through every step on load. Otherwise the
  // player starts paused: selecting a step shows it seated, and it only animates
  // when Play (or a step double-click) is pressed (`continuous` for the former).
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [continuous, setContinuous] = useState(autoPlay);
  // "auto": each step frames the camera toward the action. Grabbing the
  // controls DURING playback switches to "free" — the user keeps their view
  // across steps until they click the floating badge to hand control back.
  // Paused orbiting doesn't change modes (per-step framing already yields to
  // the framing-key guard there).
  const [cameraMode, setCameraMode] = useState<"auto" | "free">("auto");
  // Stable identity — the scene re-subscribes its controls listener otherwise.
  const handleFreeCamera = useCallback(() => setCameraMode("free"), []);
  const [futureMode, setFutureMode] =
    useState<FutureComponentsMode>(defaultFutureMode);
  // Live marquee rectangle while box-selecting (drawn as a DOM overlay).
  const [boxRect, setBoxRect] = useState<BoxRect | null>(null);

  // The scene writes the live camera reader here; the imperative handle reads it.
  const capturePoseRef = useRef<(() => CameraPose | null) | null>(null);
  useImperativeHandle(
    ref,
    () => ({ captureCameraPose: () => capturePoseRef.current?.() ?? null }),
    []
  );

  // Editing the motion path pauses playback so drags aren't fought by the clip.
  const isEditingMotion = Boolean(editMotion);
  useEffect(() => {
    if (isEditingMotion) setIsPlaying(false);
  }, [isEditingMotion]);

  // Selecting a step plays that one step's animation (single-step). Skip the
  // initial mount so the player is paused by default, and don't auto-play while
  // the motion-path editor is open (components must sit seated for the drag handles).
  const isEditingMotionRef = useRef(isEditingMotion);
  isEditingMotionRef.current = isEditingMotion;
  const prevStepIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (graph) onGraphLoaded?.(graph);
  }, [graph, onGraphLoaded]);

  const graphIndex = useMemo(
    () => (graph ? indexAssemblyGraph(graph) : null),
    [graph]
  );

  const assemblyDiagonal = useMemo(() => {
    const bbox = graphIndex?.graph.root.bbox;
    if (!bbox) return 0;
    return Math.hypot(
      bbox.max[0] - bbox.min[0],
      bbox.max[1] - bbox.min[1],
      bbox.max[2] - bbox.min[2]
    );
  }, [graphIndex]);

  const stepCount = steps.length;
  const clampedIndex = Math.min(Math.max(activeStepIndex, 0), stepCount - 1);
  const activeStep = steps[clampedIndex] ?? null;
  const activeStepTitle = activeStep
    ? describeStep(activeStep, graphIndex, units)
    : null;

  // Selecting a step no longer auto-plays it (that surprised users). The clip
  // effect (in AssemblyScene) snaps the newly-selected step to its SEATED pose
  // so it reads as "this step, done"; a double-click on the step (playStepNonce)
  // animates the insertion. autoPlay mode is unaffected — the sequence runs itself.
  useEffect(() => {
    prevStepIndexRef.current = clampedIndex;
  }, [clampedIndex]);

  // Cmd/Ctrl+A selects every currently visible component (skipping hidden ones and,
  // per the future-components mode, any that aren't rendered). Ignored while typing
  // in a field and in read-only playback, so the browser's own select-all still
  // works there.
  useEffect(() => {
    if (readOnly || !onSelectComponents) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "a" ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      if (!graphIndex) return;
      const visible = graphIndex.leaves
        .map((leaf) => leaf.nodeId)
        .filter((nodeId) => nodesById.get(nodeId)?.visible);
      event.preventDefault();
      onSelectComponents(visible);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readOnly, onSelectComponents, graphIndex, nodesById]);

  // Display-only motion adjustments — the stored data is untouched:
  // 1. Non-flagged steps saved with motion "none" (legacy plans, manual
  //    steps) get an AABB-synthesized insertion so components never pop into
  //    place. Flagged steps (no collision-free path exists) keep "none" and
  //    fade in instead. The first step is the base — placed, not inserted.
  // 2. Small components (bolts, washers) get exaggerated travel so their
  //    insertion reads clearly at assembly scale.
  const displaySteps = useMemo(() => {
    if (!graphIndex) return steps;
    const root = graphIndex.graph.root.bbox;
    const assemblyDiagonal = Math.hypot(
      root.max[0] - root.min[0],
      root.max[1] - root.min[1],
      root.max[2] - root.min[2]
    );
    // Fallback synthesis sees only the components already installed by earlier
    // steps — the parts actually on the canvas when this step plays
    const present = new Set<string>();
    return steps.map((step, index) => {
      const baseMotion = suppressFallbackMotions
        ? step.motion
        : displayMotionForStep(step, index, graphIndex, present);
      for (const nodeId of step.componentNodeIds) present.add(nodeId);

      let minBox: [number, number, number] | null = null;
      let maxBox: [number, number, number] | null = null;
      for (const nodeId of step.componentNodeIds) {
        const node = graphIndex.nodesById.get(nodeId);
        if (!node) continue;
        if (!minBox || !maxBox) {
          minBox = [...node.bbox.min];
          maxBox = [...node.bbox.max];
        } else {
          for (let axis = 0; axis < 3; axis++) {
            minBox[axis] = Math.min(
              minBox[axis] ?? 0,
              node.bbox.min[axis] ?? 0
            );
            maxBox[axis] = Math.max(
              maxBox[axis] ?? 0,
              node.bbox.max[axis] ?? 0
            );
          }
        }
      }
      if (!minBox || !maxBox) {
        return baseMotion === step.motion
          ? step
          : { ...step, motion: baseMotion };
      }
      const componentDiagonal = Math.hypot(
        maxBox[0] - minBox[0],
        maxBox[1] - minBox[1],
        maxBox[2] - minBox[2]
      );
      const motion = naturalizeMotion(
        baseMotion,
        componentDiagonal,
        assemblyDiagonal
      );
      return motion === step.motion ? step : { ...step, motion };
    });
  }, [steps, graphIndex, suppressFallbackMotions]);

  // --- Continuous timeline ---------------------------------------------
  const segments = useMemo(
    () => displaySteps.map(stepTimelineSeconds),
    [displaySteps]
  );
  const startTimes = useMemo(() => {
    let elapsed = 0;
    return segments.map((segment) => {
      const start = elapsed;
      elapsed += segment;
      return start;
    });
  }, [segments]);
  const totalSeconds = useMemo(
    () => segments.reduce((sum, segment) => sum + segment, 0),
    [segments]
  );

  /** Global playhead in seconds, written by the scene each frame */
  const playheadRef = useRef(0);
  /** Pending seek (seconds within the active step), consumed by the scene */
  const seekRef = useRef<number | null>(null);
  const [seekVersion, setSeekVersion] = useState(0);
  const [displayTime, setDisplayTime] = useState(0);

  // The playhead advances inside the render loop; poll it for the footer
  // instead of re-rendering React at frame rate.
  useEffect(() => {
    const id = setInterval(() => {
      setDisplayTime((previous) => {
        const next = playheadRef.current;
        return Math.abs(next - previous) > 0.05 ? next : previous;
      });
    }, 200);
    return () => clearInterval(id);
  }, []);

  const goToStep = useCallback(
    (index: number, opts?: { play?: boolean }) => {
      if (index < 0 || index >= stepCount) return;
      if (opts?.play) {
        // Playing into the step — start at its beginning so the insertion animates.
        seekRef.current = 0;
        playheadRef.current = startTimes[index] ?? 0;
        setDisplayTime(startTimes[index] ?? 0);
      } else {
        // Just viewing the step (prev/next) — show it COMPLETED, parts seated and
        // visible, matching a single-click on the step row. Leaving the seek null
        // lets the clip effect snap to the step's end pose.
        seekRef.current = null;
        const end = (startTimes[index] ?? 0) + (segments[index] ?? 0);
        playheadRef.current = end;
        setDisplayTime(end);
      }
      if (index === activeStepIndex) {
        setSeekVersion((version) => version + 1);
      } else {
        onStepChange?.(index);
      }
    },
    [onStepChange, stepCount, startTimes, segments, activeStepIndex]
  );

  const handleStepFinished = useCallback(() => {
    // Auto-advance to the next step only during a continuous play-through. A
    // single-step play (from selecting a step) stops here, paused at the seated
    // pose.
    if (continuous && clampedIndex < stepCount - 1) {
      goToStep(clampedIndex + 1, { play: true });
    } else {
      setIsPlaying(false);
      setContinuous(false);
    }
  }, [continuous, clampedIndex, stepCount, goToStep]);

  const onScrub = useCallback(
    (seconds: number) => {
      const clamped = Math.max(0, Math.min(seconds, totalSeconds));
      let index = 0;
      while (
        index < stepCount - 1 &&
        clamped >= (startTimes[index + 1] ?? Number.POSITIVE_INFINITY)
      ) {
        index++;
      }
      seekRef.current = clamped - (startTimes[index] ?? 0);
      playheadRef.current = clamped;
      setDisplayTime(clamped);
      if (index !== clampedIndex) {
        onStepChange?.(index);
      } else {
        setSeekVersion((version) => version + 1);
      }
    },
    [totalSeconds, stepCount, startTimes, clampedIndex, onStepChange]
  );

  // Double-click a step → preview it: restart the active step from its start and
  // play just that one (not a continuous run-through). Skips the initial nonce
  // value and the motion-path editor.
  const playStepNonceRef = useRef(playStepNonce);
  useEffect(() => {
    if (playStepNonce === playStepNonceRef.current) return;
    playStepNonceRef.current = playStepNonce;
    if (isEditingMotionRef.current || stepCount === 0) return;
    onScrub(startTimes[clampedIndex] ?? 0); // seek to the step's start
    setContinuous(false);
    setIsPlaying(true);
  }, [playStepNonce, clampedIndex, stepCount, startTimes, onScrub]);

  return (
    <div className={cn("flex h-full w-full flex-col", className)}>
      <div className="relative min-h-0 flex-1">
        <AssemblyViewer mode={mode} className="absolute inset-0">
          {scene && (
            <AssemblyScene
              key={scene.uuid}
              scene={scene}
              nodesById={nodesById}
              steps={displaySteps}
              activeStepIndex={clampedIndex}
              isPlaying={isPlaying}
              futureMode={futureMode}
              highlightedNodeIds={highlightedNodeIds}
              hiddenNodeIds={hiddenNodeIds}
              focusedNodeIds={isPlaying ? undefined : focusedNodeIds}
              readOnly={readOnly}
              onSelectComponents={onSelectComponents}
              editMotion={editMotion ?? null}
              onMotionChange={onMotionChange}
              assemblyDiagonal={assemblyDiagonal}
              capturePoseRef={capturePoseRef}
              assemblyBounds={graphIndex?.graph.root.bbox ?? null}
              leafBounds={graphIndex?.leaves ?? null}
              segments={segments}
              startTimes={startTimes}
              playheadRef={playheadRef}
              seekRef={seekRef}
              seekVersion={seekVersion}
              onStepFinished={handleStepFinished}
              onBoxRect={setBoxRect}
              cameraMode={cameraMode}
              onFreeCamera={handleFreeCamera}
              componentPickerActive={componentPickerActive}
            />
          )}
        </AssemblyViewer>
        {cameraMode === "free" && (
          <button
            type="button"
            className={cn(
              "absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background/80 py-1 pr-3 pl-2 backdrop-blur",
              "text-xs font-medium text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setCameraMode("auto")}
          >
            <svg
              className="size-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
            Free camera — click for auto
          </button>
        )}
        {boxRect && (
          <div
            aria-hidden
            className="pointer-events-none absolute z-10 rounded-[2px] border border-primary bg-primary/10"
            style={{
              left: boxRect.left,
              top: boxRect.top,
              width: boxRect.width,
              height: boxRect.height
            }}
          />
        )}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <svg
              className="h-6 w-6 animate-spin text-muted-foreground"
              viewBox="0 0 24 24"
              fill="none"
              aria-label="Loading model"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <p className="text-sm text-destructive">{error.message}</p>
          </div>
        )}
        {stepCount > 1 && (
          <>
            <OverlayNavButton
              side="left"
              aria-label="Previous step"
              disabled={clampedIndex <= 0}
              onClick={() => goToStep(clampedIndex - 1)}
            />
            <OverlayNavButton
              side="right"
              aria-label="Next step"
              disabled={clampedIndex >= stepCount - 1}
              onClick={() => goToStep(clampedIndex + 1)}
            />
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border bg-background px-3 py-2">
        <ControlButton
          aria-label="Previous step"
          disabled={clampedIndex <= 0}
          onClick={() => goToStep(clampedIndex - 1)}
        >
          <ChevronLeftIcon />
        </ControlButton>
        <ControlButton
          aria-label={isPlaying ? "Pause" : "Play"}
          disabled={isEditingMotion}
          onClick={() => {
            if (isPlaying) {
              setIsPlaying(false);
              setContinuous(false);
              return;
            }
            // Clear any component selection so it doesn't stay tinted red over
            // the playback.
            onSelectComponents?.([]);
            // Play = run on through the rest of the steps.
            const nextStart =
              startTimes[clampedIndex + 1] ?? Number.POSITIVE_INFINITY;
            const currentStepFinished =
              clampedIndex < stepCount - 1 &&
              playheadRef.current >= nextStart - 0.05;
            if (stepCount > 0 && playheadRef.current >= totalSeconds - 0.05) {
              // Parked at the very end → restart the whole sequence.
              onScrub(0);
            } else if (currentStepFinished) {
              // Current step already finished (e.g. after a single-step play) →
              // continue with the next one rather than replaying this one.
              goToStep(clampedIndex + 1, { play: true });
            } else {
              // Mid-step or a fresh step → (re)play it from the current position.
              setSeekVersion((version) => version + 1);
            }
            setContinuous(true);
            setIsPlaying(true);
          }}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </ControlButton>
        <ControlButton
          aria-label="Next step"
          disabled={clampedIndex >= stepCount - 1}
          onClick={() => goToStep(clampedIndex + 1)}
        >
          <ChevronRightIcon />
        </ControlButton>
        <TimelineScrubber
          segments={segments}
          startTimes={startTimes}
          totalSeconds={totalSeconds}
          displayTime={displayTime}
          activeStepIndex={clampedIndex}
          stepCount={stepCount}
          onScrub={onScrub}
        />
        <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {stepCount > 0
            ? `${formatTime(Math.min(displayTime, totalSeconds))} / ${formatTime(totalSeconds)}`
            : "–"}
        </span>
        <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {stepCount > 0 ? `${clampedIndex + 1} / ${stepCount}` : ""}
        </span>
        <div className="flex items-center rounded-md border border-border">
          <ControlButton
            aria-label="Show future components ghosted"
            aria-pressed={futureMode === "ghost"}
            isActive={futureMode === "ghost"}
            onClick={() => setFutureMode("ghost")}
          >
            <GhostIcon />
          </ControlButton>
          <ControlButton
            aria-label="Hide future components"
            aria-pressed={futureMode === "hidden"}
            isActive={futureMode === "hidden"}
            onClick={() => setFutureMode("hidden")}
          >
            <HiddenIcon />
          </ControlButton>
          <ControlButton
            aria-label="Show all components solid"
            aria-pressed={futureMode === "solid"}
            isActive={futureMode === "solid"}
            onClick={() => setFutureMode("solid")}
          >
            <SolidIcon />
          </ControlButton>
        </div>
      </div>

      {activeStep && (activeStepTitle || activeStep.instructionText) && (
        <div className="border-t border-border bg-background px-3 py-2">
          {activeStepTitle && (
            <p className="text-sm font-medium text-foreground">
              {activeStepTitle}
            </p>
          )}
          {activeStep.instructionText && (
            <p className="text-sm text-muted-foreground">
              {activeStep.instructionText}
            </p>
          )}
        </div>
      )}
    </div>
  );
});

type OverrideKind = "ghost" | "highlight" | "selected" | "external" | "fade";

type MaterialOverrides = {
  original: Material | Material[];
  /** Clones are created lazily on first use, not per mesh up front */
  ghost?: Material | Material[];
  highlight?: Material | Material[];
  selected?: Material | Material[];
  external?: Material | Material[];
  fade?: Material | Material[];
};

// Scratch vectors for the camera-transition useFrame — reused every frame so
// the transition allocates nothing.
const SCRATCH_CURRENT_OFFSET = new Vector3();
const SCRATCH_DESIRED_OFFSET = new Vector3();

const HIGHLIGHT_COLOR = 0x3b82f6;
// Selection is always red — both an in-scene click selection ("selected") and a
// components-panel selection ("external", forced visible) tint the component red so the
// current selection reads the same everywhere, Onshape-style.
const SELECTED_COLOR = 0xef4444;
const EXTERNAL_COLOR = 0xef4444;
const GHOST_OPACITY = 0.3;

type BvhGeometry = BufferGeometry & {
  computeBoundsTree?: typeof computeBoundsTree;
  disposeBoundsTree?: typeof disposeBoundsTree;
  boundsTree?: unknown;
};

/** Meshes to BVH per idle slice — each build is sub-ms, so a small batch keeps
 * every frame well under budget. */
const BVH_BUILD_BATCH = 24;

/**
 * Progressively accelerates raycasting on the scene's meshes by building a
 * three-mesh-bvh bounds tree per geometry, a small batch at a time on browser
 * idle. Spreading the ~250k-triangle build across idle slices keeps the model
 * interactive the instant it renders (raycasts fall back to linear until each
 * mesh's tree lands) without the single main-thread hitch a synchronous build
 * causes — and without the geometry-neutering flicker a web-worker builder
 * would cause on a visible model. Trees are disposed and raycast restored when
 * the scene changes or the player unmounts.
 */
function useProgressiveBvh(scene: Object3D) {
  const raycaster = useThree((state) => state.raycaster);
  useEffect(() => {
    raycaster.firstHitOnly = false;
    const meshes: Mesh[] = [];
    scene.traverse((object) => {
      const mesh = object as Mesh;
      const geom = mesh.geometry as BvhGeometry | undefined;
      if (mesh.isMesh && geom && !geom.boundsTree) meshes.push(mesh);
    });

    let cancelled = false;
    let handle: number | undefined;
    let index = 0;
    const built: Mesh[] = [];
    const idle: (cb: () => void) => number =
      typeof requestIdleCallback === "function"
        ? (cb) => requestIdleCallback(cb)
        : (cb) => window.setTimeout(cb, 0);
    const cancelIdle: (id: number) => void =
      typeof cancelIdleCallback === "function"
        ? cancelIdleCallback
        : window.clearTimeout;

    const step = () => {
      if (cancelled) return;
      const end = Math.min(index + BVH_BUILD_BATCH, meshes.length);
      for (; index < end; index++) {
        const mesh = meshes[index];
        if (!mesh) continue;
        const geom = mesh.geometry as BvhGeometry;
        if (geom.boundsTree) continue;
        geom.computeBoundsTree = computeBoundsTree;
        geom.disposeBoundsTree = disposeBoundsTree;
        geom.computeBoundsTree({ strategy: SAH });
        mesh.raycast = acceleratedRaycast;
        built.push(mesh);
      }
      if (index < meshes.length) handle = idle(step);
    };
    handle = idle(step);

    return () => {
      cancelled = true;
      if (handle !== undefined) cancelIdle(handle);
      delete raycaster.firstHitOnly;
      for (const mesh of built) {
        const geom = mesh.geometry as BvhGeometry;
        if (geom.boundsTree) geom.disposeBoundsTree?.();
        mesh.raycast = Mesh.prototype.raycast;
      }
    };
  }, [scene, raycaster]);
}
/** Seconds a flagged step's components take to fade in at the seated pose */
const FADE_SECONDS = 1.2;

function AssemblyScene({
  scene,
  nodesById,
  steps,
  activeStepIndex,
  isPlaying,
  futureMode,
  highlightedNodeIds,
  hiddenNodeIds,
  focusedNodeIds,
  readOnly,
  onSelectComponents,
  editMotion,
  onMotionChange,
  assemblyDiagonal,
  capturePoseRef,
  assemblyBounds,
  leafBounds,
  segments,
  startTimes,
  playheadRef,
  seekRef,
  seekVersion,
  onStepFinished,
  onBoxRect,
  cameraMode,
  onFreeCamera,
  componentPickerActive
}: {
  scene: Object3D;
  nodesById: Map<string, Object3D>;
  steps: AssemblyStep[];
  activeStepIndex: number;
  isPlaying: boolean;
  futureMode: FutureComponentsMode;
  highlightedNodeIds?: string[];
  hiddenNodeIds?: string[];
  focusedNodeIds?: string[];
  readOnly: boolean;
  onSelectComponents?: (nodeIds: string[]) => void;
  /** Active-step motion draft to edit (null = play normally) */
  editMotion: { stepId: string; motion: Motion } | null;
  onMotionChange?: (stepId: string, motion: Motion) => void;
  /** Assembly diagonal (world units) for sizing the waypoint handles */
  assemblyDiagonal: number;
  /** The scene writes the live-camera reader here for the imperative handle */
  capturePoseRef: React.MutableRefObject<(() => CameraPose | null) | null>;
  /** Seated world bounds from graph.json (stable under animation) */
  assemblyBounds: { min: number[]; max: number[] } | null;
  /** Seated per-leaf bounds for camera occlusion scoring */
  leafBounds:
    | { nodeId: string; bbox: { min: number[]; max: number[] } }[]
    | null;
  /** Timeline seconds per step */
  segments: number[];
  /** Timeline start (seconds) of each step */
  startTimes: number[];
  /** Written each frame with the global playhead (seconds) */
  playheadRef: React.MutableRefObject<number>;
  /** Pending seek (seconds within the active step); consumed on apply */
  seekRef: React.MutableRefObject<number | null>;
  /** Bumped to re-apply a seek within the same step */
  seekVersion: number;
  /** The active step's timeline segment has fully elapsed */
  onStepFinished?: () => void;
  /** Live marquee rectangle (canvas-local px) while box-selecting; null clears */
  onBoxRect?: (rect: BoxRect | null) => void;
  /** "free" suppresses per-step camera framing (user owns the view) */
  cameraMode: "auto" | "free";
  /** The user grabbed the controls during playback — switch to free mode */
  onFreeCamera: () => void;
  /** Picking components to add to a step — ghost every not-yet-installed part so
   * un-animated parts are visible and clickable */
  componentPickerActive: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree(
    (state) => state.controls
  ) as unknown as OrbitControlsImpl | null;
  const gl = useThree((state) => state.gl);

  // Accelerate raycasting (hover/click picking) with per-geometry BVHs, built
  // progressively on idle so a dense model never hitches the main thread.
  useProgressiveBvh(scene);

  // Fit the perspective near/far planes to the model. A static 0.1 → 100000
  // range is a 1e6 depth ratio: the buffer spends almost all its precision
  // right in front of `near`, so coplanar CAD faces (touching solids, a boss
  // flush on a plate) z-fight into a tearing moiré at model distance. Sizing
  // the range to the assembly diagonal collapses the ratio to ~1e4 and keeps
  // those faces stable, while still leaving room to zoom close and orbit out.
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const box = new Box3().setFromObject(scene);
    if (box.isEmpty()) return;
    const diag = box.getSize(new Vector3()).length();
    if (!(diag > 0)) return;
    camera.near = Math.max(diag / 500, 0.01);
    camera.far = diag * 20;
    camera.updateProjectionMatrix();
  }, [camera, scene]);

  // Break coincident-face z-fighting. A multi-body STEP split turns each solid
  // into its own mesh; a part seated flush on a plate (a bolt head on its face)
  // shares that face's exact plane, so the two meshes sit at IDENTICAL depth and
  // the GPU can't pick a winner — the face tears at every camera distance (no
  // depth-precision trick resolves an exact tie). Give each distinct material a
  // unique polygon offset so one always wins at a coincidence. Coincident parts
  // are near-always different parts with different materials (the bolt vs the
  // plate), so per-material differentiates them with no per-mesh cloning; we
  // just tag the loaded glTF materials in place. The offset is a few depth-buffer
  // units — far below any real (sub-mm) gap — so separated faces are untouched.
  useEffect(() => {
    const tagged = new Set<Material>();
    let offset = -1;
    scene.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        if (tagged.has(material)) continue;
        tagged.add(material);
        material.polygonOffset = true;
        material.polygonOffsetFactor = -1;
        material.polygonOffsetUnits = offset;
        offset -= 1;
      }
    });
  }, [scene]);

  const activeStep = steps[activeStepIndex] ?? null;
  const isEditingActive = Boolean(
    editMotion && activeStep && editMotion.stepId === activeStep.id
  );

  // Anchor for the editable path: center of the step's components' seated world
  // bounds — the visual center of the object at its final location. Node
  // origins won't do: CAD exports often pivot far from the geometry, which
  // would draw the locked endpoint away from the component. Components sit seated while
  // editing (the clip is skipped below), so world space IS the final pose.
  const seatedCentroid = useMemo<Vec3 | null>(() => {
    if (!isEditingActive || !activeStep) return null;
    const box = new Box3();
    for (const nodeId of activeStep.componentNodeIds) {
      const node = nodesById.get(nodeId);
      if (!node) continue;
      node.updateWorldMatrix(true, false);
      box.expandByObject(node);
    }
    if (box.isEmpty()) return null;
    return box.getCenter(new Vector3()).toArray() as Vec3;
  }, [isEditingActive, activeStep, nodesById]);

  const highlightedSet = useMemo(
    () => new Set(highlightedNodeIds ?? []),
    [highlightedNodeIds]
  );

  const focusedSet = useMemo(
    () => new Set(focusedNodeIds ?? []),
    [focusedNodeIds]
  );
  const hiddenSet = useMemo(
    () => new Set(hiddenNodeIds ?? []),
    [hiddenNodeIds]
  );

  // Component picking is only meaningful in the editor (a selection callback,
  // not read-only) — the drill affordance is gated on it so pure playback stays
  // untouched.
  const pickingEnabled = !readOnly && !!onSelectComponents;
  // Alt-hover x-ray drill: the occluders in front of the pointer (ghosted so
  // you can see through the box/lid) and the innermost part they reveal (the
  // click target). A ref mirrors the target so the high-frequency pointer-move
  // only re-renders when the drilled part actually changes.
  const [drill, setDrillState] = useState<{
    ghostIds: string[];
    target: string;
  } | null>(null);
  const drillTargetRef = useRef<string | null>(null);
  // True while the camera is being orbited — drill raycasts are skipped then.
  const orbitingRef = useRef(false);
  const clearDrill = useCallback(() => {
    if (drillTargetRef.current === null) return;
    drillTargetRef.current = null;
    setDrillState(null);
  }, []);

  /** nodeId → index of the first step that installs it */
  const stepIndexByNode = useMemo(() => {
    const map = new Map<string, number>();
    steps.forEach((step, index) => {
      for (const nodeId of step.componentNodeIds) {
        if (!map.has(nodeId)) map.set(nodeId, index);
      }
    });
    return map;
  }, [steps]);

  // --- Component visual states (visibility + material overrides) ---------------

  const overridesRef = useRef(new Map<Mesh, MaterialOverrides>());

  // AssemblyScene is keyed by scene uuid, so unmount means the scene is done:
  // dispose the cloned override materials.
  useEffect(() => {
    const overrides = overridesRef.current;
    return () => {
      for (const entry of overrides.values()) {
        if (entry.ghost) disposeMaterials(entry.ghost);
        if (entry.highlight) disposeMaterials(entry.highlight);
        if (entry.selected) disposeMaterials(entry.selected);
        if (entry.external) disposeMaterials(entry.external);
        if (entry.fade) disposeMaterials(entry.fade);
      }
      overrides.clear();
    };
  }, []);

  useEffect(() => {
    const overrides = overridesRef.current;

    // Reset: everything visible with its original material
    for (const node of nodesById.values()) {
      node.visible = true;
    }
    for (const [mesh, entry] of overrides) {
      mesh.material = entry.original;
      mesh.renderOrder = 0;
    }

    const applyVisual = (node: Object3D, visual: ComponentVisual) => {
      if (visual === "hidden") {
        node.visible = false;
        return;
      }
      if (visual === "solid") return;
      node.traverse((object) => {
        if (!(object as Mesh).isMesh) return;
        const mesh = object as Mesh;
        if (visual === "ghost") {
          mesh.material = getOverride(mesh, overrides, "ghost");
          // Draw transparent ghosts after opaque components to limit sorting artifacts
          mesh.renderOrder = 1;
        } else {
          mesh.material = getOverride(mesh, overrides, "highlight");
        }
      });
    };

    // While the animation plays, later-step components stay hidden until their own
    // step installs them, so playback reads as a real build-up rather than a
    // ghosted preview. The future-components toggle still applies while paused.
    // Component-picker mode overrides both: every not-yet-installed part ghosts
    // (x-ray) so the user can see AND click the parts they want to add — a
    // "hidden" future part is invisible and unpickable.
    const effectiveFutureMode: FutureComponentsMode = componentPickerActive
      ? "ghost"
      : isPlaying
        ? "hidden"
        : futureMode;

    for (const [nodeId, stepIndex] of stepIndexByNode) {
      const node = nodesById.get(nodeId);
      if (!node) continue;
      const visual = visualForComponent(
        stepIndex,
        activeStepIndex,
        effectiveFutureMode
      );
      // The active step's blue tint is a "what's animating now" cue — only
      // apply it during playback. Statically selecting/seating a step leaves
      // its parts their real color (the step list + timeline show which is
      // current).
      applyVisual(node, visual === "active" && !isPlaying ? "solid" : visual);
    }

    // Components no step installs are never "already there": they get the same
    // treatment as future-step components (hidden during playback, the
    // future-components toggle while paused). Skipped when there are no steps
    // at all — a plain model preview should show everything.
    if (steps.length > 0 && leafBounds) {
      const unassignedVisual = visualForComponent(
        undefined,
        activeStepIndex,
        effectiveFutureMode
      );
      for (const leaf of leafBounds) {
        if (stepIndexByNode.has(leaf.nodeId)) continue;
        const node = nodesById.get(leaf.nodeId);
        if (!node) continue;
        applyVisual(node, unassignedVisual);
      }
    }

    // External (BOM) highlight: emissive tint, forced visible even when the
    // component's step would hide it ("show me all the M8 bolts"). Skipped for
    // focused nodes — isolating a part shows it in its REAL color; the isolate
    // itself is the cue, no tint.
    for (const nodeId of highlightedSet) {
      if (focusedSet.has(nodeId)) continue;
      const node = nodesById.get(nodeId);
      if (!node) continue;
      node.visible = true;
      node.traverse((object) => {
        if (!(object as Mesh).isMesh) return;
        const mesh = object as Mesh;
        mesh.material = getOverride(mesh, overrides, "external");
        mesh.renderOrder = 0;
      });
    }

    // Isolate/focus: when a focus set is active, ONLY the focused components
    // render — everything else hides so the selection can be inspected alone.
    // Keep the focused node's ANCESTORS visible too: three.js visibility is
    // inherited, and every glTF node (including the root wrapper and assembly
    // groups) carries a nodeId, so blindly hiding non-focused nodes would hide
    // the focused leaf's parents and blank the whole model. Applied before the
    // explicit-hide pass so a focused-but-manually-hidden component still hides.
    if (focusedSet.size > 0) {
      const keep = new Set<Object3D>();
      for (const nodeId of focusedSet) {
        const node = nodesById.get(nodeId);
        if (!node) continue;
        for (let a: Object3D | null = node; a; a = a.parent) keep.add(a);
        node.traverse((descendant) => keep.add(descendant));
      }
      // Only touch nodeId-stamped nodes — the reset above restores exactly these
      // to visible, so meshes (which inherit) never get stranded hidden. Ancestor
      // nodes stay in `keep`, so a focused leaf's parents don't blank it out.
      for (const node of nodesById.values()) {
        node.visible = keep.has(node);
      }
    }

    // Explicitly hidden components (fixtures/reference geometry) always hide,
    // even when highlighted
    for (const nodeId of hiddenSet) {
      const node = nodesById.get(nodeId);
      if (node) node.visible = false;
    }

    // The selection renders on top of everything else. It's the same set as the
    // external highlight above (both come from `highlightedNodeIds`), so a
    // selected component is forced visible there, then gets the strong "selected"
    // material here — regardless of whether it was picked in the viewer or the
    // Components panel.
    for (const nodeId of highlightedSet) {
      if (focusedSet.has(nodeId)) continue; // isolated part keeps its real color
      const node = nodesById.get(nodeId);
      if (!node || !node.visible) continue;
      node.traverse((object) => {
        if (!(object as Mesh).isMesh) return;
        const mesh = object as Mesh;
        mesh.material = getOverride(mesh, overrides, "selected");
      });
    }

    // Alt-hover x-ray drill: ghost the occluders in front of the pointer so the
    // innermost part they hide (the click target) shows through. Applied last so
    // it wins even over a selected occluder — you're deliberately looking past
    // it. The target keeps its real material (it's the solid thing behind glass).
    if (drill) {
      for (const nodeId of drill.ghostIds) {
        const node = nodesById.get(nodeId);
        if (!node?.visible) continue;
        node.traverse((object) => {
          if (!(object as Mesh).isMesh) return;
          const mesh = object as Mesh;
          mesh.material = getOverride(mesh, overrides, "ghost");
          mesh.renderOrder = 1;
        });
      }
    }
  }, [
    nodesById,
    stepIndexByNode,
    steps.length,
    leafBounds,
    activeStepIndex,
    futureMode,
    isPlaying,
    componentPickerActive,
    highlightedSet,
    hiddenSet,
    focusedSet,
    drill
  ]);

  // --- Animation -----------------------------------------------------------

  const mixer = useMemo(() => new AnimationMixer(scene), [scene]);
  const actionRef = useRef<ReturnType<AnimationMixer["clipAction"]> | null>(
    null
  );
  // Live mirror so the step-keyed clip effect can tell "static selection" (snap
  // seated) from "playing" without listing isPlaying as a dep.
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  /** Seconds elapsed within the active step's timeline segment */
  const localElapsedRef = useRef(0);
  const finishedRef = useRef(false);

  // The clip effect is keyed on a CONTENT signature of the active step, not the
  // `steps` array identity — a loader revalidation (5s poll, realtime) hands
  // down a new-but-equivalent array, and re-running the effect on it would tear
  // down and restart an in-flight animation from t=0 plus rebuild the clip.
  // Mirrors the per-step camera effect's framingKey guard. The body reads the
  // live values through refs so the signature is the only re-run trigger.
  const stepsLiveRef = useRef(steps);
  stepsLiveRef.current = steps;
  const startTimesLiveRef = useRef(startTimes);
  startTimesLiveRef.current = startTimes;
  const clipKey = activeStep
    ? [
        activeStepIndex,
        activeStep.id,
        JSON.stringify(activeStep.motion),
        activeStep.componentNodeIds.join(","),
        isEditingActive
      ].join("|")
    : `none|${activeStepIndex}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: clipKey is the content signature that keys the rebuild — a revalidation with an equivalent steps array must not re-run this effect
  useEffect(() => {
    const step = stepsLiveRef.current[activeStepIndex];

    // Consume any pending seek; otherwise the step starts at 0
    const seek = seekRef.current;
    seekRef.current = null;
    localElapsedRef.current = seek ?? 0;
    finishedRef.current = false;
    playheadRef.current =
      (startTimesLiveRef.current[activeStepIndex] ?? 0) +
      localElapsedRef.current;

    if (!step) return;

    // Editing this step's path: keep components at their seated pose, skip the clip
    // so the animation doesn't fight the drag handles.
    if (isEditingActive) return;

    const clip = buildStepClip(step, nodesById);
    if (!clip) return;

    // Save seated transforms so we can restore them when the step changes
    const restore = step.componentNodeIds
      .map((nodeId) => nodesById.get(nodeId))
      .filter((node): node is Object3D => Boolean(node))
      .map((node) => ({
        node,
        position: node.position.clone(),
        quaternion: node.quaternion.clone()
      }));

    const action = mixer.clipAction(clip);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    if (seek !== null) {
      action.time = Math.min(seek, clip.duration);
      mixer.update(0);
    } else if (!isPlayingRef.current) {
      // Static selection (no play): show the step COMPLETED — the component
      // seated, not flown-out at t=0. A double-click seeks back to 0 and plays.
      action.time = clip.duration;
      mixer.update(0);
      localElapsedRef.current = clip.duration;
      finishedRef.current = true;
      playheadRef.current =
        (startTimesLiveRef.current[activeStepIndex] ?? 0) + clip.duration;
    }
    actionRef.current = action;

    return () => {
      action.stop();
      mixer.uncacheClip(clip);
      actionRef.current = null;
      for (const { node, position, quaternion } of restore) {
        node.position.copy(position);
        node.quaternion.copy(quaternion);
      }
    };
  }, [
    mixer,
    nodesById,
    clipKey,
    activeStepIndex,
    isEditingActive,
    seekRef,
    playheadRef
  ]);

  // Same-step scrub: apply the pending seek to the LIVE action instead of
  // re-running the clip effect — a timeline drag fires many times per second,
  // and each effect re-run would stop/uncache/rebuild the whole clip when only
  // `action.time` changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seekVersion is the trigger for re-applying a same-step seek
  useEffect(() => {
    const seek = seekRef.current;
    if (seek === null) return;
    seekRef.current = null;
    localElapsedRef.current = seek;
    finishedRef.current = false;
    playheadRef.current =
      (startTimesLiveRef.current[activeStepIndex] ?? 0) + seek;
    const action = actionRef.current;
    if (action) {
      action.time = Math.min(seek, action.getClip().duration);
      mixer.update(0);
    }
  }, [seekVersion, activeStepIndex, mixer, seekRef, playheadRef]);

  useEffect(() => {
    if (actionRef.current) actionRef.current.paused = !isPlaying;
  }, [isPlaying]);

  // --- Seated fade-in ---------------------------------------------------
  // Steps that install components without an animation fade them in at the
  // seated pose instead of popping: planner-flagged steps (no collision-free
  // path exists) and any non-first step whose display motion resolved to
  // "none" (no stored motion and no collision-free fallback). Runs after the
  // visual-state pass, which assigns the base materials this overrides.
  const fadeRef = useRef<{
    meshes: Mesh[];
    materials: Material[];
    seconds: number;
  } | null>(null);

  useEffect(() => {
    const step = steps[activeStepIndex];
    // Editing this step: keep its components solid at the seated pose, no fade.
    if (editMotion && step && editMotion.stepId === step.id) {
      fadeRef.current = null;
      return;
    }
    const fadesIn =
      step &&
      step.motion.type === "none" &&
      step.componentNodeIds.length > 0 &&
      (step.flagged || activeStepIndex > 0);
    if (!fadesIn) {
      fadeRef.current = null;
      return;
    }

    const overrides = overridesRef.current;
    const meshes: Mesh[] = [];
    const materials: Material[] = [];
    for (const nodeId of step.componentNodeIds) {
      const node = nodesById.get(nodeId);
      if (!node) continue;
      node.traverse((object) => {
        if (!(object as Mesh).isMesh) return;
        const mesh = object as Mesh;
        const override = getOverride(mesh, overrides, "fade");
        for (const material of Array.isArray(override)
          ? override
          : [override]) {
          material.transparent = true;
          material.opacity = 0;
          material.depthWrite = false;
          materials.push(material);
        }
        mesh.material = override;
        // Draw after opaque components while transparent
        mesh.renderOrder = 1;
        meshes.push(mesh);
      });
    }
    if (meshes.length === 0) {
      fadeRef.current = null;
      return;
    }

    const segment = segments[activeStepIndex] ?? 0;
    fadeRef.current = {
      meshes,
      materials,
      seconds: segment > 0 ? Math.min(FADE_SECONDS, segment) : FADE_SECONDS
    };

    return () => {
      fadeRef.current = null;
      // Materials are reassigned by the visual-state pass on step change
      for (const mesh of meshes) mesh.renderOrder = 0;
    };
  }, [steps, activeStepIndex, nodesById, segments, editMotion]);

  useFrame(() => {
    const fade = fadeRef.current;
    if (!fade) return;
    const progress =
      fade.seconds > 0
        ? Math.min(localElapsedRef.current / fade.seconds, 1)
        : 1;
    for (const material of fade.materials) {
      material.opacity = progress;
      material.transparent = progress < 1;
      material.depthWrite = progress >= 1;
    }
  });

  useFrame((_, delta) => {
    if (isPlaying) {
      mixer.update(delta);
      localElapsedRef.current += delta;
    }
    const segment = segments[activeStepIndex] ?? 0;
    const clamped = Math.min(localElapsedRef.current, segment);
    playheadRef.current = (startTimes[activeStepIndex] ?? 0) + clamped;
    if (
      isPlaying &&
      !finishedRef.current &&
      segment > 0 &&
      localElapsedRef.current >= segment
    ) {
      finishedRef.current = true;
      onStepFinished?.();
    }
  });

  // --- Camera ----------------------------------------------------------------

  // Expose a live-camera reader for the "Set view" button (per-step camera).
  useEffect(() => {
    capturePoseRef.current = () => {
      if (!controls) return null;
      const fov = camera instanceof PerspectiveCamera ? camera.fov : 45;
      return {
        position: camera.position.toArray() as Vec3,
        target: controls.target.toArray() as Vec3,
        fov
      };
    };
    return () => {
      capturePoseRef.current = null;
    };
  }, [camera, controls, capturePoseRef]);

  const frameBox = useCallback(
    (box: Box3) => {
      if (box.isEmpty() || !controls) return;
      const center = box.getCenter(new Vector3());
      const radius = box.getSize(new Vector3()).length() / 2;
      const fov = camera instanceof PerspectiveCamera ? camera.fov : 45;
      const distance = Math.max(
        (radius / Math.tan(((fov / 2) * Math.PI) / 180)) * 1.4,
        radius * 2
      );
      const direction = camera.position
        .clone()
        .sub(controls.target)
        .normalize();
      // Front-top-right isometric (models are Z-up, -Y front)
      if (direction.lengthSq() === 0) direction.set(1, -1, 1).normalize();
      camera.position.copy(center).addScaledVector(direction, distance);
      controls.target.copy(center);
      controls.update();
    },
    [camera, controls]
  );

  // The whole-assembly bounds set the standing camera distance: per-step
  // transitions keep this distance and only rotate, so the zoom never jumps
  // between steps. Prefer the graph's seated bounds — measuring the scene
  // mid-animation would inflate the box with displaced components.
  const getAssemblyBox = useCallback((): Box3 => {
    if (assemblyBounds) {
      return new Box3(
        new Vector3(...(assemblyBounds.min as [number, number, number])),
        new Vector3(...(assemblyBounds.max as [number, number, number]))
      );
    }
    return new Box3().setFromObject(scene);
  }, [assemblyBounds, scene]);

  // Initial framing of the whole assembly
  const framedSceneRef = useRef<Object3D | null>(null);
  useEffect(() => {
    if (!controls || framedSceneRef.current === scene) return;
    framedSceneRef.current = scene;
    frameBox(getAssemblyBox());
  }, [scene, controls, frameBox, getAssemblyBox]);

  // Smoothly approached camera pose (per-step rotation); cleared when the
  // user grabs the controls so they can take over mid-transition
  const desiredPoseRef = useRef<{ position: Vector3; target: Vector3 } | null>(
    null
  );

  // Signature of the last pose the per-step effect framed. Guards against
  // re-framing when nothing framing-relevant changed — the effect otherwise
  // re-runs on every new `steps` array reference (any revalidation, or a component
  // selection that restages the draft), silently yanking the camera back and
  // discarding the orbit the user did to inspect the selected component.
  const lastFramedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!controls) return;
    const onStart = () => {
      desiredPoseRef.current = null;
      // Orbiting is not picking — suppress hover raycasts (and drop the tint)
      // while the camera is being dragged, the moment it feels choppiest.
      orbitingRef.current = true;
      clearDrill();
      // Grabbing the view mid-playback means the user wants to keep it — stop
      // re-framing on every step until they opt back into auto via the badge.
      if (isPlaying) onFreeCamera();
    };
    const onEnd = () => {
      orbitingRef.current = false;
    };
    controls.addEventListener("start", onStart);
    controls.addEventListener("end", onEnd);
    return () => {
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("end", onEnd);
    };
  }, [controls, isPlaying, onFreeCamera, clearDrill]);

  // Returning to auto must re-frame the CURRENT step even when its framing key
  // hasn't changed — the user panned away and asked for the staged view back.
  useEffect(() => {
    if (cameraMode === "auto") lastFramedKeyRef.current = null;
  }, [cameraMode]);

  // Transition by orbiting around the target — the view direction rotates
  // and the distance eases, so the model never leaves the frame the way a
  // straight-line position lerp can.
  useFrame((_, delta) => {
    const desired = desiredPoseRef.current;
    if (!desired || !controls) return;
    const alpha = 1 - Math.exp(-delta * 4);

    controls.target.lerp(desired.target, alpha);

    const currentOffset = SCRATCH_CURRENT_OFFSET.copy(camera.position).sub(
      controls.target
    );
    const desiredOffset = SCRATCH_DESIRED_OFFSET.copy(desired.position).sub(
      desired.target
    );
    const currentDistance = Math.max(currentOffset.length(), 1e-3);
    const desiredDistance = Math.max(desiredOffset.length(), 1e-3);

    const direction = currentOffset
      .divideScalar(currentDistance)
      .lerp(desiredOffset.divideScalar(desiredDistance), alpha);
    if (direction.lengthSq() < 1e-6) {
      // Opposite directions: nudge through the desired side
      direction.copy(desired.position).sub(desired.target).normalize();
    }
    direction.normalize();

    const distance =
      currentDistance + (desiredDistance - currentDistance) * alpha;
    camera.position.copy(controls.target).addScaledVector(direction, distance);
    controls.update();

    if (
      camera.position.distanceToSquared(desired.position) < 0.01 &&
      controls.target.distanceToSquared(desired.target) < 0.01
    ) {
      desiredPoseRef.current = null;
    }
  });

  // Selecting/highlighting components intentionally does NOT move the camera —
  // the red tint (+ forced visibility) is the feedback. Auto-framing here
  // yanked the view away every time a component was picked in the components panel.

  // Per-step camera: explicit pose wins; otherwise keep the standing
  // whole-assembly distance and rotate so the active component and its travel
  // face the camera — the zoom stays steady, only the view angle changes.
  useEffect(() => {
    const step = steps[activeStepIndex];
    if (!step || !controls) return;
    // Free mode: the user owns the view — no per-step framing at all.
    if (cameraMode === "free") return;

    // Only re-frame when the active step (or a framing-relevant input) actually
    // changes. A bare re-render — or a revalidation / component selection that hands
    // us a new-but-equivalent `steps` array — must not recompute a pose and pull
    // the camera off wherever the user orbited it to.
    const framingKey = [
      activeStepIndex,
      step.id,
      JSON.stringify(step.camera ?? null),
      JSON.stringify(step.componentNodeIds),
      JSON.stringify(step.motion),
      futureMode,
      [...hiddenSet].sort().join(",")
    ].join("|");
    if (framingKey === lastFramedKeyRef.current) return;
    lastFramedKeyRef.current = framingKey;

    // Manual "Set view" pose — applied verbatim, fov included.
    if (step.camera && !("source" in step.camera)) {
      desiredPoseRef.current = {
        position: new Vector3(...step.camera.position),
        target: new Vector3(...step.camera.target)
      };
      if (camera instanceof PerspectiveCamera) {
        camera.fov = step.camera.fov;
        camera.updateProjectionMatrix();
      }
      return;
    }

    // Planner-baked view direction: chosen at plan time with sight lines
    // against the real triangles of everything installed earlier — the AABB
    // scoring below can't tell a hollow container's open top from its wall.
    // Target, distance, and the frustum fit still happen live.
    const planDirection =
      step.camera && "source" in step.camera
        ? new Vector3(...step.camera.direction).normalize()
        : null;

    if (step.componentNodeIds.length === 0) return;

    const assemblyBox = getAssemblyBox();
    if (assemblyBox.isEmpty()) return;
    const center = assemblyBox.getCenter(new Vector3());
    const radius = assemblyBox.getSize(new Vector3()).length() / 2;
    const fov = camera instanceof PerspectiveCamera ? camera.fov : 45;
    const distance = Math.max(
      (radius / Math.tan(((fov / 2) * Math.PI) / 180)) * 1.25,
      radius * 2
    );

    const componentBox = new Box3();
    for (const nodeId of step.componentNodeIds) {
      const node = nodesById.get(nodeId);
      if (node) componentBox.expandByObject(node);
    }
    if (componentBox.isEmpty()) return;
    const componentCenter = componentBox.getCenter(new Vector3());

    // Aim mostly at the assembly (context) with a nudge toward the component
    const target = center.clone().lerp(componentCenter, 0.3);

    // Where the action happens: the seated body (corners, so a mostly-hidden
    // part scores worse than a clear one) plus the full travel — start,
    // midpoint, and seat.
    const motionDirection = insertionDirection(step.motion);
    const startOffset = insertionStartOffset(step.motion);
    const boxCorner = (box: Box3, i: number, offset: Vector3 | null) => {
      const corner = new Vector3(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z
      );
      return offset ? corner.add(offset) : corner;
    };
    const lookPoints = [componentCenter];
    for (let i = 0; i < 8; i++) {
      lookPoints.push(boxCorner(componentBox, i, null));
    }
    if (startOffset) {
      lookPoints.push(
        componentCenter.clone().addScaledVector(startOffset, 0.5)
      );
      lookPoints.push(componentCenter.clone().add(startOffset));
    }

    const up = camera.up.clone().normalize();
    let bestDirection: Vector3;
    if (planDirection && planDirection.lengthSq() > 1e-6) {
      bestDirection = planDirection;
    } else {
      // Live fallback (manual/edited steps, plans without directions):
      // AABB-scored candidates. Coarse — it can't see through hollow
      // geometry — which is exactly why generated steps carry a baked
      // direction instead.
      const stepComponents = new Set(step.componentNodeIds);
      const occluders: { min: Vector3; max: Vector3; weight: number }[] = [];
      for (const leaf of leafBounds ?? []) {
        if (stepComponents.has(leaf.nodeId)) continue;
        if (hiddenSet.has(leaf.nodeId)) continue;
        const leafStep = stepIndexByNode.get(leaf.nodeId);
        const isFuture = leafStep !== undefined && leafStep > activeStepIndex;
        if (isFuture && futureMode === "hidden") continue;
        occluders.push({
          min: new Vector3(...(leaf.bbox.min as [number, number, number])),
          max: new Vector3(...(leaf.bbox.max as [number, number, number])),
          weight: isFuture && futureMode === "ghost" ? 0.3 : 1
        });
      }

      // Candidate view directions: elevation rings around the up axis, plus
      // the current view. Pick the one that sees the action with the fewest
      // components in the way, preferring lateral travel and small turns.
      let basisU = new Vector3().crossVectors(up, new Vector3(0, 0, 1));
      if (basisU.lengthSq() < 1e-6) {
        basisU = new Vector3().crossVectors(up, new Vector3(1, 0, 0));
      }
      basisU.normalize();
      const basisV = new Vector3().crossVectors(up, basisU).normalize();

      const currentDirection = camera.position
        .clone()
        .sub(controls.target)
        .normalize();
      const candidates: Vector3[] = [];
      if (currentDirection.lengthSq() > 1e-6) candidates.push(currentDirection);
      // Third, steeper ring: in dense machines the only clear sight line to a
      // buried part is often from high above.
      for (const elevation of [0.3, 0.55, 0.8]) {
        const horizontal = Math.sqrt(1 - elevation * elevation);
        for (let i = 0; i < 8; i++) {
          const azimuth = (i / 8) * Math.PI * 2;
          candidates.push(
            new Vector3()
              .addScaledVector(basisU, Math.cos(azimuth) * horizontal)
              .addScaledVector(basisV, Math.sin(azimuth) * horizontal)
              .addScaledVector(up, elevation)
              .normalize()
          );
        }
      }

      bestDirection = candidates[0] ?? new Vector3(1, 1, 1).normalize();
      let bestScore = Number.POSITIVE_INFINITY;
      for (const candidate of candidates) {
        const eye = target.clone().addScaledVector(candidate, distance);
        let score = 0;
        // How much is in the way of seeing the action?
        for (const point of lookPoints) {
          for (const occluder of occluders) {
            if (segmentIntersectsBox(eye, point, occluder.min, occluder.max)) {
              score += occluder.weight;
            }
          }
        }
        // Prefer travel running across the screen, not into it
        if (motionDirection) {
          score +=
            4 * Math.max(0, Math.abs(candidate.dot(motionDirection)) - 0.6);
        }
        // Prefer small turns from the current view
        score += 1.75 * (1 - candidate.dot(currentDirection));
        if (score < bestScore) {
          bestScore = score;
          bestDirection = candidate;
        }
      }
    }

    // Guarantee the action is entirely in frame: pan the target (and only
    // grow the distance when the action genuinely can't fit) so the seated
    // body plus its travel-start copy sit inside the frustum.
    let right = new Vector3().crossVectors(up, bestDirection);
    if (right.lengthSq() < 1e-6) right = new Vector3(1, 0, 0);
    right.normalize();
    const trueUp = new Vector3().crossVectors(bestDirection, right).normalize();
    const actionPoints: Vector3[] = [];
    for (let i = 0; i < 8; i++) {
      actionPoints.push(boxCorner(componentBox, i, null));
      if (startOffset)
        actionPoints.push(boxCorner(componentBox, i, startOffset));
    }
    const rel = new Vector3();
    const camPoints: Vec3[] = actionPoints.map((point) => {
      rel.copy(point).sub(target);
      return [rel.dot(right), rel.dot(trueUp), rel.dot(bestDirection)];
    });
    const aspect =
      camera instanceof PerspectiveCamera && camera.aspect > 0
        ? camera.aspect
        : 16 / 9;
    const tanHalfV = Math.tan(((fov / 2) * Math.PI) / 180);
    const fit = fitFraming(
      camPoints,
      tanHalfV * aspect,
      tanHalfV,
      0.85,
      distance
    );
    const framedTarget = target
      .clone()
      .addScaledVector(right, fit.pan[0])
      .addScaledVector(trueUp, fit.pan[1]);

    desiredPoseRef.current = {
      position: framedTarget
        .clone()
        .addScaledVector(bestDirection, fit.distance),
      target: framedTarget
    };
  }, [
    steps,
    activeStepIndex,
    nodesById,
    camera,
    controls,
    getAssemblyBox,
    leafBounds,
    hiddenSet,
    stepIndexByNode,
    futureMode,
    cameraMode
  ]);

  // --- Selection -------------------------------------------------------------

  const handleClick = useCallback(
    (clickEvent: ThreeEvent<MouseEvent>) => {
      if (readOnly || !onSelectComponents) return;
      clickEvent.stopPropagation();
      // three.js raycasting ignores Object3D.visible, so a hidden enclosing
      // component still reports as the closest hit. Walk the front-to-back
      // intersections and pick the nearest component that is actually rendered,
      // letting clicks pass through hidden geometry to the components inside it.
      // Alt+click drills: select the INNERMOST part on the ray (through any
      // box/lid), matching the x-ray reveal shown on Alt-hover.
      const stack = visibleNodeStack(clickEvent.intersections);
      const nodeId =
        clickEvent.nativeEvent.altKey && stack.length >= 2
          ? (stack[stack.length - 1] ?? null)
          : findVisibleNodeId(clickEvent.intersections);
      if (!nodeId) return;
      // Selection is controlled by `highlightedNodeIds`: shift-click extends the
      // current selection, a plain click replaces it. Emit the new set and let
      // the parent own the state so it stays in lockstep with the Components panel
      // and clears instantly when the parent resets it (e.g. starting Add components).
      const next = clickEvent.nativeEvent.shiftKey
        ? new Set(highlightedSet)
        : new Set<string>();
      if (clickEvent.nativeEvent.shiftKey && next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      onSelectComponents([...next]);
    },
    [readOnly, onSelectComponents, highlightedSet]
  );

  const handlePointerMove = useCallback(
    (moveEvent: ThreeEvent<PointerEvent>) => {
      // Skip the raycast entirely while playing or orbiting — the two moments
      // the view is busiest. Drilling only happens with Alt held.
      if (
        !pickingEnabled ||
        isPlaying ||
        orbitingRef.current ||
        !moveEvent.nativeEvent.altKey
      ) {
        clearDrill();
        return;
      }
      const stack = visibleNodeStack(moveEvent.intersections);
      // Nothing to drill through — the front part IS the target, so no reveal.
      if (stack.length < 2) {
        clearDrill();
        return;
      }
      const target = stack[stack.length - 1] ?? null;
      if (!target || drillTargetRef.current === target) return;
      drillTargetRef.current = target;
      setDrillState({ ghostIds: stack.slice(0, -1), target });
    },
    [pickingEnabled, isPlaying, clearDrill]
  );

  const handlePointerOut = useCallback(() => clearDrill(), [clearDrill]);

  // Drop any stale drill when picking turns off (leaving edit mode) or playback
  // starts.
  useEffect(() => {
    if (!pickingEnabled || isPlaying) clearDrill();
  }, [pickingEnabled, isPlaying, clearDrill]);

  // Releasing Alt (even without moving) ends the drill promptly.
  useEffect(() => {
    if (!pickingEnabled) return;
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Alt") clearDrill();
    };
    window.addEventListener("keyup", onKeyUp);
    return () => window.removeEventListener("keyup", onKeyUp);
  }, [pickingEnabled, clearDrill]);

  // Pointer cursor signals a live drill target. document.body owns the cursor
  // because the r3f canvas fills the pane.
  useEffect(() => {
    document.body.style.cursor = drill ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [drill]);

  // A box drag just completed the selection — swallow the click that fires at
  // the end of the drag so it doesn't immediately clear what we just selected.
  const boxJustSelectedRef = useRef(false);

  const handlePointerMissed = useCallback(
    (pointerEvent: MouseEvent) => {
      if (readOnly || !onSelectComponents || pointerEvent.shiftKey) return;
      if (boxJustSelectedRef.current) {
        boxJustSelectedRef.current = false;
        return;
      }
      if (highlightedSet.size === 0) return;
      onSelectComponents([]);
    },
    [readOnly, onSelectComponents, highlightedSet]
  );

  // --- Box (marquee) selection ---------------------------------------------
  // Plain drag orbits as usual. Holding Shift turns the drag into a rubber-band
  // rectangle that adds every visible component whose center falls inside it to the
  // selection (the CAD Shift+box = add convention). Env is read through a ref so
  // the window listeners attach once yet always see the latest camera,
  // selection, and callbacks.
  const boxEnvRef = useRef({
    readOnly,
    onSelectComponents,
    editMotion,
    leafBounds,
    nodesById,
    highlightedSet,
    onBoxRect,
    camera,
    controls,
    gl
  });
  boxEnvRef.current = {
    readOnly,
    onSelectComponents,
    editMotion,
    leafBounds,
    nodesById,
    highlightedSet,
    onBoxRect,
    camera,
    controls,
    gl
  };

  useEffect(() => {
    const drag = {
      active: false,
      startX: 0,
      startY: 0,
      moved: false,
      // Canvas rect captured once per drag — the canvas can't move mid-drag,
      // and getBoundingClientRect per pointermove forces layout.
      rect: null as DOMRect | null
    };
    const localX = (event: PointerEvent, rect: DOMRect) =>
      event.clientX - rect.left;
    const localY = (event: PointerEvent, rect: DOMRect) =>
      event.clientY - rect.top;

    const onDown = (event: PointerEvent) => {
      const env = boxEnvRef.current;
      boxJustSelectedRef.current = false;
      // Box-select only while Shift is held; otherwise the drag orbits.
      if (
        event.button !== 0 ||
        !event.shiftKey ||
        env.readOnly ||
        !env.onSelectComponents ||
        env.editMotion ||
        event.target !== env.gl.domElement
      ) {
        return;
      }
      const rect = env.gl.domElement.getBoundingClientRect();
      if (env.controls) env.controls.enabled = false; // suppress orbit for the box
      drag.active = true;
      drag.rect = rect;
      drag.startX = localX(event, rect);
      drag.startY = localY(event, rect);
      drag.moved = false;
      env.onBoxRect?.({
        left: drag.startX,
        top: drag.startY,
        width: 0,
        height: 0
      });
    };

    const onMove = (event: PointerEvent) => {
      if (!drag.active) return;
      const env = boxEnvRef.current;
      const rect = drag.rect ?? env.gl.domElement.getBoundingClientRect();
      const x = localX(event, rect);
      const y = localY(event, rect);
      const width = Math.abs(x - drag.startX);
      const height = Math.abs(y - drag.startY);
      if (width > 3 || height > 3) drag.moved = true;
      env.onBoxRect?.({
        left: Math.min(drag.startX, x),
        top: Math.min(drag.startY, y),
        width,
        height
      });
    };

    const onUp = (event: PointerEvent) => {
      if (!drag.active) return;
      drag.active = false;
      const env = boxEnvRef.current;
      if (env.controls) env.controls.enabled = true;
      env.onBoxRect?.(null);
      // A click, not a drag — let the miss handler clear the selection instead.
      if (!drag.moved || !env.onSelectComponents) return;
      const rect = drag.rect ?? env.gl.domElement.getBoundingClientRect();
      const endX = localX(event, rect);
      const endY = localY(event, rect);
      const minX = Math.min(drag.startX, endX);
      const maxX = Math.max(drag.startX, endX);
      const minY = Math.min(drag.startY, endY);
      const maxY = Math.max(drag.startY, endY);
      const center = new Vector3();
      const inside: string[] = [];
      for (const leaf of env.leafBounds ?? []) {
        if (!env.nodesById.get(leaf.nodeId)?.visible) continue;
        const min = leaf.bbox.min as [number, number, number];
        const max = leaf.bbox.max as [number, number, number];
        center
          .set(
            (min[0] + max[0]) / 2,
            (min[1] + max[1]) / 2,
            (min[2] + max[2]) / 2
          )
          .project(env.camera);
        if (center.z > 1) continue; // behind the camera / beyond the far plane
        const sx = (center.x * 0.5 + 0.5) * rect.width;
        const sy = (-center.y * 0.5 + 0.5) * rect.height;
        if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
          inside.push(leaf.nodeId);
        }
      }
      boxJustSelectedRef.current = true;
      // Shift+box adds to the current selection.
      const set = new Set(env.highlightedSet);
      for (const nodeId of inside) set.add(nodeId);
      env.onSelectComponents([...set]);
    };

    window.addEventListener("pointerdown", onDown, { capture: true });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointerdown", onDown, { capture: true });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  return (
    <>
      <primitive
        object={scene}
        onClick={handleClick}
        onPointerMissed={handlePointerMissed}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
      />
      {isEditingActive && editMotion && onMotionChange && seatedCentroid && (
        <MotionPathEditor
          key={editMotion.stepId}
          motion={editMotion.motion}
          seatedPosition={seatedCentroid}
          scale={assemblyDiagonal}
          onMotionChange={(motion) => onMotionChange(editMotion.stepId, motion)}
        />
      )}
    </>
  );
}

/**
 * Does the open segment from `origin` to `end` pass through the AABB?
 * Slab clipping; ignores grazing contact right at the endpoint so a box
 * around the look-at point does not count as occluding itself.
 */
function segmentIntersectsBox(
  origin: Vector3,
  end: Vector3,
  min: Vector3,
  max: Vector3
): boolean {
  let tMin = 0;
  let tMax = 0.98; // stop just short of the look-at point
  const axes = ["x", "y", "z"] as const;
  for (const axis of axes) {
    const delta = end[axis] - origin[axis];
    if (Math.abs(delta) < 1e-9) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return false;
      continue;
    }
    let tNear = (min[axis] - origin[axis]) / delta;
    let tFar = (max[axis] - origin[axis]) / delta;
    if (tNear > tFar) [tNear, tFar] = [tFar, tNear];
    tMin = Math.max(tMin, tNear);
    tMax = Math.min(tMax, tFar);
    if (tMin > tMax) return false;
  }
  return true;
}

/**
 * Where a component starts relative to its seated pose for the given insertion
 * motion. Null when the motion does not translate the component.
 */
function insertionStartOffset(motion: AssemblyStep["motion"]): Vector3 | null {
  switch (motion.type) {
    case "linear": {
      const direction = new Vector3(...motion.direction).normalize();
      return direction.multiplyScalar(-motion.distance);
    }
    case "L": {
      const offset = new Vector3();
      for (const segment of motion.segments) {
        const direction = new Vector3(...segment.direction).normalize();
        offset.addScaledVector(direction, -segment.distance);
      }
      return offset;
    }
    case "helix": {
      const axis = new Vector3(...motion.axis).normalize();
      const travel = motion.approach + motion.pitch * motion.turns;
      return axis.multiplyScalar(-travel);
    }
    default:
      return null;
  }
}

/**
 * The dominant travel direction of an insertion motion (used to pick a
 * camera angle where the motion reads laterally). Null for motions that
 * do not translate the component.
 */
function insertionDirection(motion: AssemblyStep["motion"]): Vector3 | null {
  switch (motion.type) {
    case "linear":
      return new Vector3(...motion.direction).normalize();
    case "L": {
      let longest: Vector3 | null = null;
      let longestDistance = 0;
      for (const segment of motion.segments) {
        if (Math.abs(segment.distance) > longestDistance) {
          longestDistance = Math.abs(segment.distance);
          longest = new Vector3(...segment.direction);
        }
      }
      return longest ? longest.normalize() : null;
    }
    case "helix":
      return new Vector3(...motion.axis).normalize();
    default:
      return null;
  }
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = Math.floor(safe % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

/**
 * Chapter-style timeline: one segment per step (width ∝ its duration), the
 * played portion of each filled, the active step lifted, and a handle at the
 * playhead. A full-bleed transparent range input rides on top for pointer
 * scrubbing and keyboard control (←/→), so the custom visual stays purely
 * presentational.
 */
function TimelineScrubber({
  segments,
  startTimes,
  totalSeconds,
  displayTime,
  activeStepIndex,
  stepCount,
  onScrub
}: {
  segments: number[];
  startTimes: number[];
  totalSeconds: number;
  displayTime: number;
  activeStepIndex: number;
  stepCount: number;
  onScrub: (seconds: number) => void;
}) {
  const clamped = Math.min(Math.max(displayTime, 0), totalSeconds);
  const playheadPct = totalSeconds > 0 ? (clamped / totalSeconds) * 100 : 0;
  const disabled = stepCount === 0;

  return (
    <div className="group relative flex h-5 min-w-0 flex-1 items-center">
      <div className="flex h-1.5 w-full gap-0.5">
        {(segments.length > 0 ? segments : [1]).map((duration, index) => {
          const start = startTimes[index] ?? 0;
          const fill =
            duration > 0
              ? Math.min(Math.max((clamped - start) / duration, 0), 1)
              : clamped >= start
                ? 1
                : 0;
          return (
            <div
              key={`${start}-${index}`}
              className={cn(
                "relative h-full overflow-hidden rounded-full bg-muted-foreground/25 transition-colors",
                index === activeStepIndex && "bg-muted-foreground/40"
              )}
              style={{ flexGrow: Math.max(duration, 0.001) }}
            >
              <div
                className="absolute inset-0 origin-left rounded-full bg-primary"
                style={{ transform: `scaleX(${fill})` }}
              />
            </div>
          );
        })}
      </div>
      {!disabled && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 scale-50 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.5)] transition-transform group-hover:scale-100"
          style={{ left: `${playheadPct}%` }}
        />
      )}
      <input
        type="range"
        aria-label="Timeline"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        min={0}
        max={Math.max(totalSeconds, 0.01)}
        step={0.05}
        value={clamped}
        disabled={disabled}
        onChange={(changeEvent) => onScrub(Number(changeEvent.target.value))}
      />
    </div>
  );
}

/** True when the keyboard event is aimed at a text field, so shortcuts like
 * Cmd/Ctrl+A should fall through to the browser's own select-all. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

function findNodeId(object: Object3D): string | null {
  let current: Object3D | null = object;
  while (current) {
    const nodeId = current.userData?.nodeId;
    if (typeof nodeId === "string" && nodeId.length > 0) return nodeId;
    current = current.parent;
  }
  return null;
}

/** True only if the object and every ancestor are visible (i.e. rendered). */
function isRendered(object: Object3D): boolean {
  let current: Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

/**
 * The component id of the nearest intersection that is actually rendered. Skips
 * hidden geometry (raycasting ignores `visible`) so clicks fall through to the
 * frontmost visible component behind or inside it.
 */
function findVisibleNodeId(
  intersections: readonly { object: Object3D }[]
): string | null {
  for (const intersection of intersections) {
    if (!isRendered(intersection.object)) continue;
    const nodeId = findNodeId(intersection.object);
    if (nodeId) return nodeId;
  }
  return null;
}

/**
 * Distinct rendered component ids the pointer ray passes through, front to back.
 * A part is one node, so the ray entering and exiting the same box yields that
 * box once — the LAST entry is the innermost content, the drill-select target.
 */
function visibleNodeStack(
  intersections: readonly { object: Object3D }[]
): string[] {
  const stack: string[] = [];
  const seen = new Set<string>();
  for (const intersection of intersections) {
    if (!isRendered(intersection.object)) continue;
    const nodeId = findNodeId(intersection.object);
    if (nodeId && !seen.has(nodeId)) {
      seen.add(nodeId);
      stack.push(nodeId);
    }
  }
  return stack;
}

function getOverride(
  mesh: Mesh,
  cache: Map<Mesh, MaterialOverrides>,
  kind: OverrideKind
): Material | Material[] {
  let entry = cache.get(mesh);
  if (!entry) {
    entry = { original: mesh.material };
    cache.set(mesh, entry);
  }
  let override = entry[kind];
  if (!override) {
    const emissiveColor =
      kind === "highlight"
        ? HIGHLIGHT_COLOR
        : kind === "selected"
          ? SELECTED_COLOR
          : EXTERNAL_COLOR;
    override =
      kind === "ghost"
        ? cloneAsGhost(entry.original)
        : kind === "fade"
          ? cloneAsFade(entry.original)
          : cloneWithEmissive(entry.original, emissiveColor);
    entry[kind] = override;
  }
  return override;
}

/**
 * Fading-in flagged component: the original material starting fully transparent.
 * The scene animates opacity 0 → 1 across the step; at 1 the material is
 * switched back to opaque so it renders like any seated component.
 */
function cloneAsFade(material: Material | Material[]): Material | Material[] {
  const clone = (source: Material): Material => {
    const cloned = source.clone();
    cloned.transparent = true;
    cloned.opacity = 0;
    cloned.depthWrite = false;
    return cloned;
  };
  return Array.isArray(material) ? material.map(clone) : clone(material);
}

/**
 * Ghosted future component: the original material at low opacity so components keep
 * their color while reading as "not installed yet".
 */
function cloneAsGhost(material: Material | Material[]): Material | Material[] {
  const clone = (source: Material): Material => {
    const cloned = source.clone();
    cloned.transparent = true;
    cloned.opacity = GHOST_OPACITY;
    cloned.depthWrite = false;
    return cloned;
  };
  return Array.isArray(material) ? material.map(clone) : clone(material);
}

function cloneWithEmissive(
  material: Material | Material[],
  emissiveColor: number
): Material | Material[] {
  const clone = (source: Material): Material => {
    const cloned = source.clone();
    if (cloned instanceof MeshStandardMaterial) {
      cloned.emissive = new Color(emissiveColor);
      cloned.emissiveIntensity = 0.4;
    } else if ("color" in cloned) {
      (cloned as MeshBasicMaterial).color.lerp(new Color(emissiveColor), 0.5);
    }
    return cloned;
  };
  return Array.isArray(material) ? material.map(clone) : clone(material);
}

function disposeMaterials(material: Material | Material[]) {
  if (Array.isArray(material)) {
    for (const entry of material) entry.dispose();
  } else {
    material.dispose();
  }
}

function OverlayNavButton({
  side,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  side: "left" | "right";
}) {
  return (
    <button
      type="button"
      className={cn(
        "absolute top-1/2 z-10 flex h-20 w-12 -translate-y-1/2 items-center justify-center rounded-lg",
        "text-foreground/30 transition-colors hover:bg-background/40 hover:text-foreground/90",
        "disabled:pointer-events-none disabled:opacity-0",
        side === "left" ? "left-2" : "right-2",
        className
      )}
      {...props}
    >
      <svg
        className="h-8 w-8"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d={side === "left" ? "M15 18l-6-6 6-6" : "M9 6l6 6-6 6"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function ControlButton({
  isActive = false,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { isActive?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
        isActive && "bg-accent text-accent-foreground",
        className
      )}
      {...props}
    />
  );
}

function ChevronLeftIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15 18l-6-6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 5.14v13.72a1 1 0 001.5.87l11-6.86a1 1 0 000-1.74l-11-6.86a1 1 0 00-1.5.87z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function GhostIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="3 2"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function HiddenIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0112 5c7 0 10 7 10 7a16.7 16.7 0 01-3.2 4.2M6.6 6.6A16.4 16.4 0 002 12s3 7 10 7a9.9 9.9 0 004.3-1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.9 9.9a3 3 0 004.2 4.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SolidIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M12 12l8-4.5M12 12L4 7.5M12 12v9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
