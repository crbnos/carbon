// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { synthesizeFallbackMotion } from "./fallback";
import type { AssemblyGraphIndex } from "./graph";
import type { AssemblyStep, Motion } from "./types";

/**
 * Display-only motion adjustments for playback. The stored plan is never
 * changed: these only decide how a step's motion is shown.
 */

/**
 * The motion a step should display. Flagged steps (the planner proved no
 * collision-free path exists) keep motion "none" — the player fades their
 * components in at the seated pose rather than animating a fabricated
 * fly-through. Other non-first steps stored with "none" (legacy plans,
 * manually authored steps) get the AABB fallback so components never pop into
 * place; the fallback's obstacle world is `presentNodeIds`, the components
 * already installed by EARLIER steps — later-step and never-installed
 * components are not on the canvas. When no collision-free fallback exists the
 * step keeps "none" and fades in. The first step is the base: placed, not
 * inserted.
 */
export function displayMotionForStep(
  step: Pick<AssemblyStep, "motion" | "componentNodeIds" | "flagged">,
  index: number,
  graphIndex: AssemblyGraphIndex | null,
  presentNodeIds: ReadonlySet<string>
): Motion {
  if (
    index === 0 ||
    step.flagged ||
    step.motion.type !== "none" ||
    step.componentNodeIds.length === 0 ||
    !graphIndex
  ) {
    return step.motion;
  }
  const fallback = synthesizeFallbackMotion(
    graphIndex,
    step.componentNodeIds,
    presentNodeIds
  );
  return fallback && fallback.type !== "none" ? fallback : step.motion;
}

/** Components smaller than this fraction of the assembly count as "small". */
const SMALL_COMPONENT_FRACTION = 0.15;
/** Small components travel at least this many times their own size. */
const SMALL_COMPONENT_TRAVEL_FACTOR = 2.5;
/** No component travels more than this many times its own size, +margin. */
const NATURAL_TRAVEL_FACTOR = 3;
/** Additive slack (mm) on the travel ceiling so a seat still fully clears. */
const NATURAL_TRAVEL_MARGIN_MM = 5;
/**
 * Hard ceiling as a fraction of the whole assembly. A big flat part (a gasket,
 * a lid) has a huge diagonal, so the per-part ceiling alone would let its
 * planner detour fly in from off-screen.
 */
const ASSEMBLY_TRAVEL_FRACTION = 0.35;

/**
 * Shapes a component's insertion travel into a natural band for playback so it
 * neither pops (too short) nor flies in from across the assembly (too long).
 * Safe because playback hides future-step parts and a part seats against the
 * already-placed parts around it, not along its short approach.
 */
export function naturalizeMotion(
  motion: Motion,
  componentDiagonal: number,
  assemblyDiagonal: number
): Motion {
  if (componentDiagonal <= 0 || assemblyDiagonal <= 0) return motion;

  const isSmall =
    componentDiagonal < assemblyDiagonal * SMALL_COMPONENT_FRACTION;
  const floor = isSmall ? componentDiagonal * SMALL_COMPONENT_TRAVEL_FACTOR : 0;
  // Per-part ceiling, then the assembly-wide cap; never below the floor so a
  // borderline-small part keeps its readable minimum travel.
  const ceiling = Math.max(
    floor,
    Math.min(
      componentDiagonal * NATURAL_TRAVEL_FACTOR + NATURAL_TRAVEL_MARGIN_MM,
      assemblyDiagonal * ASSEMBLY_TRAVEL_FRACTION
    )
  );
  const clamp = (t: number) => Math.min(Math.max(t, floor), ceiling);

  switch (motion.type) {
    case "linear": {
      const distance = clamp(motion.distance);
      return distance === motion.distance ? motion : { ...motion, distance };
    }
    case "L": {
      const total = motion.segments.reduce(
        (sum, segment) => sum + Math.abs(segment.distance),
        0
      );
      if (total <= 0) return motion;
      const target = clamp(total);
      if (target === total) return motion;
      const scale = target / total;
      return {
        ...motion,
        segments: motion.segments.map((segment) => ({
          ...segment,
          distance: segment.distance * scale
        }))
      };
    }
    default:
      return motion;
  }
}
