// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AssemblyGraphIndex } from "./graph";
import type { AssemblyStep, Vec3 } from "./types";

/**
 * Sub-assembly staging: steps that point at a later JOIN step (`joinStepId`)
 * build their parts off to the side of the main model; the join step carries
 * the finished group in. Pure — no three.js — so it is unit-testable in node.
 *
 * Bad links (backwards, from the base step, nested, unknown id) are ignored
 * here rather than thrown: the ERP validates on write, and a stale row must
 * still play as "built in place".
 */

/** Seconds the staged group takes to glide from its staging spot to the insertion start. */
export const STAGING_GLIDE_SECONDS = 1.2;
/** Gap between the main model and a staging lane, and between lanes, as a fraction of the assembly diagonal. */
const STAGING_GAP_FRACTION = 0.25;

type StagingStep = Pick<
  AssemblyStep,
  "id" | "componentNodeIds" | "joinStepId"
> & { camera?: AssemblyStep["camera"] };

/** Unit target→eye direction of a saved camera, or null when the step auto-frames. */
function viewDirection(camera: StagingStep["camera"]): Vec3 | null {
  if (!camera) return null;
  const raw: Vec3 =
    "source" in camera
      ? camera.direction
      : [
          camera.position[0] - camera.target[0],
          camera.position[1] - camera.target[1],
          camera.position[2] - camera.target[2]
        ];
  const length = Math.hypot(raw[0], raw[1], raw[2]);
  return length > 1e-9
    ? [raw[0] / length, raw[1] / length, raw[2] / length]
    : null;
}

/**
 * The side a group is staged on: +X or +Z (never above/below — the viewer is
 * Y-up), whichever is most side-on to every saved view of the steps involved
 * so a fixed camera never looks straight along it; +X on a tie or with no
 * saved views. Auto-framed steps adapt on their own.
 */
function stagingAxis(views: Vec3[]): 0 | 2 {
  const along = (axis: 0 | 2) =>
    Math.max(0, ...views.map((view) => Math.abs(view[axis])));
  return along(2) < along(0) - 1e-6 ? 2 : 0;
}

export type StagingJoin = {
  joinIndex: number;
  /** Every node installed by this join's staged steps, in step order, deduped */
  nodeIds: string[];
  /** Pure world translation from seat to staging spot (along one side axis) */
  offset: Vec3;
};

export type Staging = {
  /** Keyed by join step index */
  joins: Map<number, StagingJoin>;
  /** Staged step index → its join step index */
  stagedToJoin: Map<number, number>;
};

export const EMPTY_STAGING: Staging = {
  joins: new Map(),
  stagedToJoin: new Map()
};

export type JoinTargets = {
  /** Ids of the steps this one may be built aside for, in order */
  targets: string[];
  /** Why the step can't be built aside at all: the base step, or a join step */
  locked: "base" | "join" | null;
};

/**
 * THE rule for sub-assembly links, shared by the ERP select, the ERP service
 * and playback: one level only — the base step and join steps build in place,
 * and a step joins a LATER step that isn't itself built aside.
 */
export function joinTargets(
  steps: Pick<AssemblyStep, "id" | "joinStepId">[],
  stepId: string
): JoinTargets {
  const index = steps.findIndex((step) => step.id === stepId);
  if (index === 0) return { targets: [], locked: "base" };
  if (steps.some((step) => step.joinStepId === stepId)) {
    return { targets: [], locked: "join" };
  }
  if (index < 0) return { targets: [], locked: null };
  return {
    targets: steps
      .slice(index + 1)
      .filter((step) => !step.joinStepId)
      .map((step) => step.id),
    locked: null
  };
}

/** Staged step index → join step index, for the links `joinTargets` allows. */
function validLinks(steps: StagingStep[]): Map<number, number> {
  const indexById = new Map(steps.map((step, index) => [step.id, index]));
  const links = new Map<number, number>();
  steps.forEach((step, index) => {
    const joinIndex = step.joinStepId
      ? indexById.get(step.joinStepId)
      : undefined;
    if (joinIndex === undefined) return;
    if (!joinTargets(steps, step.id).targets.includes(step.joinStepId ?? "")) {
      return;
    }
    links.set(index, joinIndex);
  });
  return links;
}

/** Ids of the parts a join step carries in: every componentNodeId of the steps pointing at it. */
export function stagedGroupNodeIds(
  steps: StagingStep[],
  joinStepId: string
): string[] {
  const joinIndex = steps.findIndex((step) => step.id === joinStepId);
  if (joinIndex < 0) return [];
  const nodeIds = new Set<string>();
  for (const [stagedIndex, target] of validLinks(steps)) {
    if (target !== joinIndex) continue;
    for (const nodeId of steps[stagedIndex]?.componentNodeIds ?? []) {
      nodeIds.add(nodeId);
    }
  }
  return [...nodeIds];
}

export function buildStaging(
  steps: StagingStep[],
  graphIndex: AssemblyGraphIndex | null
): Staging {
  if (!graphIndex) return EMPTY_STAGING;
  const links = validLinks(steps);
  if (links.size === 0) return EMPTY_STAGING;

  const groups = new Map<number, Set<string>>();
  for (const [stagedIndex, joinIndex] of [...links].sort(([a], [b]) => a - b)) {
    const group = groups.get(joinIndex) ?? new Set<string>();
    for (const nodeId of steps[stagedIndex]?.componentNodeIds ?? []) {
      group.add(nodeId);
    }
    groups.set(joinIndex, group);
  }

  const root = graphIndex.graph.root.bbox;
  const diagonal = Math.hypot(
    root.max[0] - root.min[0],
    root.max[1] - root.min[1],
    root.max[2] - root.min[2]
  );
  const gap = diagonal * STAGING_GAP_FRACTION;
  // One lane cursor per axis: the next free coordinate past the model along it.
  const cursors = new Map<0 | 2, number>();

  const joins = new Map<number, StagingJoin>();
  for (const joinIndex of [...groups.keys()].sort((a, b) => a - b)) {
    const nodeIds = [...(groups.get(joinIndex) ?? [])];
    const views: Vec3[] = [];
    for (const [stagedIndex, target] of links) {
      if (target !== joinIndex) continue;
      const view = viewDirection(steps[stagedIndex]?.camera);
      if (view) views.push(view);
    }
    const joinView = viewDirection(steps[joinIndex]?.camera);
    if (joinView) views.push(joinView);

    const axis = stagingAxis(views);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const nodeId of nodeIds) {
      const node = graphIndex.nodesById.get(nodeId);
      if (!node) continue;
      min = Math.min(min, node.bbox.min[axis]);
      max = Math.max(max, node.bbox.max[axis]);
    }
    // Nothing resolves (stale nodeIds after a re-upload): build in place.
    if (!Number.isFinite(min) || !Number.isFinite(max)) continue;

    const cursor = cursors.get(axis) ?? root.max[axis] + gap;
    const offset: Vec3 = [0, 0, 0];
    offset[axis] = cursor - min;
    joins.set(joinIndex, { joinIndex, nodeIds, offset });
    cursors.set(axis, cursor + (max - min) + gap);
  }

  const stagedToJoin = new Map<number, number>();
  for (const [stagedIndex, joinIndex] of links) {
    if (joins.has(joinIndex)) stagedToJoin.set(stagedIndex, joinIndex);
  }
  return { joins, stagedToJoin };
}

/** nodeId → offset for every node that sits at its staging spot while step `activeIndex` is shown. */
export function parkedOffsetsAt(
  staging: Staging,
  steps: Pick<AssemblyStep, "componentNodeIds">[],
  activeIndex: number
): Map<string, Vec3> {
  const parked = new Map<string, Vec3>();
  for (const [stagedIndex, joinIndex] of staging.stagedToJoin) {
    if (stagedIndex > activeIndex || activeIndex >= joinIndex) continue;
    const join = staging.joins.get(joinIndex);
    if (!join) continue;
    for (const nodeId of steps[stagedIndex]?.componentNodeIds ?? []) {
      parked.set(nodeId, join.offset);
    }
  }
  return parked;
}
