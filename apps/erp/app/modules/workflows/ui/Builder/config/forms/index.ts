import type {
  WorkflowIssue,
  WorkflowNode,
  WorkflowNodeType
} from "@carbon/workflows";
import type { ComponentType } from "react";
import type { BuilderNode } from "../../../../types";
import { ActionForm } from "./ActionForm";
import { ComputeForm } from "./ComputeForm";
import { ConditionForm } from "./ConditionForm";
import { FilterForm } from "./FilterForm";
import { LookupForm } from "./LookupForm";
import { TriggerForm } from "./TriggerForm";

/** Narrowed per kind, so a form reads `node.data` off the shared schema rather than
 * re-declaring it — renaming a field in `packages/workflows` now fails the typecheck. */
export type NodeFormProps<K extends WorkflowNodeType = WorkflowNodeType> = {
  node: Omit<BuilderNode, "type" | "data"> & {
    type: K;
    data: Extract<WorkflowNode, { type: K }>["data"];
  };
  /** Issues for this node, so forms can highlight the affected field. */
  issues?: WorkflowIssue[];
  /** The version is published: render every control disabled rather than inert. */
  isReadOnly?: boolean;
};

/** Spelled out: a missing kind is a TS2741, not a blank panel. */
export const NODE_FORMS: {
  [K in WorkflowNodeType]: ComponentType<NodeFormProps<K>>;
} = {
  trigger: TriggerForm,
  condition: ConditionForm,
  compute: ComputeForm,
  lookup: LookupForm,
  filter: FilterForm,
  action: ActionForm
};

/** What the card can actually pass: the kind is a value, so it cannot be correlated. */
export type AnyNodeForm = ComponentType<{
  node: BuilderNode;
  issues?: WorkflowIssue[];
  isReadOnly?: boolean;
}>;
