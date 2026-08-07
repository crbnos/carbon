import type {
  AvailableVariable,
  ValueType,
  VariableRef,
  WorkflowCatalog
} from "@carbon/workflows";
import { canAssign, rendersAsText } from "@carbon/workflows";
import {
  describeVariable,
  nodeNameLabel,
  outputLabel,
  propertyLabelKey
} from "../labelKeys";
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
  /** Plain-English explanation of what this field holds, shown as a tooltip. */
  description?: string;
  item?: VariableMenuItem;
  children?: VariableTreeNode[];
};

/** How many property hops a reference may take. The drill-down picker imports
 * this, so both menus offer exactly the same set. */
export const MAX_PATH = 2;

/** What the menu filters by, which is not always the type the field renders: a clause's
 * left side renders as text but must offer every variable. `undefined` is the "no filter"
 * signal below, so `"any"` is how a caller asks for it. */
export function pickAccepts(
  type: ValueType,
  accepts: ValueType | "any" | undefined
): ValueType | undefined {
  if (accepts === "any") return undefined;
  return accepts ?? type;
}

type Options = {
  /** Omit to accept any type. */
  accepts?: ValueType;
  /** For fields that write into a sentence. A record has no reading as text, so it is
   * not offered; drilling into it still is, which is where its name lives. */
  textOnly?: boolean;
  inLoop?: boolean;
  /** The action runs once per item, so a list may fill a single-value input. */
  batching?: boolean;
  /** Resolves a catalog label key to display text. Defaults to the fallback, which is what
   * the tests use — this file must not import the Lingui macro. */
  labelFor?: (key: string, fallback: string) => string;
};

/**
 * A change trigger hands out `record` and `after` as the same row in the same state.
 * Offering both only asks the user to pick between two names for one thing, so the
 * menus show `record`. An existing reference to `after` still resolves and still
 * renders — this hides it from the menu, it does not remove it.
 */
function withoutDuplicateOutputs(
  variables: AvailableVariable[]
): AvailableVariable[] {
  const hasRecord = new Set(
    variables.filter((v) => v.output === "record").map((v) => v.nodeId)
  );
  return variables.filter(
    (v) => v.output !== "after" || !hasRecord.has(v.nodeId)
  );
}

/**
 * Flattens the variable list into menu entries, expanding entity properties up to
 * `MAX_PATH` hops. Labels come from `refLabel`, the same function that renders an
 * already-placed token, so a chip reads the same whether it was just inserted or
 * loaded from storage.
 */
export function variableMenuItems(
  variables: AvailableVariable[],
  catalog: WorkflowCatalog,
  {
    accepts,
    textOnly,
    inLoop,
    batching,
    labelFor = (_key, fallback) => fallback
  }: Options = {}
): VariableMenuItem[] {
  const items: VariableMenuItem[] = [];
  const fits = (type: ValueType) =>
    (!textOnly || rendersAsText(type)) &&
    (!accepts || canAssign(type, accepts, { batching }));

  for (const variable of withoutDuplicateOutputs(variables)) {
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
        helper: describeVariable(type, variable.guaranteed, labelFor)
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
  {
    accepts,
    textOnly,
    inLoop,
    batching,
    labelFor = (_key, fallback) => fallback
  }: Options = {}
): VariableTreeNode[] {
  const fits = (type: ValueType) =>
    (!textOnly || rendersAsText(type)) &&
    (!accepts || canAssign(type, accepts, { batching }));

  /** Null for a branch with nothing pickable inside — a row you cannot use is a row
   * that should not be there. An entity with usable properties survives even when the
   * record itself does not fit. */
  function build(
    variable: AvailableVariable,
    type: ValueType,
    path: string[],
    label: string,
    description?: string
  ): VariableTreeNode | null {
    const compatible = fits(type);
    const ref: VariableRef = {
      kind: "ref",
      nodeId: variable.nodeId,
      output: variable.output,
      path
    };
    const helper = describeVariable(type, variable.guaranteed, labelFor);
    const node: VariableTreeNode = {
      key: `${variable.nodeId}:${variable.output}:${path.join(".")}`,
      label,
      helper,
      description,
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
                labelFor(propertyLabelKey(type.of, property), property),
                entity.descriptions?.[property]
              )
            )
            .filter((child): child is VariableTreeNode => child !== null)
        : [];
      if (children.length) node.children = children;
      // Nothing to pick here and nothing worth opening — never offer a dead end.
      if (!node.item && !children.length) return null;
    }

    // A leaf that does not fit has nothing to offer and nothing to open.
    if (!node.item && !node.children?.length) return null;

    return node;
  }

  const byNode = new Map<string, VariableTreeNode>();
  for (const variable of withoutDuplicateOutputs(variables)) {
    let step = byNode.get(variable.nodeId);
    if (!step) {
      step = {
        key: variable.nodeId,
        label: nodeNameLabel(variable.nodeName),
        children: []
      };
      byNode.set(variable.nodeId, step);
    }
    const output = build(
      variable,
      variable.type,
      [],
      outputLabel(variable.output)
    );
    if (output) step.children!.push(output);
  }

  // A lone output is not hoisted into its step's row: the chip names the output, so the
  // row the user clicks has to name it too.
  const roots = [...byNode.values()].filter(
    (step) => step.item || step.children?.length
  );

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
