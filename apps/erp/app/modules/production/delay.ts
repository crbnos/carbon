import { parseDate } from "@internationalized/date";

export type DelayKind =
  | "supply"
  | "outside"
  | "quality"
  | "operation"
  | "job"
  | "salesLine";

export type DelayClass =
  | "late_supply"
  | "outside_processing"
  | "quality_hold"
  | "ran_long"
  | "started_late"
  | "completed_late"
  | "shipped_late";

export type DelayNode = {
  id: string;
  kind: DelayKind;
  /** Planned finish, YYYY-MM-DD. */
  planned: string | null;
  /**
   * When this node needs its predecessors done. Defaults to `planned`.
   * An operation needs them at its start; a job or sales line needs them
   * by its own finish.
   */
  plannedStart?: string | null;
  /** Actual or projected finish, YYYY-MM-DD. */
  actual: string | null;
  /** Calendar days the operation's own run exceeded its planned span. */
  ranLongDays?: number;
  open?: boolean;
  label?: string;
  href?: string;
};

export type DelayLink = {
  from: string;
  to: string;
  recorded: boolean;
};

export type DelayStep = {
  kind: DelayKind;
  recorded: boolean;
  label?: string;
  href?: string;
};

export type DelayFinding = {
  class: DelayClass;
  days: number;
  steps: DelayStep[];
};

export type DelayAbsorbed = {
  class: DelayClass;
  days: number;
  label?: string;
  href?: string;
};

export type DelayGap = {
  days: number;
  recorded: boolean;
  from: Omit<DelayStep, "recorded">;
  to: Omit<DelayStep, "recorded">;
};

export type DelayReport = {
  label?: string;
  href?: string;
  lateDays: number;
  causes: DelayFinding[];
  impacts: DelayFinding[];
  absorbed: DelayAbsorbed[];
  gaps: DelayGap[];
};

export type DelayResult =
  | { reports: DelayReport[] }
  | { reports: []; cycle: { from: DelayStep; to: DelayStep } };

const CLASS_OF: Record<Exclude<DelayKind, "operation">, DelayClass> = {
  supply: "late_supply",
  outside: "outside_processing",
  quality: "quality_hold",
  job: "completed_late",
  salesLine: "shipped_late"
};

export const delayModule: Record<DelayKind, string> = {
  supply: "purchasing",
  outside: "purchasing",
  quality: "quality",
  operation: "production",
  job: "production",
  salesLine: "sales"
};

type Edge = {
  from: string;
  slack: number;
  gap: number;
  recorded: boolean;
};

type Piece = { id: string; class: DelayClass; days: number };

function daySpan(later: string, earlier: string): number {
  return parseDate(later).compare(parseDate(earlier));
}

export function calendarDays(later: string, earlier: string): number {
  return daySpan(later, earlier);
}

function ref(node: DelayNode): Omit<DelayStep, "recorded"> {
  return { kind: node.kind, label: node.label, href: node.href };
}

function step(node: DelayNode, recorded: boolean): DelayStep {
  return { ...ref(node), recorded };
}

/**
 * A predecessor only delays the successor by the days it is late past the
 * gap between its planned finish and the day the successor needs it. A
 * purchase order three days late for material not needed for five does not
 * move the job. A successor planned before its predecessor is a separate
 * gap, not extra lateness on the predecessor.
 */
function edgeBetween(from: DelayNode, to: DelayNode, recorded: boolean): Edge {
  const predFinish = from.planned;
  const need = to.plannedStart ?? to.planned;
  if (!predFinish || !need) {
    return { from: from.id, slack: 0, gap: 0, recorded };
  }
  const raw = daySpan(need, predFinish);
  if (raw >= 0) return { from: from.id, slack: raw, gap: 0, recorded };
  return { from: from.id, slack: 0, gap: -raw, recorded };
}

function observed(node: DelayNode): number {
  if (!node.planned || !node.actual) return 0;
  return Math.max(0, daySpan(node.actual, node.planned));
}

function piecesOf(node: DelayNode, own: number): Piece[] {
  if (own <= 0) return [];
  if (node.kind === "operation") {
    const ran = Math.min(own, Math.max(0, node.ranLongDays ?? 0));
    const started = own - ran;
    const out: Piece[] = [];
    if (ran > 0) out.push({ id: node.id, class: "ran_long", days: ran });
    if (started > 0)
      out.push({ id: node.id, class: "started_late", days: started });
    return out;
  }
  return [{ id: node.id, class: CLASS_OF[node.kind], days: own }];
}

function classifyObserved(node: DelayNode, days: number): DelayClass {
  if (node.kind !== "operation") return CLASS_OF[node.kind];
  return days > 0 && (node.ranLongDays ?? 0) >= days
    ? "ran_long"
    : "started_late";
}

export function analyzeDelay(
  input:
    | {
        nodes: DelayNode[];
        links: DelayLink[];
        mode: "why";
        targetId: string;
      }
    | {
        nodes: DelayNode[];
        links: DelayLink[];
        mode: "affects";
        sourceId: string;
      }
): DelayResult {
  const nodes = new Map<string, DelayNode>();
  for (const node of input.nodes) nodes.set(node.id, node);

  const preds = new Map<string, Edge[]>();
  for (const id of nodes.keys()) preds.set(id, []);
  for (const link of input.links) {
    if (link.from === link.to) continue;
    const from = nodes.get(link.from);
    const to = nodes.get(link.to);
    if (!from || !to) continue;
    const list = preds.get(to.id)!;
    const edge = edgeBetween(from, to, link.recorded);
    const existing = list.findIndex((item) => item.from === from.id);
    if (existing === -1) list.push(edge);
    else if (link.recorded) list[existing] = edge;
  }

  const order = topo([...nodes.keys()], preds);
  if ("cycle" in order) {
    const from = nodes.get(order.cycle.from);
    const to = nodes.get(order.cycle.to);
    if (!from || !to) return { reports: [] };
    return {
      reports: [],
      cycle: { from: step(from, true), to: step(to, true) }
    };
  }

  const late = new Map<string, number>();
  for (const node of nodes.values()) late.set(node.id, observed(node));

  const own = new Map<string, number>();
  for (const id of order) {
    let inherited = 0;
    for (const edge of preds.get(id) ?? []) {
      const predLate = late.get(edge.from) ?? 0;
      inherited = Math.max(
        inherited,
        Math.max(0, predLate - edge.slack) + edge.gap
      );
    }
    own.set(id, Math.max(0, (late.get(id) ?? 0) - inherited));
  }

  const anchorId = input.mode === "why" ? input.targetId : input.sourceId;
  const anchor = nodes.get(anchorId);
  if (!anchor) {
    return { reports: [emptyReport()] };
  }

  if (input.mode === "why") {
    return {
      reports: [whyReport(anchor, nodes, preds, order, late, own)]
    };
  }
  return {
    reports: [affectsReport(anchor, nodes, preds, order, late, own)]
  };
}

function emptyReport(): DelayReport {
  return { lateDays: 0, causes: [], impacts: [], absorbed: [], gaps: [] };
}

function ancestorsOf(id: string, preds: Map<string, Edge[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const edge of preds.get(current) ?? []) stack.push(edge.from);
  }
  return seen;
}

function descendantsOf(id: string, preds: Map<string, Edge[]>): Set<string> {
  const succs = new Map<string, string[]>();
  for (const [to, edges] of preds) {
    for (const edge of edges) {
      const list = succs.get(edge.from) ?? [];
      list.push(to);
      succs.set(edge.from, list);
    }
  }
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of succs.get(current) ?? []) stack.push(next);
  }
  return seen;
}

function arrival(
  order: string[],
  ownDays: Map<string, number>,
  preds: Map<string, Edge[]>,
  targetId: string
): number {
  const comp = new Map<string, number>();
  for (const id of order) {
    let incoming = 0;
    for (const edge of preds.get(id) ?? []) {
      const pred = comp.get(edge.from) ?? 0;
      incoming = Math.max(incoming, Math.max(0, pred - edge.slack));
    }
    comp.set(id, (ownDays.get(id) ?? 0) + incoming);
  }
  return comp.get(targetId) ?? 0;
}

function chainOf(
  piece: Piece,
  targetId: string,
  order: string[],
  nodes: Map<string, DelayNode>,
  preds: Map<string, Edge[]>
): DelayStep[] {
  const reach = new Map<string, number>([[piece.id, piece.days]]);
  const via = new Map<string, string>();
  for (const id of order) {
    let best = 0;
    let from: string | undefined;
    for (const edge of preds.get(id) ?? []) {
      const prev = reach.get(edge.from);
      if (prev == null) continue;
      const arrived = Math.max(0, prev - edge.slack);
      if (arrived > best) {
        best = arrived;
        from = edge.from;
      }
    }
    if (from && best > 0) {
      reach.set(id, best);
      via.set(id, from);
    }
  }

  const ids = [targetId];
  const guard = new Set<string>([targetId]);
  let current = targetId;
  while (current !== piece.id) {
    const prev = via.get(current);
    if (!prev || guard.has(prev)) {
      const cause = nodes.get(piece.id);
      const target = nodes.get(targetId);
      return [
        ...(cause ? [step(cause, true)] : []),
        ...(target && target.id !== piece.id ? [step(target, true)] : [])
      ];
    }
    guard.add(prev);
    ids.push(prev);
    current = prev;
  }
  ids.reverse();

  return ids.flatMap((id, index) => {
    const node = nodes.get(id);
    if (!node) return [];
    if (index === 0) return [step(node, true)];
    const edge = (preds.get(id) ?? []).find(
      (item) => item.from === ids[index - 1]
    );
    return [step(node, edge?.recorded ?? true)];
  });
}

function gapsOn(
  ids: Set<string>,
  nodes: Map<string, DelayNode>,
  preds: Map<string, Edge[]>,
  fromIds?: Set<string>
): DelayGap[] {
  const gaps: DelayGap[] = [];
  for (const [toId, edges] of preds) {
    if (!ids.has(toId)) continue;
    const to = nodes.get(toId);
    if (!to) continue;
    for (const edge of edges) {
      if (edge.gap <= 0 || !ids.has(edge.from)) continue;
      if (fromIds && !fromIds.has(edge.from)) continue;
      const from = nodes.get(edge.from);
      if (!from) continue;
      gaps.push({
        days: edge.gap,
        recorded: edge.recorded,
        from: ref(from),
        to: ref(to)
      });
    }
  }
  gaps.sort(
    (a, b) =>
      b.days - a.days || (a.from.label ?? "").localeCompare(b.from.label ?? "")
  );
  return gaps;
}

function whyReport(
  target: DelayNode,
  nodes: Map<string, DelayNode>,
  preds: Map<string, Edge[]>,
  order: string[],
  late: Map<string, number>,
  own: Map<string, number>
): DelayReport {
  const ancestors = ancestorsOf(target.id, preds);
  const targetLate = late.get(target.id) ?? 0;
  const causes: DelayFinding[] = [];
  const absorbed: DelayAbsorbed[] = [];

  for (const id of order) {
    if (!ancestors.has(id)) continue;
    const node = nodes.get(id);
    if (!node) continue;
    for (const piece of piecesOf(node, own.get(id) ?? 0)) {
      const only = new Map<string, number>([[piece.id, piece.days]]);
      const days = Math.min(arrival(order, only, preds, target.id), targetLate);
      if (days > 0) {
        causes.push({
          class: piece.class,
          days,
          steps: chainOf(piece, target.id, order, nodes, preds)
        });
      } else if (id !== target.id) {
        absorbed.push({
          class: piece.class,
          days: piece.days,
          label: node.label,
          href: node.href
        });
      }
    }
  }

  sortFindings(causes);
  absorbed.sort(
    (a, b) => b.days - a.days || (a.label ?? "").localeCompare(b.label ?? "")
  );

  return {
    label: target.label,
    href: target.href,
    lateDays: targetLate,
    causes,
    impacts: [],
    absorbed,
    gaps: gapsOn(ancestors, nodes, preds)
  };
}

const IMPACT_KINDS = new Set<DelayKind>(["operation", "job", "salesLine"]);

function affectsReport(
  source: DelayNode,
  nodes: Map<string, DelayNode>,
  preds: Map<string, Edge[]>,
  order: string[],
  late: Map<string, number>,
  own: Map<string, number>
): DelayReport {
  const down = descendantsOf(source.id, preds);
  const sourceLate = late.get(source.id) ?? 0;
  const piece = piecesOf(source, own.get(source.id) ?? sourceLate)[0];
  const impacts: DelayFinding[] = [];

  if (piece && sourceLate > 0) {
    for (const id of order) {
      if (id === source.id || !down.has(id)) continue;
      const node = nodes.get(id);
      if (!node?.open || !IMPACT_KINDS.has(node.kind)) continue;
      const only = new Map<string, number>([[source.id, piece.days]]);
      const days = Math.min(arrival(order, only, preds, id), late.get(id) ?? 0);
      if (days <= 0) continue;
      impacts.push({
        class: piece.class,
        days,
        steps: chainOf({ ...piece, id: source.id }, id, order, nodes, preds)
      });
    }
  }

  sortFindings(impacts);
  const absorbed: DelayAbsorbed[] =
    sourceLate > 0 && impacts.length === 0
      ? [
          {
            class: classifyObserved(source, sourceLate),
            days: sourceLate,
            label: source.label,
            href: source.href
          }
        ]
      : [];

  return {
    label: source.label,
    href: source.href,
    lateDays: sourceLate,
    causes: [],
    impacts,
    absorbed,
    gaps: gapsOn(down, nodes, preds, new Set([source.id]))
  };
}

function sortFindings(findings: DelayFinding[]) {
  findings.sort(
    (a, b) =>
      b.days - a.days ||
      a.class.localeCompare(b.class) ||
      (a.steps[0]?.label ?? "").localeCompare(b.steps[0]?.label ?? "")
  );
}

function topo(
  ids: string[],
  preds: Map<string, Edge[]>
): string[] | { cycle: { from: string; to: string } } {
  const indeg = new Map(ids.map((id) => [id, 0]));
  const succs = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [to, edges] of preds) {
    for (const edge of edges) {
      if (!indeg.has(edge.from) || !indeg.has(to)) continue;
      indeg.set(to, (indeg.get(to) ?? 0) + 1);
      succs.get(edge.from)!.push(to);
    }
  }
  for (const list of succs.values()) list.sort();

  const ready = ids.filter((id) => indeg.get(id) === 0).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const next of succs.get(id) ?? []) {
      const left = (indeg.get(next) ?? 1) - 1;
      indeg.set(next, left);
      if (left === 0) {
        ready.push(next);
        ready.sort();
      }
    }
  }
  if (order.length === ids.length) return order;

  const color = new Map<string, 0 | 1 | 2>(ids.map((id) => [id, 0]));
  let cycle: { from: string; to: string } | null = null;
  const dfs = (id: string) => {
    if (cycle) return;
    color.set(id, 1);
    for (const next of succs.get(id) ?? []) {
      const state = color.get(next) ?? 0;
      if (state === 1) {
        cycle = { from: id, to: next };
        return;
      }
      if (state === 0) dfs(next);
    }
    color.set(id, 2);
  };
  for (const id of [...ids].sort()) {
    if (color.get(id) === 0) dfs(id);
    if (cycle) break;
  }
  return { cycle: cycle ?? { from: ids[0] ?? "", to: ids[0] ?? "" } };
}

function hide<T extends { label?: string; href?: string }>(
  value: T,
  show: boolean
): T {
  if (show) return value;
  const next = { ...value };
  delete next.label;
  delete next.href;
  return next;
}

/** Session users follow their own permissions. An API key must also hold
 *  `<module>_view` for this company, or a production-only key still shows
 *  purchasing rows its owner can see. */
export function canViewDelayModule(
  userCan: boolean,
  keyScopes: Record<string, string[]> | null,
  module: string,
  companyId: string
): boolean {
  if (!userCan) return false;
  if (!keyScopes) return true;
  return keyScopes[`${module}_view`]?.includes(companyId) === true;
}

export function redactDelay(
  result: DelayResult,
  canView: (module: string) => boolean
): DelayResult {
  const showKind = (kind: DelayKind) => canView(delayModule[kind]);
  if ("cycle" in result) {
    return {
      reports: [],
      cycle: {
        from: hide(result.cycle.from, showKind(result.cycle.from.kind)),
        to: hide(result.cycle.to, showKind(result.cycle.to.kind))
      }
    };
  }
  return {
    reports: result.reports.map((report) => ({
      ...report,
      causes: report.causes.map((cause) => ({
        ...cause,
        steps: cause.steps.map((item) => hide(item, showKind(item.kind)))
      })),
      impacts: report.impacts.map((impact) => ({
        ...impact,
        steps: impact.steps.map((item) => hide(item, showKind(item.kind)))
      })),
      absorbed: report.absorbed.map((item) => {
        const kind = kindOfClass(item.class);
        return hide(item, kind ? showKind(kind) : true);
      }),
      gaps: report.gaps.map((gap) => ({
        ...gap,
        from: hide(gap.from, showKind(gap.from.kind)),
        to: hide(gap.to, showKind(gap.to.kind))
      }))
    }))
  };
}

function kindOfClass(value: DelayClass): DelayKind | null {
  switch (value) {
    case "late_supply":
      return "supply";
    case "outside_processing":
      return "outside";
    case "quality_hold":
      return "quality";
    case "ran_long":
    case "started_late":
      return "operation";
    case "completed_late":
      return "job";
    case "shipped_late":
      return "salesLine";
    default:
      return null;
  }
}
