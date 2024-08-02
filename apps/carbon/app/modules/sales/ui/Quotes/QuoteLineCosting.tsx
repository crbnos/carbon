import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Enumerable,
  HStack,
  Table,
  Tbody,
  Td,
  Tfoot,
  Th,
  Thead,
  Tr,
  VStack,
} from "@carbon/react";
import { useParams } from "@remix-run/react";
import { useCallback, useMemo, useState } from "react";
import type { Tree } from "~/components/TreeView";
import type { QuotationOperation, QuoteMethod } from "~/modules/sales";

type Costs = {
  materialCost: number;
  laborCost: number;
  overheadCost: number;
  outsideCost: number;
  setupHours: number;
  productionHours: number;
};

type Effect = (quantity: number) => number;
type CostEffects = {
  materialCost: Effect[];
  laborCost: Effect[];
  overheadCost: Effect[];
  setupHours: Effect[];
  productionHours: Effect[];
};

const defaultEffects: CostEffects = {
  materialCost: [],
  laborCost: [],
  overheadCost: [],
  setupHours: [],
  productionHours: [],
};

type EnhancedTree = Tree<QuoteMethod & { operations?: QuotationOperation[] }>;

function useLineCosts({
  methodTree: originalMethodTree,
  operations,
}: {
  methodTree?: Tree<QuoteMethod>;
  operations: QuotationOperation[];
}): (quantity: number) => Costs {
  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  // TODO: instead of walking the tree twice (once for the quantities/operations and once for the effects)
  // we could do it all in one pass

  const methodTree = useMemo<EnhancedTree>(() => {
    if (!originalMethodTree || !originalMethodTree.id) {
      return {} as Tree<QuoteMethod>;
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
    const effects = defaultEffects;

    function walkTree(tree: EnhancedTree) {
      const { data } = tree;

      if (["Buy", "Pick"].includes(data.methodType)) {
        effects.materialCost.push(
          (quantity) => data.unitCost * data.quantity * quantity
        );
      }

      data.operations?.forEach((operation) => {
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

    walkTree(methodTree);

    return effects;
  }, [methodTree]);

  const getCosts = useCallback(
    (quantity: number) => {
      const materialCost = costEffects.materialCost.reduce(
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

const QuoteLineCosting = ({
  methodTree,
  operations,
}: {
  methodTree?: Tree<QuoteMethod>;
  operations: QuotationOperation[];
}) => {
  const getLineCosts = useLineCosts({ methodTree, operations });
  const [quantities] = useState([1, 25, 50, 100]);

  const quantityCosts = quantities.map((quantity) => ({
    quantity,
    costs: getLineCosts(quantity),
  }));

  // TODO: factor in default currency or quote currency
  const formatter = useMemo(
    () =>
      new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }),
    []
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Costing</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <Thead>
            <Tr>
              <Th />
              {quantities.map((quantity) => (
                <Th key={quantity.toString()} className="font-mono">
                  {quantity}
                </Th>
              ))}
            </Tr>
          </Thead>
          <Tbody>
            <Tr>
              <Td className="border-r border-border">
                <HStack className="w-full justify-between ">
                  <span>Total Raw Material</span>
                  <Enumerable value="Material" />
                </HStack>
              </Td>
              {quantityCosts.map(({ quantity, costs }) => {
                return (
                  <Td key={quantity.toString()} className="font-mono">
                    <VStack spacing={0}>
                      <span>
                        {costs.materialCost
                          ? formatter.format(costs.materialCost)
                          : formatter.format(0)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {costs.materialCost && quantity > 0
                          ? formatter.format(costs.materialCost / quantity)
                          : formatter.format(0)}
                      </span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>
            <Tr>
              <Td className="border-r border-border">
                <HStack className="w-full justify-between ">
                  <span>Total Labor &amp; Overhead</span>
                  <Enumerable value="Labor" />
                </HStack>
              </Td>
              {quantityCosts.map(({ quantity, costs }) => {
                return (
                  <Td key={quantity.toString()} className="font-mono">
                    <VStack spacing={0}>
                      <span>
                        {costs.overheadCost
                          ? formatter.format(
                              costs.overheadCost + costs.laborCost
                            )
                          : formatter.format(0)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {costs.overheadCost && quantity > 0
                          ? formatter.format(
                              (costs.overheadCost + costs.laborCost) / quantity
                            )
                          : formatter.format(0)}
                      </span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>
            {/* <Tr>
              <Td className="border-r border-border">
                <HStack className="w-full justify-between ">
                  <span>Total Outside Processing</span>
                  <Enumerable value="Subcontract" />
                </HStack>
              </Td>
              {quantityCosts.map(({ quantity, costs }) => {
                return (
                  <Td key={quantity.toString()} className="font-mono">
                    <VStack spacing={0}>
                      <span>
                        {costs.outsideCost
                          ? formatter.format(costs.outsideCost)
                          : formatter.format(0)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {costs.outsideCost && quantity > 0
                          ? formatter.format(costs.outsideCost / quantity)
                          : formatter.format(0)}
                      </span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr> */}
            <Tr className="font-bold">
              <Td className="border-r border-border">
                <HStack className="w-full justify-between ">
                  <span>Total Cost</span>
                </HStack>
              </Td>
              {quantityCosts.map(({ quantity, costs }) => {
                const totalCost =
                  // costs.materialCost +
                  costs.laborCost + costs.overheadCost + costs.outsideCost;
                return (
                  <Td key={quantity.toString()} className="font-mono">
                    <VStack spacing={0}>
                      <span>
                        {totalCost
                          ? formatter.format(totalCost)
                          : formatter.format(0)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {totalCost && quantity > 0
                          ? formatter.format(totalCost / quantity)
                          : formatter.format(0)}
                      </span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>
          </Tbody>
          <Tfoot>
            {/* <Tr className="font-bold">
              <Td className="border-r border-border" />
              {quantityCosts.map(({ quantity }) => (
                <Td key={quantity} className="font-mono">
                  <Button variant="secondary">Add</Button>
                </Td>
              ))}
            </Tr> */}
          </Tfoot>
        </Table>
      </CardContent>
    </Card>
  );
};

export default QuoteLineCosting;
