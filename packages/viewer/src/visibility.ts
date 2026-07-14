/** How components of steps after the active one are rendered. */
export type FutureComponentsMode = "ghost" | "hidden" | "solid";

export type ComponentVisual = "solid" | "active" | "hidden" | "ghost";

/**
 * The visual state of a component for the active step. `stepIndex` is the
 * index of the first step that installs the component, or `undefined` when no
 * step ever installs it. Presence is cumulative: a component exists on the
 * canvas only once its step has run. A component no step installs is treated
 * exactly like a future-step component — it is never "already there".
 */
export function visualForComponent(
  stepIndex: number | undefined,
  activeStepIndex: number,
  futureMode: FutureComponentsMode
): ComponentVisual {
  if (stepIndex !== undefined) {
    if (stepIndex < activeStepIndex) return "solid";
    if (stepIndex === activeStepIndex) return "active";
  }
  return futureMode === "ghost"
    ? "ghost"
    : futureMode === "hidden"
      ? "hidden"
      : "solid";
}
