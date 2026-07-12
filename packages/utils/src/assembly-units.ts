/**
 * Deriving the "units" a motion planner should treat as one rigid body from a
 * CAD assembly graph, its item BOM, geometry↔BOM mappings, an LLM component→BOM
 * assignment, and user overrides. Pure (no IO), so the planner worker, the
 * editor UI, and tests all share one implementation.
 *
 * The graph shape is declared structurally (only the fields used) so this file
 * has no dependency on the viewer/three rendering package — `@carbon/viewer`'s
 * `AssemblyGraph` is assignable to `UnitGraph`.
 *
 * CAD exports are frequently FLAT — every leaf sits at the root with no
 * subassembly nesting (a populated PCB's hundreds of R/C/IC solids are
 * top-level siblings of the enclosure and screws). So units are grouped by
 * which BOM line each leaf belongs to, not by tree position: the LLM assigns
 * each distinct component name to a BOM line (electronic components → the "PCB"
 * line), leaves group by assignment, and a line collapses into ONE rigid body
 * only when it's a qty-1 detail swarm — many TINY components relative to the
 * line's extent (a populated PCB) — never a mechanical subassembly of
 * substantial parts, and never the 8 screws (see `isDetailSwarm`).
 *
 * Assignments resolve to the TOP-LEVEL line: a leaf mapped (by geometry hash
 * or name) to an item that lives INSIDE a top-level Make subassembly's BOM —
 * the bare board and its connector inside the "PCB assembly" line — belongs
 * to that line's unit, via `lineByItem` (descendant itemId → top-level line
 * itemId). Without it the bare board escapes its own populated-PCB unit and
 * the planner installs the component swarm with nothing to mate to.
 */

/** Minimal structural view of a graph.json node. */
export type UnitGraphNode = {
  nodeId: string;
  name: string;
  isAssembly: boolean;
  geometryHash: string | null;
  /**
   * Axis-aligned world bbox (from graph.json). Used to tell a tiny-component
   * swarm (a populated PCB) from a mechanical subassembly of substantial parts —
   * geometryHash can't, because it's world-space, so a PCB's repeated footprints
   * at different board positions each hash distinctly (just like distinct parts).
   */
  bbox?: {
    min: [number, number, number];
    max: [number, number, number];
  } | null;
  children: UnitGraphNode[];
};

export type UnitGraph = { root: UnitGraphNode };

// --- Name similarity (shared with BOM auto-matching) ---------------------

/** Lowercase alphanumeric+dot tokens (drops punctuation/whitespace). */
export function tokenizeName(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9.]+/)
      .filter((token) => token.length > 0)
  );
}

/** Jaccard overlap of two names' token sets, 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const tokensA = tokenizeName(a);
  const tokensB = tokenizeName(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared++;
  return shared / (tokensA.size + tokensB.size - shared);
}

/** Threshold above which two names are treated as the same component. */
export const NAME_MATCH_THRESHOLD = 0.45;

// --- Leaf collection -----------------------------------------------------

/** A node the graph treats as a leaf instance (see indexAssemblyGraph). */
function isLeaf(node: UnitGraphNode): boolean {
  return !node.isAssembly && node.children.length === 0;
}

function collectLeaves(node: UnitGraphNode, out: UnitGraphNode[]): void {
  if (isLeaf(node)) {
    out.push(node);
    return;
  }
  for (const child of node.children) collectLeaves(child, out);
}

/** Every leaf in the graph, depth-first. */
export function collectLeafNodes(graph: UnitGraph): UnitGraphNode[] {
  const leaves: UnitGraphNode[] = [];
  collectLeaves(graph.root, leaves);
  return leaves;
}

/**
 * Distinct leaf component names with their instance counts — the input to the
 * LLM BOM-assignment prompt (semantic matching happens on the name).
 */
export function distinctComponentNames(
  graph: UnitGraph
): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const leaf of collectLeafNodes(graph)) {
    counts.set(leaf.name, (counts.get(leaf.name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }));
}

// --- Unit derivation -----------------------------------------------------

// A BOM line collapses into one rigid unit only when its leaves form a "detail
// swarm" — a populated PCB is many TINY components on a board, whereas a
// mechanical subassembly is a handful of SUBSTANTIAL parts. Size (not
// geometry-hash count) is what separates them: measure each leaf's bbox against
// the line's own extent (not the whole assembly — that would misfire as part
// count grows). Collapse when the line has many leaves and most are tiny.
/** A leaf is "tiny" when its bbox diagonal is below this fraction of the line's. */
const SWARM_TINY_FRACTION = 0.1;
/** Collapse only when at least this share of the line's leaves are tiny. */
const SWARM_LEAF_FRACTION = 0.7;
/** ...and the line has at least this many leaves (a couple of parts isn't a swarm). */
const SWARM_MIN_LEAVES = 8;

/** Diagonal of a node's world bbox, or null when absent. */
function bboxDiagonal(node: UnitGraphNode): number | null {
  const b = node.bbox;
  if (!b) return null;
  const dx = b.max[0] - b.min[0];
  const dy = b.max[1] - b.min[1];
  const dz = b.max[2] - b.min[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Diagonal of the union bbox of a set of leaves (their collective extent). */
function unionDiagonal(leaves: UnitGraphNode[]): number | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let any = false;
  for (const l of leaves) {
    const b = l.bbox;
    if (!b) continue;
    any = true;
    minX = Math.min(minX, b.min[0]);
    minY = Math.min(minY, b.min[1]);
    minZ = Math.min(minZ, b.min[2]);
    maxX = Math.max(maxX, b.max[0]);
    maxY = Math.max(maxY, b.max[1]);
    maxZ = Math.max(maxZ, b.max[2]);
  }
  if (!any) return null;
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Whether a BOM line's leaves are a detail swarm (a populated PCB) rather than a
 * mechanical subassembly — enough leaves, most of them tiny relative to the
 * line's own extent. No bbox data → false (don't merge distinct parts blindly).
 */
function isDetailSwarm(leaves: UnitGraphNode[]): boolean {
  if (leaves.length < SWARM_MIN_LEAVES) return false;
  const lineDiag = unionDiagonal(leaves);
  if (lineDiag == null || lineDiag === 0) return false;
  const threshold = SWARM_TINY_FRACTION * lineDiag;
  const tiny = leaves.filter((l) => {
    const d = bboxDiagonal(l);
    return d != null && d < threshold;
  }).length;
  return tiny / leaves.length >= SWARM_LEAF_FRACTION;
}

/**
 * A planned unit: the set of leaf components the planner should treat as one rigid
 * body (and that becomes one assembly step). A purchased PCB whose CAD model
 * carries hundreds of tiny child solids collapses to a single unit.
 */
export type AssemblyUnit = {
  /** Stable id: a collapsed unit uses `unit:<itemId>`; a lone leaf its nodeId. */
  id: string;
  name: string;
  /** Member LEAF nodeIds — what the planner merges and the step installs. */
  nodeIds: string[];
  /** BOM item this unit maps to, when resolvable. */
  itemId?: string;
  source: "authored" | "bom" | "loose";
};

type BomMaterial = { itemId: string; name: string | null; quantity?: number };
type ComponentMapping = { geometryHash: string; itemId: string };
type AuthoredUnit = { id: string; componentNodeIds: string[]; name?: string };
/** Component name → BOM itemId, as decided by the LLM assigner. */
type ComponentMatch = { name: string; itemId: string };

/**
 * Derives the planned units for a model.
 *
 * Precedence:
 *  1. Authored units are explicit overrides.
 *  2. Each remaining leaf is assigned a BOM item — geometry↔BOM mapping first
 *     (exact), then the LLM component-name assignment.
 *  3. Leaves group by assigned item. A group collapses into one rigid unit only
 *     when the BOM quantity is ≤ 1 and it has ≥ 2 leaves (a single subassembly
 *     shown in full detail — the PCB). Otherwise each leaf stays its own component
 *     (8 screws remain 8 bodies; the viewer still groups identical ones into a
 *     step). Unassigned leaves are loose units.
 */
export function deriveAssemblyUnits(args: {
  graph: UnitGraph;
  bomMaterials: BomMaterial[];
  componentMappings: ComponentMapping[];
  authoredUnits: AuthoredUnit[];
  /** Component name → itemId assignments from the LLM (optional). */
  componentMatches?: ComponentMatch[];
  /**
   * Descendant BOM itemId → the top-level BOM line it belongs to (items
   * nested inside a line's Make-subassembly BOM). Lets a leaf mapped to the
   * bare board join the populated-PCB line's unit.
   */
  lineByItem?: Record<string, string>;
}): AssemblyUnit[] {
  const {
    graph,
    bomMaterials,
    componentMappings,
    authoredUnits,
    componentMatches = [],
    lineByItem = {}
  } = args;

  const bomByItem = new Map(bomMaterials.map((m) => [m.itemId, m]));
  const itemByHash = new Map(
    componentMappings.map((m) => [m.geometryHash, m.itemId])
  );
  const itemByName = new Map(componentMatches.map((m) => [m.name, m.itemId]));

  const units: AssemblyUnit[] = [];
  const claimed = new Set<string>();

  // 1. Authored overrides win; their leaves leave the automatic pass.
  for (const authored of authoredUnits) {
    const nodeIds = authored.componentNodeIds.filter((id) => !claimed.has(id));
    if (nodeIds.length === 0) continue;
    for (const id of nodeIds) claimed.add(id);
    const itemId = soleItem(nodeIds, graph, itemByHash, itemByName);
    units.push({
      id: authored.id,
      name: authored.name ?? bomName(itemId, bomByItem) ?? "Subassembly",
      nodeIds,
      itemId,
      source: "authored"
    });
  }

  // 2. Assign each remaining leaf a BOM item (mapping first, then LLM),
  // then resolve nested-subassembly items up to their top-level line.
  const byItem = new Map<string, UnitGraphNode[]>();
  const loose: UnitGraphNode[] = [];
  for (const leaf of collectLeafNodes(graph)) {
    if (claimed.has(leaf.nodeId)) continue;
    const assigned =
      (leaf.geometryHash ? itemByHash.get(leaf.geometryHash) : undefined) ??
      itemByName.get(leaf.name);
    const itemId = assigned ? (lineByItem[assigned] ?? assigned) : undefined;
    if (itemId) {
      const group = byItem.get(itemId) ?? [];
      group.push(leaf);
      byItem.set(itemId, group);
    } else {
      loose.push(leaf);
    }
  }

  // 3. Emit units per BOM group.
  for (const [itemId, leaves] of byItem) {
    const quantity = bomByItem.get(itemId)?.quantity ?? 1;
    const name = bomName(itemId, bomByItem);
    // Collapse only a detail swarm (a populated PCB — many tiny components on a
    // board) into one rigid body. A mechanical subassembly of substantial parts
    // stays separate, or it becomes one N-part fade-in step. Size decides this,
    // not geometry-hash count (world-space hashes make a PCB's repeated parts
    // look as distinct as a subassembly's).
    if (leaves.length >= 2 && quantity <= 1 && isDetailSwarm(leaves)) {
      // A single physical subassembly shown in full detail → one rigid body.
      units.push({
        id: `unit:${itemId}`,
        name: name ?? leaves[0]!.name,
        nodeIds: leaves.map((l) => l.nodeId),
        itemId,
        source: "bom"
      });
    } else {
      // Multiple instances (or a lone component) → keep each leaf separate.
      for (const leaf of leaves) {
        units.push({
          id: leaf.nodeId,
          name: name ?? leaf.name,
          nodeIds: [leaf.nodeId],
          itemId,
          source: "bom"
        });
      }
    }
  }

  // Unassigned leaves are loose units.
  for (const leaf of loose) {
    units.push({
      id: leaf.nodeId,
      name: leaf.name,
      nodeIds: [leaf.nodeId],
      source: "loose"
    });
  }

  return units;
}

/** The single BOM item a set of leaf nodeIds resolves to, if unambiguous. */
function soleItem(
  nodeIds: string[],
  graph: UnitGraph,
  itemByHash: Map<string, string>,
  itemByName: Map<string, string>
): string | undefined {
  const byNode = new Map<string, UnitGraphNode>();
  const index = (node: UnitGraphNode): void => {
    byNode.set(node.nodeId, node);
    for (const child of node.children) index(child);
  };
  index(graph.root);
  const items = new Set<string>();
  for (const nodeId of nodeIds) {
    const node = byNode.get(nodeId);
    if (!node) continue;
    const itemId =
      (node.geometryHash ? itemByHash.get(node.geometryHash) : undefined) ??
      itemByName.get(node.name);
    if (itemId) items.add(itemId);
  }
  return items.size === 1 ? [...items][0] : undefined;
}

function bomName(
  itemId: string | undefined,
  bomByItem: Map<string, BomMaterial>
): string | undefined {
  if (!itemId) return undefined;
  return bomByItem.get(itemId)?.name ?? undefined;
}
