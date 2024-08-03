import type { Json } from "@carbon/database";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Enumerable,
  HStack,
  Input,
  NumberField,
  NumberInput,
  Table,
  Tbody,
  Td,
  Tfoot,
  Th,
  Thead,
  Tr,
  VStack,
} from "@carbon/react";
import { useFetcher, useParams } from "@remix-run/react";
import { useCallback, useMemo } from "react";
import { LuPlus, LuTrash } from "react-icons/lu";
import type { z } from "zod";
import type { Tree } from "~/components/TreeView";
import {
  quoteLineAdditionalChargesValidator,
  type QuotationOperation,
  type QuoteMethod,
} from "~/modules/sales";
import { path } from "~/utils/path";

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
  quantities,
  additionalCharges: additionalChargesJson,
}: {
  methodTree?: Tree<QuoteMethod>;
  operations: QuotationOperation[];
  quantities: number[];
  additionalCharges?: Json;
}) => {
  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const fetcher = useFetcher<{ id: string }>();
  const getLineCosts = useLineCosts({ methodTree, operations });

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

  const additionalCharges = useMemo(() => {
    if (fetcher.formAction === path.to.quoteLineCost(quoteId, lineId)) {
      // get the optimistic update
      return JSON.parse(
        (fetcher.formData?.get("additionalCharges") as string) ?? "{}"
      ) as z.infer<typeof quoteLineAdditionalChargesValidator>;
    }
    const parsedAdditionalCharges =
      quoteLineAdditionalChargesValidator.safeParse(additionalChargesJson);

    return parsedAdditionalCharges.success ? parsedAdditionalCharges.data : {};
  }, [
    additionalChargesJson,
    fetcher.formAction,
    fetcher.formData,
    lineId,
    quoteId,
  ]);

  const additionalChargesByQuantity = quantities.map((quantity) => {
    const charges = Object.values(additionalCharges).reduce((acc, charge) => {
      const amount = charge.amounts?.[quantity] ?? 0;
      return acc + amount;
    }, 0);
    return charges;
  });

  const onUpdateChargeDescription = useCallback(
    (chargeId: string, description: string) => {
      const updatedCharges = {
        ...additionalCharges,
        [chargeId]: {
          ...additionalCharges[chargeId],
          description,
        },
      };

      const formData = new FormData();

      formData.set("additionalCharges", JSON.stringify(updatedCharges));
      fetcher.submit(formData, {
        method: "post",
        action: path.to.quoteLineCost(quoteId, lineId),
      });
    },
    [additionalCharges, fetcher, lineId, quoteId]
  );

  const onUpdateChargeAmount = useCallback(
    (chargeId: string, quantity: number, amount: number) => {
      const updatedCharges = {
        ...additionalCharges,
        [chargeId]: {
          ...additionalCharges[chargeId],
          amounts: {
            ...additionalCharges[chargeId].amounts,
            [quantity]: amount,
          },
        },
      };

      const formData = new FormData();
      formData.set("additionalCharges", JSON.stringify(updatedCharges));
      fetcher.submit(formData, {
        method: "post",
        action: path.to.quoteLineCost(quoteId, lineId),
      });
    },
    [additionalCharges, fetcher, lineId, quoteId]
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
              <Th className="w-[300px]" />
              {quantities.map((quantity) => (
                <Th key={quantity.toString()}>{quantity}</Th>
              ))}
            </Tr>
          </Thead>
          <Tbody>
            <Tr>
              <Td className="border-r border-border">
                <HStack className="w-full justify-between ">
                  <span className="whitespace-nowrap">Total Raw Material</span>
                  <Enumerable value="Material" />
                </HStack>
              </Td>
              {quantityCosts.map(({ quantity, costs }) => {
                return (
                  <Td key={quantity.toString()}>
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
                  <span className="whitespace-nowrap">
                    Total Labor &amp; Overhead
                  </span>
                  <Enumerable value="Labor" />
                </HStack>
              </Td>
              {quantityCosts.map(({ quantity, costs }) => {
                return (
                  <Td key={quantity.toString()}>
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
                  <Td key={quantity.toString()} >
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
            {Object.entries(additionalCharges).map(([chargeId, charge]) => {
              const isDeleting =
                fetcher.state === "loading" &&
                fetcher.formAction ===
                  path.to.deleteQuoteLineCost(quoteId, lineId) &&
                fetcher.formData?.get("id") === chargeId;
              return (
                <Tr key={chargeId}>
                  <Td className="border-r border-border">
                    <HStack className="w-full justify-between ">
                      <Input
                        defaultValue={charge.description}
                        size="sm"
                        className="border-0 -ml-3 shadow-none"
                        onBlur={(e) => {
                          if (e.target.value !== charge.description) {
                            onUpdateChargeDescription(chargeId, e.target.value);
                          }
                        }}
                      />
                      <HStack spacing={1}>
                        <fetcher.Form
                          method="post"
                          action={path.to.deleteQuoteLineCost(quoteId, lineId)}
                        >
                          <input type="hidden" name="id" value={chargeId} />
                          <input
                            type="hidden"
                            name="additionalCharges"
                            value={JSON.stringify(additionalCharges ?? {})}
                          />
                          <Button
                            type="submit"
                            aria-label="Delete"
                            size="sm"
                            variant="secondary"
                            isDisabled={isDeleting}
                            isLoading={isDeleting}
                          >
                            <LuTrash className="w-3 h-3" />
                          </Button>
                        </fetcher.Form>
                        <Enumerable value="Extra" />
                      </HStack>
                    </HStack>
                  </Td>
                  {quantityCosts.map(({ quantity }) => {
                    const amount = charge.amounts?.[quantity] ?? 0;
                    return (
                      <Td key={quantity.toString()}>
                        <VStack spacing={0}>
                          <NumberField
                            defaultValue={amount}
                            formatOptions={{
                              style: "currency",
                              currency: "USD",
                            }}
                            onChange={(value) => {
                              if (value !== amount) {
                                onUpdateChargeAmount(chargeId, quantity, value);
                              }
                            }}
                          >
                            <NumberInput
                              className="border-0 -ml-3 shadow-none"
                              size="sm"
                              min={0}
                            />
                          </NumberField>
                        </VStack>
                      </Td>
                    );
                  })}
                </Tr>
              );
            })}
            <Tr>
              <Td className="border-r border-border">
                <HStack className="w-full justify-between ">
                  <fetcher.Form
                    method="post"
                    action={path.to.newQuoteLineCost(quoteId, lineId)}
                  >
                    <input
                      type="hidden"
                      name="additionalCharges"
                      value={JSON.stringify(additionalCharges ?? {})}
                    />
                    <Button
                      className="-ml-3"
                      type="submit"
                      rightIcon={<LuPlus />}
                      variant="ghost"
                      isLoading={
                        fetcher.formAction ===
                          path.to.newQuoteLineCost(quoteId, lineId) &&
                        fetcher.state === "loading"
                      }
                      isDisabled={
                        fetcher.formAction ===
                          path.to.newQuoteLineCost(quoteId, lineId) &&
                        fetcher.state === "loading"
                      }
                    >
                      Add
                    </Button>
                  </fetcher.Form>
                </HStack>
              </Td>
              {quantityCosts.map(({ quantity }) => {
                return <Td key={quantity.toString()}></Td>;
              })}
            </Tr>
            <Tr className="font-bold">
              <Td className="border-r border-border">
                <HStack className="w-full justify-between ">
                  <span>Total Estimated Cost</span>
                  <Enumerable value="Total" />
                </HStack>
              </Td>
              {quantityCosts.map(({ quantity, costs }, index) => {
                const totalCost =
                  costs.materialCost +
                  costs.laborCost +
                  costs.overheadCost +
                  costs.outsideCost +
                  additionalChargesByQuantity[index];
                return (
                  <Td key={quantity.toString()}>
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
                <Td key={quantity} >
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
