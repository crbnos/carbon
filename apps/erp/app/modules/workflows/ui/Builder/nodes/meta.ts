import type { WorkflowNode, WorkflowNodeType } from "@carbon/workflows";
import { WORKFLOW_LABELS } from "@carbon/workflows/labels";
import type { IconType } from "react-icons";
import {
  LuFilter,
  LuPencilRuler,
  LuPlay,
  LuSearch,
  LuSplit,
  LuZap
} from "react-icons/lu";

/**
 * The one place per-kind presentation lives. The palette, the node card and the
 * accent swatch all read this, so a kind cannot look like one thing on the rail
 * and another on the canvas.
 */
export type NodeKindMeta = {
  name: string;
  Icon: IconType;
  accent: string;
  description: string;
  defaultTitle: string;
  hasTarget: boolean;
  catalogId?: (node: WorkflowNode) => string | undefined;
  title?: (node: WorkflowNode) => string | undefined;
  summary?: (node: WorkflowNode) => string | undefined;
};

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** Resolve a catalog label key to its English source string without calling hooks. */
export function labelText(key: string): string | undefined {
  const descriptor = WORKFLOW_LABELS[key as keyof typeof WORKFLOW_LABELS];
  return descriptor?.id;
}

export const NODE_KIND_META: Record<WorkflowNodeType, NodeKindMeta> = {
  trigger: {
    name: "Trigger",
    Icon: LuZap,
    accent: "#f59e0b",
    description: "Starts the workflow",
    defaultTitle: "When this happens",
    hasTarget: false,
    catalogId: (node) =>
      node.type === "trigger" ? node.data.events?.[0] : undefined,
    summary: (node) => {
      if (node.type !== "trigger") return undefined;
      const { schedule, events } = node.data;
      if (schedule) return `Every ${schedule.freq.toLowerCase()}`;
      const n = events?.length ?? 0;
      if (n > 1) return `${n} events`;
      if (n === 1) return labelText(events[0]) ?? events[0];
      return undefined;
    }
  },
  condition: {
    name: "Condition",
    Icon: LuSplit,
    accent: "#2563eb",
    description: "Sends the run down one path",
    defaultTitle: "Only if",
    hasTarget: true,
    summary: (node) => {
      if (node.type !== "condition") return undefined;
      const paths = node.data.paths ?? [];
      if (paths.length === 0) return undefined;
      const first = paths.find((p) => p.kind !== "else") ?? paths[0];
      const clause = first?.clauses?.[0];
      if (clause) {
        const left = clause.left;
        if (left.kind === "ref" && left.path.length > 0) {
          return `If ${left.path.join(".")} ${clause.operator} …`;
        }
        if (left.kind === "literal") {
          return `If ${String(left.value)} ${clause.operator} …`;
        }
      }
      return count(paths.length, "path", "paths");
    }
  },
  action: {
    name: "Action",
    Icon: LuPlay,
    accent: "#059669",
    description: "Notifies, sends or calls out",
    defaultTitle: "Do something",
    hasTarget: true,
    catalogId: (node) =>
      node.type === "action" ? node.data.action || undefined : undefined,
    summary: (node) => {
      if (node.type !== "action" || !node.data.action) return undefined;
      return labelText(node.data.action) ?? node.data.action;
    }
  },
  entity: {
    name: "Record",
    Icon: LuPencilRuler,
    accent: "#7c3aed",
    description: "Writes to a record in Carbon",
    defaultTitle: "Create or update a record",
    hasTarget: true,
    catalogId: (node) =>
      node.type === "entity" ? node.data.operation || undefined : undefined,
    summary: (node) => {
      if (node.type !== "entity" || !node.data.operation) return undefined;
      return labelText(node.data.operation) ?? node.data.operation;
    }
  },
  lookup: {
    name: "Find",
    Icon: LuSearch,
    accent: "#0891b2",
    description: "Looks a record up to use later",
    defaultTitle: "Find a record",
    hasTarget: true,
    title: (node) =>
      node.type === "lookup" && node.data.entity
        ? `Find ${node.data.entity}`
        : undefined,
    summary: (node) => {
      if (node.type !== "lookup") return undefined;
      const { entity, match } = node.data;
      if (!entity) return undefined;
      const n = match?.length ?? 0;
      return n > 0
        ? `Find ${entity} matching ${count(n, "rule", "rules")}`
        : `Find ${entity}`;
    }
  },
  filter: {
    name: "Filter",
    Icon: LuFilter,
    accent: "#db2777",
    description: "Keeps only the items that match",
    defaultTitle: "Narrow a list",
    hasTarget: true,
    summary: (node) => {
      if (node.type !== "filter") return undefined;
      const n = node.data.clauses?.length ?? 0;
      return n > 0
        ? `Keep items matching ${count(n, "rule", "rules")}`
        : undefined;
    }
  }
};

/** Palette order. Explicit so it does not ride on object key order. */
export const NODE_KIND_ORDER: WorkflowNodeType[] = [
  "trigger",
  "condition",
  "action",
  "entity",
  "lookup",
  "filter"
];
