import { useParams } from "@remix-run/react";
import { useCallback, useMemo } from "react";
import type { Tree } from "~/components/TreeView";
import type {
  CostEffects,
  Costs,
  QuotationOperation,
  QuoteMethod,
} from "../../types";

const defaultEffects: CostEffects = {
  materialCost: [],
  partCost: [],
  toolCost: [],
  fixtureCost: [],
  consumableCost: [],
  serviceCost: [],
  laborCost: [],
  overheadCost: [],
  setupHours: [],
  productionHours: [],
};

type EnhancedTree = Tree<QuoteMethod & { operations?: QuotationOperation[] }>;

export function useLineCosts({
  methodTree: originalMethodTree,
  operations,
  unitCost = 0,
}: {
  methodTree?: Tree<QuoteMethod>;
  operations: QuotationOperation[];
  unitCost?: number;
}): (quantity: number) => Costs {
  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  // TODO: instead of walking the tree twice (once for the quantities/operations and once for the effects)
  // we could do it all in one pass

  const methodTree = useMemo<EnhancedTree | undefined>(() => {
    if (!originalMethodTree || !originalMethodTree.id) {
      return undefined;
    }

    const tree = structuredClone(originalMethodTree);

    function walkTree(tree: EnhancedTree, parentQuantity: number) {
      // multiply quantity by parent quantity
      tree.data.quantity = tree.data.quantity * parentQuantity;
      tree.data.operations = operations.filter(
        (o) => o.quoteMakeMethodId === tree.data.quoteMaterialMakeMethodId
      );

      if (tree.children) {
        for (const child of tree.children) {
          walkTree(child, tree.data.quantity);
        }
      }
    }

    walkTree(tree, 1);

    return tree;
  }, [operations, originalMethodTree]);

  const costEffects = useMemo<CostEffects>(() => {
    const effects = structuredClone(defaultEffects);

    function walkTree(tree: EnhancedTree) {
      const { data } = tree;

      if (["Buy", "Pick"].includes(data.methodType)) {
        switch (data.itemType) {
          case "Material":
            effects.materialCost.push(
              (quantity) => data.unitCost * data.quantity * quantity
            );
            break;
          case "Part":
            effects.partCost.push(
              (quantity) => data.unitCost * data.quantity * quantity
            );
            break;
          case "Tool":
            effects.toolCost.push(
              (quantity) => data.unitCost * data.quantity * quantity
            );
            break;
          case "Fixture":
            effects.fixtureCost.push(
              (quantity) => data.unitCost * data.quantity * quantity
            );
            break;
          case "Consumable":
            effects.consumableCost.push(
              (quantity) => data.unitCost * data.quantity * quantity
            );
            break;
          case "Service":
            effects.serviceCost.push(
              (quantity) => data.unitCost * data.quantity * quantity
            );
            break;
          default:
            break;
        }
      }

      data.operations?.forEach((operation: QuotationOperation) => {
        if (operation.setupHours) {
          // setupHours don't depend on quantity
          effects.setupHours.push((quantity) => {
            return operation.setupHours;
          });
          if (operation.quotingRate) {
            effects.overheadCost.push((quantity) => {
              return operation.setupHours * (operation.quotingRate ?? 0);
            });
          } else {
            effects.laborCost.push((quantity) => {
              return operation.setupHours * (operation.laborRate ?? 0);
            });
            effects.overheadCost.push((quantity) => {
              return operation.setupHours * (operation.overheadRate ?? 0);
            });
          }
        }

        if (operation.productionStandard) {
          // normalize production standard to hours
          let hoursPerProductionStandard = 0;
          switch (operation.standardFactor) {
            case "Total Hours":
            case "Hours/Piece":
              hoursPerProductionStandard = operation.productionStandard;
              break;
            case "Hours/100 Pieces":
              hoursPerProductionStandard = operation.productionStandard / 100;
              break;
            case "Hours/1000 Pieces":
              hoursPerProductionStandard = operation.productionStandard / 1000;
              break;
            case "Total Minutes":
            case "Minutes/Piece":
              hoursPerProductionStandard = operation.productionStandard / 60;
              break;
            case "Minutes/100 Pieces":
              hoursPerProductionStandard =
                operation.productionStandard / 100 / 60;
              break;
            case "Minutes/1000 Pieces":
              hoursPerProductionStandard =
                operation.productionStandard / 1000 / 60;
              break;
            case "Pieces/Hour":
              hoursPerProductionStandard = 1 / operation.productionStandard;
              break;
            case "Pieces/Minute":
              hoursPerProductionStandard =
                1 / (operation.productionStandard / 60);
              break;
            case "Seconds/Piece":
              hoursPerProductionStandard = operation.productionStandard / 3600;
              break;
            default:
              break;
          }

          effects.productionHours.push((quantity) => {
            return hoursPerProductionStandard * quantity * data.quantity;
          });
          if (operation.quotingRate) {
            effects.overheadCost.push((quantity) => {
              return (
                hoursPerProductionStandard *
                quantity *
                data.quantity *
                (operation.quotingRate ?? 0)
              );
            });
          } else {
            effects.laborCost.push((quantity) => {
              return (
                hoursPerProductionStandard *
                quantity *
                data.quantity *
                (operation.laborRate ?? 0)
              );
            });
            effects.overheadCost.push((quantity) => {
              return (
                hoursPerProductionStandard *
                quantity *
                data.quantity *
                (operation.overheadRate ?? 0)
              );
            });
          }
        }
      });

      if (tree.children) {
        for (const child of tree.children) {
          walkTree(child);
        }
      }
    }

    if (methodTree) {
      walkTree(methodTree);
    } else {
      effects.materialCost.push((quantity) => unitCost * quantity);
    }

    return effects;
  }, [methodTree, unitCost]);

  const getCosts = useCallback(
    (quantity: number) => {
      const materialCost = costEffects.materialCost.reduce(
        (acc, effect) => acc + effect(quantity),
        0
      );

      const partCost = costEffects.partCost.reduce(
        (acc, effect) => acc + effect(quantity),
        0
      );

      const toolCost = costEffects.toolCost.reduce(
        (acc, effect) => acc + effect(quantity),
        0
      );

      const fixtureCost = costEffects.fixtureCost.reduce(
        (acc, effect) => acc + effect(quantity),
        0
      );

      const consumableCost = costEffects.consumableCost.reduce(
        (acc, effect) => acc + effect(quantity),
        0
      );

      const serviceCost = costEffects.serviceCost.reduce(
        (acc, effect) => acc + effect(quantity),
        0
      );

      const laborCost = costEffects.laborCost.reduce(
        (acc, effect) => acc + effect(quantity),
        0
      );

      const overheadCost = costEffects.overheadCost.reduce(
        (acc, effect) => acc + effect(quantity),
        0
      );

      const setupHours = costEffects.setupHours.reduce(
        (acc, effect) => acc + effect(quantity),
        0
      );

      const productionHours = costEffects.productionHours.reduce(
        (acc, effect) => acc + effect(quantity),
        0
      );

      return {
        materialCost,
        partCost,
        toolCost,
        fixtureCost,
        consumableCost,
        serviceCost,
        laborCost,
        overheadCost,
        outsideCost: 0,
        setupHours,
        productionHours,
      };
    },
    [costEffects]
  );

  return getCosts;
}
