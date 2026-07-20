import { type AssemblyGraphIndex, groupComponentNodeIds } from "./graph";
import type { AssemblyStep, Fastener } from "./types";

/**
 * A named subassembly unit for title derivation: a set of leaf components that
 * assemble as one body and share a single step titled by `name` (e.g. an
 * authored "Board" or a purchased PCB), rather than enumerating every component.
 */
export type NamedUnit = { name: string; componentNodeIds: string[] };

/**
 * Display title for a step. An explicit title always wins. When the step's
 * components are exactly a named subassembly unit, the unit's name is used
 * ("Add Board") instead of listing every component inside it. Otherwise the title
 * is derived from the step's components and fastener, e.g.
 * "Add Seat Rail Clamp, M5 SHCS (×4)". Returns null when there is nothing to
 * derive from (no title, no known components, no fastener).
 */
export function describeStep(
  step: Pick<AssemblyStep, "title" | "componentNodeIds" | "fastener">,
  index: AssemblyGraphIndex | null,
  units?: NamedUnit[]
): string | null {
  if (step.title && step.title.trim().length > 0) return step.title;

  const fastenerSegment = describeFastener(step.fastener);

  // A step whose components are exactly a named subassembly is titled by that
  // subassembly's name, never by listing each of its (often hundreds of) components.
  const unit = units ? matchNamedUnit(step.componentNodeIds, units) : null;
  if (unit) {
    const segments = [unit.name];
    if (fastenerSegment) segments.push(fastenerSegment);
    return `Add ${segments.join(", ")}`;
  }

  const groups = index
    ? groupComponentNodeIds(step.componentNodeIds, index)
    : [];

  if (groups.length === 0 && !fastenerSegment) return null;

  const verb =
    groups.length === 0 ? "Install" : groups.length === 1 ? "Add" : "Assemble";

  const segments = groups.map((group) =>
    group.count > 1 ? `${group.name} (×${group.count})` : group.name
  );
  if (fastenerSegment) segments.push(fastenerSegment);

  return `${verb} ${segments.join(", ")}`;
}

/** "M5 SHCS (×4)" / "M5 SHCS", or null when the step has no fastener spec. */
function describeFastener(fastener: Fastener | null): string | null {
  const spec = fastener?.spec?.trim();
  if (!spec) return null;
  const count = fastener?.count;
  return count && count > 1 ? `${spec} (×${count})` : spec;
}

/** The named unit whose components set-equal the step's components, if any. */
function matchNamedUnit(
  componentNodeIds: string[],
  units: NamedUnit[]
): NamedUnit | null {
  if (componentNodeIds.length === 0) return null;
  const stepSet = new Set(componentNodeIds);
  for (const unit of units) {
    const unitSet = new Set(unit.componentNodeIds);
    if (unitSet.size === 0 || unitSet.size !== stepSet.size) continue;
    let equal = true;
    for (const nodeId of unitSet) {
      if (!stepSet.has(nodeId)) {
        equal = false;
        break;
      }
    }
    if (equal) return unit;
  }
  return null;
}
