import type {
  AvailableVariable,
  ValueType,
  VariableRef,
  WorkflowCatalog
} from "@carbon/workflows";
import { typesEqual } from "@carbon/workflows";
import { describeVariable } from "../labelKeys";
import { encodeTokenId, refLabel } from "./tokenId";

export type VariableMenuItem = {
  id: string;
  label: string;
  helper?: string;
};

/** How many property hops a reference may take. The drill-down picker imports
 * this, so both menus offer exactly the same set. */
export const MAX_PATH = 2;

type Options = {
  /** Omit to accept any type — template fields render anything as text. */
  accepts?: ValueType;
  inLoop?: boolean;
};

/**
 * Flattens the variable list into menu entries, expanding entity properties up to
 * `MAX_PATH` hops. Labels come from `refLabel`, the same function that renders an
 * already-placed token, so a chip reads the same whether it was just inserted or
 * loaded from storage.
 */
export function variableMenuItems(
  variables: AvailableVariable[],
  catalog: WorkflowCatalog,
  { accepts, inLoop }: Options = {}
): VariableMenuItem[] {
  const items: VariableMenuItem[] = [];
  const fits = (type: ValueType) => !accepts || typesEqual(type, accepts);

  for (const variable of variables) {
    const add = (path: string[], type: ValueType) => {
      if (!fits(type)) return;
      const ref: VariableRef = {
        kind: "ref",
        nodeId: variable.nodeId,
        output: variable.output,
        path
      };
      items.push({
        id: encodeTokenId(ref),
        label: refLabel(ref, variable.nodeName),
        helper: describeVariable(type, variable.guaranteed)
      });
    };

    const expand = (type: ValueType, path: string[]) => {
      if (path.length >= MAX_PATH || type.kind !== "entity") return;
      const entity = catalog.getEntity(type.of);
      if (!entity) return;
      for (const [property, propertyType] of Object.entries(
        entity.properties
      )) {
        const nextPath = [...path, property];
        add(nextPath, propertyType);
        expand(propertyType, nextPath);
      }
    };

    add([], variable.type);
    expand(variable.type, []);
  }

  if (inLoop) {
    const ref = { kind: "item" as const, path: [] };
    items.push({
      id: encodeTokenId(ref),
      label: refLabel(ref),
      helper: "the item in the current loop"
    });
  }

  return items;
}
