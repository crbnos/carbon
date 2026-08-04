import type { TermId } from "@carbon/glossary";
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
  /** Glossary term for the ⓘ hover next to the label. */
  helpTermId?: TermId;
  choices?: readonly string[];
  value: ValueOrRef | undefined;
  onChange: (next: ValueOrRef | undefined) => void;
  context: FieldContext;
  /** Repeated rows (clause lists) label the columns once, at the top. */
  hideLabel?: boolean;
  /** Short placeholder for narrow columns; falls back to the field's own wording. */
  placeholder?: string;
  /** Message from a publish issue whose `field` path resolves here. */
  issue?: string;
};
