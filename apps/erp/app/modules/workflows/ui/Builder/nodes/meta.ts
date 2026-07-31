import type { WorkflowNode, WorkflowNodeType } from "@carbon/workflows";
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

export const NODE_KIND_META: Record<WorkflowNodeType, NodeKindMeta> = {
  trigger: {
    name: "Trigger",
    Icon: LuZap,
    accent: "#f59e0b",
    description: "Starts the workflow",
    defaultTitle: "When this happens",
    hasTarget: false,
    catalogId: (node) =>
      node.type === "trigger" ? node.data.events?.[0] : undefined
  },
  condition: {
    name: "Condition",
    Icon: LuSplit,
    accent: "#2563eb",
    description: "Sends the run down one path",
    defaultTitle: "Only if",
    hasTarget: true,
    summary: (node) =>
      node.type === "condition"
        ? count(node.data.paths?.length ?? 0, "path", "paths")
        : undefined
  },
  action: {
    name: "Action",
    Icon: LuPlay,
    accent: "#059669",
    description: "Notifies, sends or calls out",
    defaultTitle: "Do something",
    hasTarget: true,
    catalogId: (node) =>
      node.type === "action" ? node.data.action || undefined : undefined
  },
  entity: {
    name: "Record",
    Icon: LuPencilRuler,
    accent: "#7c3aed",
    description: "Writes to a record in Carbon",
    defaultTitle: "Create or update a record",
    hasTarget: true,
    catalogId: (node) =>
      node.type === "entity" ? node.data.operation || undefined : undefined
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
    summary: (node) =>
      node.type === "lookup" ? node.data.entity || undefined : undefined
  },
  filter: {
    name: "Filter",
    Icon: LuFilter,
    accent: "#db2777",
    description: "Keeps only the items that match",
    defaultTitle: "Narrow a list",
    hasTarget: true,
    summary: (node) =>
      node.type === "filter"
        ? count(node.data.clauses?.length ?? 0, "rule", "rules")
        : undefined
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
