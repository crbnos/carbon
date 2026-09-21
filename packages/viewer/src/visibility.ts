/** How components of steps after the active one are rendered. */
export type FutureComponentsMode = "ghost" | "hidden" | "solid";

/** How components of steps BEFORE the active one are rendered. */
export type InstalledComponentsMode = "ghost" | "hidden" | "solid";

export type ComponentVisual = "solid" | "active" | "hidden" | "ghost";

/**
 * The named views the toolbar offers, in presentation order.
 *
 * The two modes are independent axes: the right model for the renderer, the
 * wrong one for the screen (nine combinations, most meaningless). A view is a
 * named point in that space, so the UI keeps one concept and the renderer both.
 */
export const ASSEMBLY_VIEWS = ["build", "focus", "isolate", "full"] as const;

export type AssemblyView = (typeof ASSEMBLY_VIEWS)[number];

/**
 * Ordered by how much context they strip: Build keeps what is already there,
 * Focus fades it, Isolate removes it, Full is the other extreme. The future
 * side is hidden in all but Full: parts not yet on the bench only add clutter.
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
 * The view for an axis pair, or "build" when the pair names none. Seats the
 * initial view from the still-axis-shaped `default*Mode` props; an unnamed pair
 * falls back rather than adding a "custom" member no button could select.
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
 * `installedMode` defaults to "solid", so three-argument callers are
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
