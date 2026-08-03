import type {
  AvailableVariable,
  ValueType,
  VariableRef,
  WorkflowCatalog
} from "@carbon/workflows";
import { typesEqual } from "@carbon/workflows";
import { describeVariable, propertyLabelKey } from "../labelKeys";
import { encodeTokenId, refLabel } from "./tokenId";

export type VariableMenuItem = {
  id: string;
  label: string;
  helper?: string;
};

/** One row in the drill-down menu. `item` means selectable, `children` means drillable,
 * neither means disabled with `helper` saying why; an entity can be both. */
export type VariableTreeNode = {
  key: string;
  label: string;
  helper?: string;
  item?: VariableMenuItem;
  children?: VariableTreeNode[];
};

/** How many property hops a reference may take. The drill-down picker imports
 * this, so both menus offer exactly the same set. */
export const MAX_PATH = 2;

type Options = {
  /** Omit to accept any type — template fields render anything as text. */
  accepts?: ValueType;
  inLoop?: boolean;
  /** Resolves a catalog label key to display text. Defaults to the fallback, which is what
   * the tests use — this file must not import the Lingui macro. */
  labelFor?: (key: string, fallback: string) => string;
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

/** The same variables as `variableMenuItems`, as a tree so the menu can show one level at
 * a time. Search still comes off the flat list — it matches the whole breadcrumb. */
export function variableTree(
  variables: AvailableVariable[],
  catalog: WorkflowCatalog,
  { accepts, inLoop, labelFor = (_key, fallback) => fallback }: Options = {}
): VariableTreeNode[] {
  const fits = (type: ValueType) => !accepts || typesEqual(type, accepts);

  /** Null for a branch with nothing usable inside. An incompatible leaf is not null — it
   * stays, disabled, because its helper is what explains the exclusion. */
  function build(
    variable: AvailableVariable,
    type: ValueType,
    path: string[],
    label: string
  ): VariableTreeNode | null {
    const compatible = fits(type);
    const ref: VariableRef = {
      kind: "ref",
      nodeId: variable.nodeId,
      output: variable.output,
      path
    };
    const helper = describeVariable(
      type,
      variable.guaranteed,
      compatible ? undefined : accepts
    );
    const node: VariableTreeNode = {
      key: `${variable.nodeId}:${variable.output}:${path.join(".")}`,
      label,
      helper,
      item: compatible
        ? {
            id: encodeTokenId(ref),
            label: refLabel(ref, variable.nodeName),
            helper
          }
        : undefined
    };

    if (path.length < MAX_PATH && type.kind === "entity") {
      const entity = catalog.getEntity(type.of);
      const children = entity
        ? Object.entries(entity.properties)
            .map(([property, propertyType]) =>
              // Property labels are catalog-driven; the raw column name is the fallback.
              build(
                variable,
                propertyType,
                [...path, property],
                labelFor(propertyLabelKey(type.of, property), property)
              )
            )
            .filter((child): child is VariableTreeNode => child !== null)
        : [];
      if (children.length) node.children = children;
      // Nothing to pick here and nothing worth opening — never offer a dead end.
      if (!node.item && !children.length) return null;
    }

    return node;
  }

  /** A level with one child and nothing to pick at this level is a level the user would
   * have to walk through for no information. Hoist it. */
  function collapse(node: VariableTreeNode): VariableTreeNode {
    const children = node.children?.map(collapse);
    if (!node.item && children?.length === 1) {
      const only = children[0]!;
      return collapse({
        ...node,
        item: only.item,
        helper: only.helper,
        children: only.children
      });
    }
    return children ? { ...node, children } : node;
  }

  const byNode = new Map<string, VariableTreeNode>();
  for (const variable of variables) {
    let step = byNode.get(variable.nodeId);
    if (!step) {
      step = { key: variable.nodeId, label: variable.nodeName, children: [] };
      byNode.set(variable.nodeId, step);
    }
    const output = build(variable, variable.type, [], variable.output);
    if (output) step.children!.push(output);
  }

  const roots = [...byNode.values()]
    .map(collapse)
    .filter((step) => step.item || step.children?.length);

  if (inLoop) {
    const ref = { kind: "item" as const, path: [] };
    roots.push({
      key: "item",
      label: "Current item",
      helper: "the item in the current loop",
      item: {
        id: encodeTokenId(ref),
        label: refLabel(ref),
        helper: "the item in the current loop"
      }
    });
  }

  return roots;
}
