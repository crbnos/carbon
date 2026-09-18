/** How components of steps after the active one are rendered. */
export type FutureComponentsMode = "ghost" | "hidden" | "solid";

/** How components of steps BEFORE the active one are rendered. */
export type InstalledComponentsMode = "ghost" | "hidden" | "solid";

export type ComponentVisual = "solid" | "active" | "hidden" | "ghost";

/**
 * The named views the toolbar offers, in the order they are presented.
 *
 * The two modes above are independent axes, which is the right model for the
 * renderer and the wrong one for the person looking at the screen: nine
 * combinations, most of them meaningless, asked through two icon triplets.
 * A view is a named point in that space — the ways people actually want to
 * look at an assembly — so the UI exposes one control with one concept while
 * the renderer keeps both axes.
 */
export const ASSEMBLY_VIEWS = ["build", "focus", "isolate", "full"] as const;

export type AssemblyView = (typeof ASSEMBLY_VIEWS)[number];

/**
 * The axis pair each named view stands for.
 *
 * Ordered by how much context they strip away: Build keeps everything already
 * there, Focus fades it, Isolate removes it, and Full is the other extreme.
 * Note the future side is hidden in the first three — an operator working a
 * step is never helped by parts that are not on the bench yet.
 */
export const VIEW_MODES: Record<
  AssemblyView,
  { installedMode: InstalledComponentsMode; futureMode: FutureComponentsMode }
> = {
  /** As it is on the bench right now: what is built is solid, the rest absent. */
  build: { installedMode: "solid", futureMode: "hidden" },
  /** This step, and where it mounts: what is built fades to a see-through shell. */
  focus: { installedMode: "ghost", futureMode: "hidden" },
  /** This step alone: nothing else is drawn at all. */
  isolate: { installedMode: "hidden", futureMode: "hidden" },
  /** The finished product: every component, solid. */
  full: { installedMode: "solid", futureMode: "solid" }
};

/**
 * The view standing for an axis pair, or "build" when the pair names no view.
 *
 * Only used to seat the initial view from the `default*Mode` props, which are
 * still axis-shaped: they predate the views and ERP passes them. An unnamed
 * pair falls back rather than widening `AssemblyView` with a "custom" member
 * no button could select.
 */
export function viewForModes(
  installedMode: InstalledComponentsMode,
  futureMode: FutureComponentsMode
): AssemblyView {
  return (
    ASSEMBLY_VIEWS.find(
      (view) =>
        VIEW_MODES[view].installedMode === installedMode &&
        VIEW_MODES[view].futureMode === futureMode
    ) ?? "build"
  );
}

/**
 * The visual state of a component for the active step. `stepIndex` is the
 * index of the first step that installs the component, or `undefined` when no
 * step ever installs it. Presence is cumulative: a component exists on the
 * canvas only once its step has run. A component no step installs is treated
 * exactly like a future-step component — it is never "already there".
 *
 * The two modes are independent axes over the same timeline: `futureMode`
 * governs what has not been built yet, `installedMode` what already has. Deep
 * into a build the installed parts can bury the ones the active step is
 * naming, so the operator can ghost or hide them. `installedMode` defaults to
 * "solid" — the historical behaviour — so three-argument callers are
 * unaffected. Neither mode ever touches the active step.
 */
export function visualForComponent(
  stepIndex: number | undefined,
  activeStepIndex: number,
  futureMode: FutureComponentsMode,
  installedMode: InstalledComponentsMode = "solid"
): ComponentVisual {
  if (stepIndex !== undefined) {
    if (stepIndex < activeStepIndex) {
      return installedMode === "ghost"
        ? "ghost"
        : installedMode === "hidden"
          ? "hidden"
          : "solid";
    }
    if (stepIndex === activeStepIndex) return "active";
  }
  return futureMode === "ghost"
    ? "ghost"
    : futureMode === "hidden"
      ? "hidden"
      : "solid";
}

/** A ghosted part is see-through, so it obstructs the view only slightly. */
export const GHOST_OCCLUDER_WEIGHT = 0.3;

/**
 * How much a component counts as an obstacle when the camera picks a view
 * direction. Mirrors `visualForComponent`: geometry the operator cannot see
 * must not push the camera around, or "hide installed" would clear the pixels
 * while the framing still dodged the parts that are no longer drawn.
 *
 * `null` means "not an occluder at all" (skip it); otherwise the weight the
 * AABB scorer should use. Ghosted parts still block the view a little, so they
 * keep a reduced weight rather than disappearing from the scoring entirely.
 */
export function occluderWeight(
  stepIndex: number | undefined,
  activeStepIndex: number,
  futureMode: FutureComponentsMode,
  installedMode: InstalledComponentsMode = "solid"
): number | null {
  // A component no step installs is never "already there" — it follows the
  // future side, exactly as `visualForComponent` treats it. (The previous
  // inline version required `stepIndex !== undefined`, so such a component
  // kept full occluder weight while rendering hidden, and the camera framed
  // around geometry it was not drawing.)
  const isFuture = stepIndex === undefined || stepIndex > activeStepIndex;
  const isInstalled = stepIndex !== undefined && stepIndex < activeStepIndex;
  if (isFuture && futureMode === "hidden") return null;
  if (isInstalled && installedMode === "hidden") return null;
  const isGhosted =
    (isFuture && futureMode === "ghost") ||
    (isInstalled && installedMode === "ghost");
  return isGhosted ? GHOST_OCCLUDER_WEIGHT : 1;
}
