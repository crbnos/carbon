import type { ValueType } from "@carbon/workflows";
import { useCallback, useRef } from "react";
import { useWorkflowCatalog, useWorkflowLabel } from "../catalog";
import { describeVariable } from "../labelKeys";
import { useVariablesGetter } from "../useDefinition";
import type { VariableMenuData } from "./menuBridge";
import type { FieldContext } from "./types";
import { variableMenuItems, variableTree } from "./variableMenu";

/** A field's variables, as a tree to browse and a flat list to search. Returns a getter,
 * not a value — re-creating the suggestion extension mid-keystroke tears the editor down. */
export function useVariableMenuData(
  context: FieldContext,
  accepts: ValueType | undefined,
  textOnly?: boolean
): () => VariableMenuData {
  const getVariables = useVariablesGetter(context.nodeId);
  const catalog = useWorkflowCatalog();

  // `useWorkflowLabel` returns a fresh closure each render; read it through a ref so
  // the getter identity stays stable for callers that memoise on it.
  const label = useWorkflowLabel();
  const labelRef = useRef(label);
  labelRef.current = label;

  return useCallback(() => {
    const variables = getVariables();
    const opts = {
      accepts,
      textOnly,
      inLoop: context.inLoop,
      batching: context.batching,
      labelFor: (key: string, fallback: string) =>
        labelRef.current(key, fallback)
    };
    return {
      tree: variableTree(variables, catalog, opts),
      flat: variableMenuItems(variables, catalog, opts),
      emptyReason: accepts
        ? `No earlier step produces ${describeVariable(accepts, true, opts.labelFor)}.`
        : undefined
    };
  }, [
    getVariables,
    accepts,
    textOnly,
    context.inLoop,
    context.batching,
    catalog
  ]);
}
