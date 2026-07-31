import type { ValueOrRef, ValueType } from "@carbon/workflows";

export type FieldContext = {
  nodeId: string;
  /** True inside a filter node's clauses or a batch-mode action where `item` is offered. */
  inLoop: boolean;
};

export type ValueFieldProps = {
  label: string;
  type: ValueType;
  required?: boolean;
  choices?: readonly string[];
  value: ValueOrRef | undefined;
  onChange: (next: ValueOrRef | undefined) => void;
  context: FieldContext;
  /** Message from a publish issue whose `field` path resolves here. */
  issue?: string;
};
