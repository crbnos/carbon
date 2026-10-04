// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AssemblyPlaybackStep } from "@carbon/mes-core";
import { MODEL_NODE_INSTANCE_SEPARATOR } from "@carbon/mes-core";

/**
 * Which components of the model the operator should be looking at.
 *
 * The rule is the web player's, reduced to the part that needs no animation:
 * a step shows everything fitted so far — its own components and every
 * earlier step's — so the model builds up as the operator works down the
 * steps, and the part being fitted is on screen rather than buried.
 *
 * `hiddenComponentNodeIds` is the planner's explicit "take this out of the
 * way for this step" (a cover that would hide the work), so it is applied
 * last and only for the step being shown.
 *
 * Kept free of React and of Filament so the rules are tested as values. The
 * walk from a nodeId to the model's entities is the viewer's job, not this
 * file's: see `instanceNamesFor`.
 */

/** Every component id any step mentions — the set the screen may hide. */
export function mentionedNodeIds(steps: AssemblyPlaybackStep[]) {
  const ids = new Set<string>();
  for (const step of steps) {
    for (const id of step.componentNodeIds) ids.add(id);
    for (const id of step.hiddenComponentNodeIds) ids.add(id);
  }
  return ids;
}

/**
 * The component ids to SHOW at `activeStepIndex`.
 *
 * An index outside the steps is clamped rather than refused: the operator's
 * procedure step and the instruction's playback steps are two different
 * lists joined by `assemblyInstructionStepId`, so a procedure with more steps
 * than the instruction is ordinary, and the honest answer there is the fully
 * built model rather than an empty one.
 */
export function visibleNodeIds(
  steps: AssemblyPlaybackStep[],
  activeStepIndex: number
) {
  if (steps.length === 0) return new Set<string>();
  const last = Math.min(Math.max(activeStepIndex, 0), steps.length - 1);

  const visible = new Set<string>();
  for (let i = 0; i <= last; i++) {
    for (const id of steps[i].componentNodeIds) visible.add(id);
  }
  // Only the step on screen hides anything: an earlier step's cover is back on
  // by now, and a later step's has not come off yet.
  for (const id of steps[last].hiddenComponentNodeIds) visible.delete(id);
  return visible;
}

/**
 * The names one component id has in the served GLB, as an iterator: the id
 * itself, then `id#1`, `id#2`… The caller stops at the first name the model
 * does not contain, which is how it reaches every instance of a part placed
 * more than once without knowing in advance how many there are.
 *
 * Bounded so a lookup that always resolves cannot spin: the densest real case
 * is 48 identical spokes on a wheel.
 */
export const MAX_INSTANCES = 512;

export function* instanceNamesFor(nodeId: string) {
  yield nodeId;
  for (let i = 1; i < MAX_INSTANCES; i++) {
    yield `${nodeId}${MODEL_NODE_INSTANCE_SEPARATOR}${i}`;
  }
}
