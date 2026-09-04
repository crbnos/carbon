import type { TermId } from "@carbon/glossary";
import type { ValueOrRef, ValueType } from "@carbon/workflows";

export type FieldContext = {
  nodeId: string;
  /** True inside a filter node's clauses or a batch-mode action where `item` is offered. */
  inLoop: boolean;
  /** The action runs once per item, so a list may fill a single-value input.
   * Deliberately not `inLoop`: filter clauses set that too, and there the
   * relaxation must not apply. */
  batching?: boolean;
};

export type ValueFieldProps = {
  label: string;
  type: ValueType;
  /** Overrides `type` for the variable-picker filter; `"any"` shows every variable.
   * Spelled as a value rather than `undefined` because an omitted prop has to keep
   * meaning "filter by `type`". */
  accepts?: ValueType | "any";
  required?: boolean;
  /** Glossary term for the ⓘ hover next to the label. */
  helpTermId?: TermId;
  choices?: readonly string[];
  value: ValueOrRef | undefined;
  onChange: (next: ValueOrRef | undefined) => void;
  context: FieldContext;
  /** Short placeholder for narrow columns; falls back to the field's own wording. */
  placeholder?: string;
  /** Message from a publish issue whose `field` path resolves here. */
  issue?: string;
  /** Per-variable messages, keyed by the variable's position in the value. Only the
   * broken one goes red; a sentence's other variables are left alone. */
  partIssues?: Record<number, string>;
  /** The version is published: show the value, refuse every edit. */
  isReadOnly?: boolean;
};
