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
    for (const id of steps[i]?.componentNodeIds ?? []) visible.add(id);
  }
  // Only the step on screen hides anything: an earlier step's cover is back on
  // by now, and a later step's has not come off yet.
  for (const id of steps[last]?.hiddenComponentNodeIds ?? []) {
    visible.delete(id);
  }
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

/**
 * Which playback step goes with the procedure step on screen.
 *
 * The operator works down the job's own steps (`jobOperationStep`); the model
 * is animated against the instruction's steps. The two are different lists
 * joined by the `assemblyInstructionStepId` a step carries when it came from
 * an instruction — so the id is the join, and position is only a fallback for
 * a procedure step authored by hand, which carries no id.
 *
 * Returns 0 for an unmatched id rather than -1: showing the model at its
 * first step is a sane thing to look at, an empty viewer is not.
 */
export function playbackIndexFor(
  playbackSteps: AssemblyPlaybackStep[],
  instructionStepId: string | null | undefined,
  fallbackIndex: number
) {
  if (playbackSteps.length === 0) return 0;
  if (instructionStepId) {
    const found = playbackSteps.findIndex((s) => s.id === instructionStepId);
    if (found >= 0) return found;
  }
  return Math.min(Math.max(fallbackIndex, 0), playbackSteps.length - 1);
}

/**
 * One node of the assembler's `graph.json`: the product tree, by nodeId.
 */
export type AssemblyGraphNode = {
  nodeId: string;
  children?: AssemblyGraphNode[] | null;
};

/**
 * nodeId → that node and every node beneath it.
 *
 * **Why hiding needs this.** A step names what it installs by the nodeId of an
 * ASSEMBLY node — "the five cylinder barrels" is one id — and an assembly node
 * carries no geometry of its own; its descendants do. Filament renders one
 * entity per renderable, so removing the named entity removes nothing a person
 * can see, and the model stays whole however the steps are driven. Hiding a
 * component therefore means hiding its whole subtree, and the subtree is only
 * knowable from the graph.
 *
 * Cycles cannot occur in a product tree, but a malformed graph is still
 * guarded: a node already seen is not walked twice.
 */
export function buildSubtreeIndex(root: AssemblyGraphNode | null | undefined) {
  const index = new Map<string, string[]>();
  if (!root) return index;

  const collect = (node: AssemblyGraphNode, seen: Set<string>): string[] => {
    if (seen.has(node.nodeId)) return [];
    seen.add(node.nodeId);
    const ids = [node.nodeId];
    for (const child of node.children ?? []) ids.push(...collect(child, seen));
    index.set(node.nodeId, ids);
    return ids;
  };
  collect(root, new Set());
  return index;
}

/** The ids to hide for one component: its subtree, or just itself. */
export function hiddenIdsFor(nodeId: string, subtrees: Map<string, string[]>) {
  return subtrees.get(nodeId) ?? [nodeId];
}

/**
 * The components a LATER step installs — the ones to ghost.
 *
 * Deliberately not "everything not visible". A step's
 * `hiddenComponentNodeIds` are parts moved out of the way so the operator can
 * see the work (a cover, a cowling); they are already fitted and will be
 * fitted again, so showing them as a ghost would say the opposite of what is
 * true. Those simply disappear for the step, as they do on web. Only parts
 * genuinely still to come are ghosted.
 */
export function futureNodeIds(
  steps: AssemblyPlaybackStep[],
  activeStepIndex: number
) {
  const visible = visibleNodeIds(steps, activeStepIndex);
  const future = new Set<string>();
  for (let i = activeStepIndex + 1; i < steps.length; i++) {
    for (const id of steps[i]?.componentNodeIds ?? []) {
      if (!visible.has(id)) future.add(id);
    }
  }
  return future;
}
