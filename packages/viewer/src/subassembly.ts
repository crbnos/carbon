// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Sub-assemblies: pure structure over an instruction's steps. No three.js.
 *
 * Steps arrive in PLAY order (`sortOrder`). A sub-assembly is a header step
 * (`isSubAssembly`) plus the steps whose `parentStepId` is the header; those
 * steps sit directly before their header. A header's `usedInStepId` names the
 * later step that fits the finished unit; without one, the header itself is
 * where the unit joins the main build.
 *
 * Shared by the player (numbering, isolation, carry-in), the ERP editor
 * (step list, which actions to offer) and the ERP service (write validation),
 * so all three answer the same question the same way.
 */
import type { AssemblyStep } from "./types";

type StructureStep = Pick<
  AssemblyStep,
  "id" | "componentNodeIds" | "parentStepId" | "usedInStepId" | "isSubAssembly"
>;

export type SubAssemblyInfo = {
  stepId: string;
  /** Members: their header. Headers: themselves. Main-build steps: null. */
  headerId: string | null;
  isHeader: boolean;
  /** "1", "4.2": top level counts headers and main-build steps in display order. */
  number: string;
  /** False only for a header something uses: that unit joins at the using step. */
  plays: boolean;
  /** Members: every part of their sub-assembly (shown on its own). Otherwise null. */
  isolatePartIds: string[] | null;
  /** Headers whose finished parts arrive at this step. */
  carriesIn: string[];
};

export const isSubAssemblyHeader = (
  step: Pick<AssemblyStep, "isSubAssembly">
) => step.isSubAssembly === true;

function membersOf(steps: StructureStep[], headerId: string) {
  return steps.filter((step) => step.parentStepId === headerId);
}

/**
 * Every part a sub-assembly contains: what its steps install, plus the parts of
 * every sub-assembly those steps use (a gear train used inside a heel module).
 */
export function subAssemblyPartIds(
  steps: StructureStep[],
  headerId: string,
  seen: Set<string> = new Set()
): string[] {
  if (seen.has(headerId)) return [];
  seen.add(headerId);
  const parts = new Set<string>();
  for (const member of membersOf(steps, headerId)) {
    for (const id of member.componentNodeIds) parts.add(id);
    for (const used of steps) {
      if (isSubAssemblyHeader(used) && used.usedInStepId === member.id) {
        for (const id of subAssemblyPartIds(steps, used.id, seen))
          parts.add(id);
      }
    }
  }
  return [...parts];
}

/**
 * The build a step happens in: its sub-assembly's header id, or `null` for the
 * main build. Headers themselves are main-build steps (an unused one is where
 * its unit joins the main build).
 */
export function worldOf(steps: StructureStep[], stepId: string): string | null {
  const step = steps.find((s) => s.id === stepId);
  if (!step?.parentStepId || isSubAssemblyHeader(step)) return null;
  const header = steps.find((s) => s.id === step.parentStepId);
  return header && isSubAssemblyHeader(header) ? header.id : null;
}

/**
 * When each part shows up in a given build (`world`): a part installed there
 * appears at its own step; a finished sub-assembly's parts appear at the step
 * that carries the unit into that build (following uses outward, so a gear
 * train used in a heel module reaches the main build when the heel module
 * does). Parts that never reach `world` are absent from the map.
 */
export function arrivalIndexByNode(
  steps: StructureStep[],
  world: string | null
): Map<string, number> {
  const indexById = new Map(steps.map((step, index) => [step.id, index]));
  const byId = new Map(steps.map((step) => [step.id, step]));
  const worlds = new Map(
    steps.map((step) => [step.id, worldOf(steps, step.id)])
  );
  const arrival = new Map<string, number>();

  steps.forEach((installer) => {
    if (installer.componentNodeIds.length === 0) return;
    let current: StructureStep | undefined = installer;
    for (let hops = 0; current && hops <= steps.length; hops++) {
      const here: string | null = worlds.get(current.id) ?? null;
      if (here === world) {
        const index = indexById.get(current.id)!;
        for (const nodeId of installer.componentNodeIds) {
          if (!arrival.has(nodeId)) arrival.set(nodeId, index);
        }
        return;
      }
      // Already in the main build and still not in `world`: it never gets there.
      if (here === null) return;
      const header = byId.get(here);
      if (!header) return;
      current = header.usedInStepId ? byId.get(header.usedInStepId) : header;
    }
  });
  return arrival;
}

/**
 * The step list's rows: each header directly above its members (members are
 * stored before it), everything else in play order.
 */
export function displayOrder(
  steps: StructureStep[]
): { stepId: string; depth: 0 | 1 }[] {
  const rows: { stepId: string; depth: 0 | 1 }[] = [];
  const emitted = new Set<string>();
  const byId = new Map(steps.map((step) => [step.id, step]));
  for (const step of steps) {
    if (emitted.has(step.id)) continue;
    const parent = step.parentStepId ? byId.get(step.parentStepId) : undefined;
    const header = isSubAssemblyHeader(step) ? step : parent;
    if (header && isSubAssemblyHeader(header) && !emitted.has(header.id)) {
      rows.push({ stepId: header.id, depth: 0 });
      emitted.add(header.id);
      for (const member of membersOf(steps, header.id)) {
        rows.push({ stepId: member.id, depth: 1 });
        emitted.add(member.id);
      }
      continue;
    }
    rows.push({ stepId: step.id, depth: 0 });
    emitted.add(step.id);
  }
  return rows;
}

export function buildSubAssemblyPlan(
  steps: StructureStep[]
): Map<string, SubAssemblyInfo> {
  const plan = new Map<string, SubAssemblyInfo>();
  const byId = new Map(steps.map((step) => [step.id, step]));
  const partsByHeader = new Map<string, string[]>();
  const partsOf = (headerId: string) => {
    let parts = partsByHeader.get(headerId);
    if (!parts) {
      parts = subAssemblyPartIds(steps, headerId);
      partsByHeader.set(headerId, parts);
    }
    return parts;
  };

  let top = 0;
  let child = 0;
  for (const { stepId, depth } of displayOrder(steps)) {
    const step = byId.get(stepId)!;
    const isHeader = isSubAssemblyHeader(step);
    if (depth === 0) {
      top += 1;
      child = 0;
    } else {
      child += 1;
    }
    const headerId = isHeader
      ? step.id
      : depth === 1
        ? (step.parentStepId ?? null)
        : null;
    const carriesIn = steps
      .filter((s) => isSubAssemblyHeader(s) && s.usedInStepId === step.id)
      .map((s) => s.id);
    if (isHeader && !step.usedInStepId) carriesIn.push(step.id);

    plan.set(step.id, {
      stepId: step.id,
      headerId,
      isHeader,
      number: depth === 0 ? String(top) : `${top}.${child}`,
      plays: !(isHeader && step.usedInStepId),
      isolatePartIds: depth === 1 && headerId ? partsOf(headerId) : null,
      carriesIn
    });
  }
  return plan;
}

export type SubAssemblyRule = 1 | 2 | 3;

export type SubAssemblyViolation = {
  stepId: string;
  rule: SubAssemblyRule;
  message: string;
};

/**
 * The structural rules, checked on every write:
 * 1. a sub-assembly's steps sit directly before its header;
 * 2. no nesting: only headers have members, and headers are never members;
 * 3. a header is used by a later, ordinary step that is not one of its own.
 */
export function validateSubAssemblies(
  steps: StructureStep[]
): SubAssemblyViolation[] {
  const violations: SubAssemblyViolation[] = [];
  const indexById = new Map(steps.map((step, index) => [step.id, index]));
  const byId = new Map(steps.map((step) => [step.id, step]));

  steps.forEach((step, index) => {
    if (step.parentStepId) {
      const header = byId.get(step.parentStepId);
      if (!header || !isSubAssemblyHeader(header)) {
        violations.push({
          stepId: step.id,
          rule: 2,
          message: "A step can only belong to a sub-assembly"
        });
      } else if (isSubAssemblyHeader(step)) {
        violations.push({
          stepId: step.id,
          rule: 2,
          message: "A sub-assembly can't be inside another sub-assembly"
        });
      }
    }

    if (!isSubAssemblyHeader(step)) {
      if (step.usedInStepId) {
        violations.push({
          stepId: step.id,
          rule: 3,
          message: "Only a sub-assembly can be used in a step"
        });
      }
      return;
    }

    const members = membersOf(steps, step.id);
    const contiguous = members.every(
      (member, i) => indexById.get(member.id) === index - members.length + i
    );
    if (!contiguous) {
      violations.push({
        stepId: step.id,
        rule: 1,
        message: "A sub-assembly's steps must come directly before it"
      });
    }

    if (step.usedInStepId) {
      const target = byId.get(step.usedInStepId);
      const targetIndex = indexById.get(step.usedInStepId);
      if (!target || targetIndex === undefined) {
        violations.push({
          stepId: step.id,
          rule: 3,
          message: "The step using this sub-assembly doesn't exist"
        });
      } else if (isSubAssemblyHeader(target)) {
        violations.push({
          stepId: step.id,
          rule: 3,
          message:
            "A sub-assembly is used in a step, not in another sub-assembly"
        });
      } else if (target.parentStepId === step.id) {
        violations.push({
          stepId: step.id,
          rule: 3,
          message: "A sub-assembly can't be used by one of its own steps"
        });
      } else if (targetIndex < index) {
        violations.push({
          stepId: step.id,
          rule: 3,
          message: "A sub-assembly can only be used after it is built"
        });
      }
    }
  });

  return violations;
}

export type UnusableReason = "header" | "own" | "before";

/** The sub-assemblies a step could use, with why each one can't be. */
export function usableSubAssemblies(
  steps: StructureStep[],
  stepId: string
): { headerId: string; reason: UnusableReason | null }[] {
  const index = steps.findIndex((step) => step.id === stepId);
  const step = steps[index];
  if (!step) return [];
  return steps
    .map((header, headerIndex) => ({ header, headerIndex }))
    .filter(({ header }) => isSubAssemblyHeader(header))
    .map(({ header, headerIndex }) => ({
      headerId: header.id,
      reason: isSubAssemblyHeader(step)
        ? "header"
        : step.parentStepId === header.id
          ? "own"
          : index < headerIndex
            ? "before"
            : null
    }));
}
