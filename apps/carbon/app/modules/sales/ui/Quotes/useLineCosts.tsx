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
  consumableCost: [],
  fixtureCost: [],
  laborCost: [],
  laborHours: [],
  machineHours: [],
  materialCost: [],
  outsideCost: [],
  overheadCost: [],
  partCost: [],
  serviceCost: [],
  setupHours: [],
  toolCost: [],
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
        if (operation.operationType === "Inside") {
          if (operation.setupTime) {
            // normalize production standard to hours
            let hoursPerUnit = 0;
            let fixedHours = 0;
            switch (operation.setupUnit) {
              case "Total Hours":
                fixedHours = operation.setupTime;
                break;
              case "Total Minutes":
                fixedHours = operation.setupTime / 60;
                break;
              case "Hours/Piece":
                hoursPerUnit = operation.setupTime;
                break;
              case "Hours/100 Pieces":
                hoursPerUnit = operation.setupTime / 100;
                break;
              case "Hours/1000 Pieces":
                hoursPerUnit = operation.setupTime / 1000;
                break;

              case "Minutes/Piece":
                hoursPerUnit = operation.setupTime / 60;
                break;
              case "Minutes/100 Pieces":
                hoursPerUnit = operation.setupTime / 100 / 60;
                break;
              case "Minutes/1000 Pieces":
                hoursPerUnit = operation.setupTime / 1000 / 60;
                break;
              case "Pieces/Hour":
                hoursPerUnit = 1 / operation.setupTime;
                break;
              case "Pieces/Minute":
                hoursPerUnit = 1 / (operation.setupTime / 60);
                break;
              case "Seconds/Piece":
                hoursPerUnit = operation.setupTime / 3600;
                break;
              default:
                break;
            }

            effects.setupHours.push((quantity) => {
              return hoursPerUnit * quantity * data.quantity + fixedHours;
            });

            effects.laborCost.push((quantity) => {
              return (
                hoursPerUnit *
                  quantity *
                  data.quantity *
                  (operation.laborRate ?? 0) +
                fixedHours * (operation.laborRate ?? 0)
              );
            });

            effects.overheadCost.push((quantity) => {
              return (
                hoursPerUnit *
                  quantity *
                  data.quantity *
                  (operation.overheadRate ?? 0) +
                fixedHours * (operation.overheadRate ?? 0)
              );
            });
          }

          let laborHoursPerUnit = 0;
          let machineHoursPerUnit = 0;

          let laborFixedHours = 0;
          let machineFixedHours = 0;

          if (operation.laborTime) {
            // normalize production standard to hours

            switch (operation.laborUnit) {
              case "Total Hours":
                laborFixedHours = operation.laborTime;
                break;
              case "Total Minutes":
                laborFixedHours = operation.laborTime / 60;
                break;
              case "Hours/Piece":
                laborHoursPerUnit = operation.laborTime;
                break;
              case "Hours/100 Pieces":
                laborHoursPerUnit = operation.laborTime / 100;
                break;
              case "Hours/1000 Pieces":
                laborHoursPerUnit = operation.laborTime / 1000;
                break;

              case "Minutes/Piece":
                laborHoursPerUnit = operation.laborTime / 60;
                break;
              case "Minutes/100 Pieces":
                laborHoursPerUnit = operation.laborTime / 100 / 60;
                break;
              case "Minutes/1000 Pieces":
                laborHoursPerUnit = operation.laborTime / 1000 / 60;
                break;
              case "Pieces/Hour":
                laborHoursPerUnit = 1 / operation.laborTime;
                break;
              case "Pieces/Minute":
                laborHoursPerUnit = 1 / (operation.laborTime / 60);
                break;
              case "Seconds/Piece":
                laborHoursPerUnit = operation.laborTime / 3600;
                break;
              default:
                break;
            }

            effects.laborHours.push((quantity) => {
              return (
                laborHoursPerUnit * quantity * data.quantity + laborFixedHours
              );
            });
          }

          if (operation.machineTime) {
            // normalize production standard to hours

            switch (operation.machineUnit) {
              case "Total Hours":
                machineFixedHours = operation.machineTime;
                break;
              case "Total Minutes":
                machineFixedHours = operation.machineTime / 60;
                break;
              case "Hours/Piece":
                machineHoursPerUnit = operation.machineTime;
                break;
              case "Hours/100 Pieces":
                machineHoursPerUnit = operation.machineTime / 100;
                break;
              case "Hours/1000 Pieces":
                machineHoursPerUnit = operation.machineTime / 1000;
                break;

              case "Minutes/Piece":
                machineHoursPerUnit = operation.machineTime / 60;
                break;
              case "Minutes/100 Pieces":
                machineHoursPerUnit = operation.machineTime / 100 / 60;
                break;
              case "Minutes/1000 Pieces":
                machineHoursPerUnit = operation.machineTime / 1000 / 60;
                break;
              case "Pieces/Hour":
                machineHoursPerUnit = 1 / operation.machineTime;
                break;
              case "Pieces/Minute":
                machineHoursPerUnit = 1 / (operation.machineTime / 60);
                break;
              case "Seconds/Piece":
                machineHoursPerUnit = operation.machineTime / 3600;
                break;
              default:
                break;
            }

            effects.machineHours.push((quantity) => {
              return (
                machineHoursPerUnit * quantity * data.quantity +
                machineFixedHours
              );
            });
          }

          effects.laborCost.push((quantity) => {
            return (
              laborHoursPerUnit *
                quantity *
                data.quantity *
                (operation.laborRate ?? 0) +
              laborFixedHours * (operation.laborRate ?? 0)
            );
          });

          const hoursPerUnit = Math.max(laborHoursPerUnit, machineHoursPerUnit);
          const fixedHours = Math.max(laborFixedHours, machineFixedHours);

          effects.overheadCost.push((quantity) => {
            return (
              hoursPerUnit *
                quantity *
                data.quantity *
                (operation.overheadRate ?? 0) +
              fixedHours * (operation.overheadRate ?? 0)
            );
          });
        } else if (operation.operationType === "Outside") {
          effects.outsideCost.push((quantity) => {
            const unitCost =
              operation.operationUnitCost * data.quantity * quantity;
            return Math.max(operation.operationMinimumCost, unitCost);
          });
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

      const outsideCost = costEffects.outsideCost.reduce(
        (acc, effect) => acc + effect(quantity),
        0
      );

      const setupHours = costEffects.setupHours.reduce(
        (acc, effect) => acc + effect(quantity),
        0
      );

      const laborHours = costEffects.laborHours.reduce(
        (acc, effect) => acc + effect(quantity),
        0
      );

      const machineHours = costEffects.machineHours.reduce(
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
        outsideCost,
        setupHours,
        laborHours,
        machineHours,
      };
    },
    [costEffects]
  );

  return getCosts;
}
