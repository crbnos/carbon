import { OPERATOR_LABELS } from "@carbon/utils";
import type { WorkflowNode, WorkflowNodeType } from "@carbon/workflows";
import { WORKFLOW_LABELS } from "@carbon/workflows/labels";
import type { IconType } from "react-icons";
import {
  LuCalculator,
  LuFilter,
  LuPlay,
  LuSearch,
  LuSplit,
  LuZap
} from "react-icons/lu";
import { camelCaseToWords } from "~/utils/string";
import { NODE_ACCEPTS_INCOMING } from "./kinds";

/** The one place per-kind presentation lives. Palette and node card both read this. */
export type NodeKindMeta = {
  name: string;
  Icon: IconType;
  description: string;
  defaultTitle: string;
  hasTarget: boolean;
  catalogId?: (node: WorkflowNode) => string | undefined;
  title?: (node: WorkflowNode) => string | undefined;
  summary?: (node: WorkflowNode) => string | undefined;
};

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** `orderTotal` -> `Order total`. Used wherever a raw field name reaches a label. */
export function humanizeField(name: string): string {
  const words = camelCaseToWords(name).trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Resolve a catalog label key to its English source string without calling hooks.
 * The Lingui macro compiles `msg` to `{ id: <hash>, message: <text> }` — `id` is a
 * generated hash, never the label, so this must read `message`. */
export function labelText(key: string): string | undefined {
  const descriptor = WORKFLOW_LABELS[key as keyof typeof WORKFLOW_LABELS] as
    | { id?: string; message?: string }
    | undefined;
  return descriptor?.message ?? descriptor?.id;
}

export const NODE_KIND_META: Record<WorkflowNodeType, NodeKindMeta> = {
  trigger: {
    name: "Trigger",
    Icon: LuZap,
    description: "Starts the workflow",
    defaultTitle: "When this happens",
    hasTarget: NODE_ACCEPTS_INCOMING.trigger,
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
    description: "Sends the run down one path",
    defaultTitle: "Only if",
    hasTarget: NODE_ACCEPTS_INCOMING.condition,
    summary: (node) => {
      if (node.type !== "condition") return undefined;
      const paths = node.data.paths ?? [];
      if (paths.length === 0) return undefined;
      const first = paths.find((p) => p.kind !== "else") ?? paths[0];
      const clause = first?.clauses?.[0];
      if (clause) {
        const left = clause.left;
        const op = OPERATOR_LABELS[clause.operator] ?? clause.operator;
        if (left.kind === "ref" && left.path.length > 0) {
          return `If ${humanizeField(left.path[left.path.length - 1])} ${op} …`;
        }
        if (left.kind === "literal") {
          return `If ${String(left.value)} ${op} …`;
        }
      }
      return count(paths.length, "path", "paths");
    }
  },
  action: {
    name: "Action",
    Icon: LuPlay,
    description: "Notifies, sends or calls out",
    defaultTitle: "Do something",
    hasTarget: NODE_ACCEPTS_INCOMING.action,
    catalogId: (node) =>
      node.type === "action" ? node.data.action || undefined : undefined,
    summary: (node) => {
      if (node.type !== "action" || !node.data.action) return undefined;
      return labelText(node.data.action) ?? node.data.action;
    }
  },
  compute: {
    name: "Compute",
    Icon: LuCalculator,
    description: "Works out a value from a record",
    defaultTitle: "Compute a value",
    hasTarget: NODE_ACCEPTS_INCOMING.compute,
    catalogId: (node) =>
      node.type === "compute" ? node.data.operation || undefined : undefined,
    summary: (node) => {
      if (node.type !== "compute" || !node.data.operation) return undefined;
      return labelText(node.data.operation) ?? node.data.operation;
    }
  },
  lookup: {
    name: "Find",
    Icon: LuSearch,
    description: "Looks a record up to use later",
    defaultTitle: "Find a record",
    hasTarget: NODE_ACCEPTS_INCOMING.lookup,
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
    description: "Keeps only the items that match",
    defaultTitle: "Narrow a list",
    hasTarget: NODE_ACCEPTS_INCOMING.filter,
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
  "compute",
  "lookup",
  "filter"
];

/** What a node type saved before a rename used to be called. A stored definition is
 * migrated on read, but `workflowStepRun.nodeType` is a plain column: a run from before
 * the rename keeps the old string forever, and without this its step row would show the
 * raw word "entity" where every other row shows a kind. */
const LEGACY_NODE_TYPES: Record<string, WorkflowNodeType> = {
  entity: "compute"
};

/** The presentation for a node type read back from the database, old spellings included. */
export function metaForNodeType(type: string): NodeKindMeta | undefined {
  const current = LEGACY_NODE_TYPES[type] ?? (type as WorkflowNodeType);
  return NODE_KIND_META[current];
}
