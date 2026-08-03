import { cn } from "@carbon/react";
import {
  VariableText,
  type VariableTextPart
} from "@carbon/react/VariableText";
import type { ValueOrRef, ValueType } from "@carbon/workflows";
import { useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import { catalog } from "../catalog";
import { useBuilderStoreApi } from "../context";
import { useVariablesGetter } from "../useDefinition";
import type { FieldContext } from "./types";
import { fromEditorParts, toEditorParts } from "./valueParts";
import { variableMenuItems } from "./variableMenu";

/** Typing this opens the variable menu. The closing brace is drawn by the chip. */
const TRIGGER = "{";

type Props = {
  /** Restricts the menu, and marks this as a field that type-checks a bare
   * reference. Omit on template fields, which take any type as text. */
  accepts?: ValueType;
  value: ValueOrRef | undefined;
  onChange: (next: ValueOrRef | undefined) => void;
  context: FieldContext;
  /** Short wording for narrow columns; the full sentence does not fit a clause cell. */
  placeholder?: string;
  hasIssue?: boolean;
};

export function InlineValueEditor({
  accepts,
  value,
  onChange,
  context,
  placeholder,
  hasIssue
}: Props) {
  const { t } = useLingui();
  const store = useBuilderStoreApi();
  const getVariables = useVariablesGetter(context.nodeId);

  // Read without subscribing: `nodes` is replaced on every drag frame. Names are
  // display-only here, so a rename elsewhere lands on the next render.
  const nodeName = useCallback(
    (id: string) => store.getState().nodes.find((n) => n.id === id)?.name,
    [store]
  );

  const items = useCallback(
    () =>
      variableMenuItems(getVariables(), catalog, {
        accepts,
        inLoop: context.inLoop
      }),
    [getVariables, accepts, context.inLoop]
  );

  return (
    <VariableText
      value={toEditorParts(value, nodeName)}
      onChange={(next: VariableTextPart[]) =>
        onChange(
          fromEditorParts(next, { collapseSingleRef: accepts !== undefined })
        )
      }
      placeholder={placeholder ?? t`Type ${TRIGGER} to insert a variable`}
      multiline={false}
      suggestionChar={TRIGGER}
      suggestionItems={items}
      className={cn("w-full", hasIssue && "border-destructive")}
    />
  );
}
