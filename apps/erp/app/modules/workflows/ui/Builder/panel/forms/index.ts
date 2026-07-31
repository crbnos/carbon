import type { WorkflowIssue, WorkflowNodeType } from "@carbon/workflows";
import type { ComponentType } from "react";
import type { BuilderNode } from "../../../../types";
import { ActionForm } from "./ActionForm";
import { ConditionForm } from "./ConditionForm";
import { EntityForm } from "./EntityForm";
import { FilterForm } from "./FilterForm";
import { LookupForm } from "./LookupForm";
import { TriggerForm } from "./TriggerForm";

export type NodeFormProps = {
  node: BuilderNode;
  /** Issues for this node, so forms can highlight the affected field. */
  issues?: WorkflowIssue[];
};

/** Spelled out: a missing kind is a TS2741, not a blank panel. */
export const NODE_FORMS: Record<
  WorkflowNodeType,
  ComponentType<NodeFormProps>
> = {
  trigger: TriggerForm,
  condition: ConditionForm,
  entity: EntityForm,
  lookup: LookupForm,
  filter: FilterForm,
  action: ActionForm
};
