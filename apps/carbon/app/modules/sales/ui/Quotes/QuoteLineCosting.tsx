import {
  Badge,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  VStack,
} from "@carbon/react";
import { useLocale } from "@react-aria/i18n";
import { useParams } from "@remix-run/react";
import { useMemo } from "react";
import { LuInfo } from "react-icons/lu";
import { MethodItemTypeIcon } from "~/modules/shared";
import type { Costs } from "../../types";

const QuoteLineCosting = ({
  quantities,
  getLineCosts,
}: {
  quantities: number[];

  getLineCosts: (quantity: number) => Costs;
}) => {
  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const quantityCosts = quantities.map((quantity) => ({
    quantity,
    costs: getLineCosts(quantity),
  }));

  // TODO: factor in default currency or quote currency
  const { locale } = useLocale();
  const formatter = useMemo(
    () => new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }),
    [locale]
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
              <Td className="border-r border-border ">
                <HStack className="w-full justify-between ">
                  <span>Total Material Cost</span>
                  <Enumerable value="Material" />
                </HStack>
              </Td>
              {quantityCosts.map(({ quantity, costs }, index) => {
                const totalMaterialCost =
                  costs.materialCost +
                  costs.partCost +
                  costs.toolCost +
                  costs.fixtureCost +
                  costs.consumableCost +
                  costs.serviceCost;

                return (
                  <Td key={quantity.toString()}>
                    <VStack spacing={0}>
                      <span>
                        {totalMaterialCost
                          ? formatter.format(totalMaterialCost)
                          : formatter.format(0)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {totalMaterialCost && quantity > 0
                          ? formatter.format(totalMaterialCost / quantity)
                          : formatter.format(0)}
                      </span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>
            <Tr>
              <Td className="border-r border-border pl-10 ">
                <HStack className="w-full justify-between ">
                  <span className="whitespace-nowrap flex items-center justify-start gap-2">
                    Part Cost{" "}
                    <Tooltip>
                      <TooltipTrigger>
                        <LuInfo className="w-4 h-4" />
                      </TooltipTrigger>
                      <TooltipContent>
                        Includes bought and picked parts
                      </TooltipContent>
                    </Tooltip>
                  </span>
                  <Badge variant="secondary">
                    <MethodItemTypeIcon type="Part" />
                  </Badge>
                </HStack>
              </Td>
              {quantityCosts.map(({ quantity, costs }) => {
                return (
                  <Td key={quantity.toString()}>
                    <VStack spacing={0}>
                      <span>
                        {costs.partCost
                          ? formatter.format(costs.partCost)
                          : formatter.format(0)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {costs.partCost && quantity > 0
                          ? formatter.format(costs.partCost / quantity)
                          : formatter.format(0)}
                      </span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>
            <Tr>
              <Td className="border-r border-border pl-10 ">
                <HStack className="w-full justify-between ">
                  <span className="whitespace-nowrap">Material Cost</span>
                  <Badge variant="secondary">
                    <MethodItemTypeIcon type="Material" />
                  </Badge>
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
              <Td className="border-r border-border pl-10 ">
                <HStack className="w-full justify-between ">
                  <span className="whitespace-nowrap">Tooling Cost</span>
                  <Badge variant="secondary">
                    <MethodItemTypeIcon type="Tool" />
                  </Badge>
                </HStack>
              </Td>
              {quantityCosts.map(({ quantity, costs }) => {
                return (
                  <Td key={quantity.toString()}>
                    <VStack spacing={0}>
                      <span>
                        {costs.toolCost
                          ? formatter.format(costs.toolCost)
                          : formatter.format(0)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {costs.toolCost && quantity > 0
                          ? formatter.format(costs.toolCost / quantity)
                          : formatter.format(0)}
                      </span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>
            <Tr>
              <Td className="border-r border-border pl-10 ">
                <HStack className="w-full justify-between ">
                  <span className="whitespace-nowrap">Fixture Cost</span>
                  <Badge variant="secondary">
                    <MethodItemTypeIcon type="Fixture" />
                  </Badge>
                </HStack>
              </Td>
              {quantityCosts.map(({ quantity, costs }) => {
                return (
                  <Td key={quantity.toString()}>
                    <VStack spacing={0}>
                      <span>
                        {costs.fixtureCost
                          ? formatter.format(costs.fixtureCost)
                          : formatter.format(0)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {costs.fixtureCost && quantity > 0
                          ? formatter.format(costs.fixtureCost / quantity)
                          : formatter.format(0)}
                      </span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>
            <Tr>
              <Td className="border-r border-border pl-10 ">
                <HStack className="w-full justify-between ">
                  <span className="whitespace-nowrap">Consumable Cost</span>
                  <Badge variant="secondary">
                    <MethodItemTypeIcon type="Consumable" />
                  </Badge>
                </HStack>
              </Td>
              {quantityCosts.map(({ quantity, costs }) => {
                return (
                  <Td key={quantity.toString()}>
                    <VStack spacing={0}>
                      <span>
                        {costs.consumableCost
                          ? formatter.format(costs.consumableCost)
                          : formatter.format(0)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {costs.consumableCost && quantity > 0
                          ? formatter.format(costs.consumableCost / quantity)
                          : formatter.format(0)}
                      </span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>
            <Tr>
              <Td className="border-r border-border pl-10 ">
                <HStack className="w-full justify-between ">
                  <span className="whitespace-nowrap">Service Cost</span>
                  <Badge variant="secondary">
                    <MethodItemTypeIcon type="Service" />
                  </Badge>
                </HStack>
              </Td>
              {quantityCosts.map(({ quantity, costs }) => {
                return (
                  <Td key={quantity.toString()}>
                    <VStack spacing={0}>
                      <span>
                        {costs.serviceCost
                          ? formatter.format(costs.serviceCost)
                          : formatter.format(0)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {costs.serviceCost && quantity > 0
                          ? formatter.format(costs.serviceCost / quantity)
                          : formatter.format(0)}
                      </span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>
            <Tr>
              <Td className="border-r border-border ">
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
              <Td className="border-r border-border ">
                <HStack className="w-full justify-between ">
                  <span>Total Outside Processing</span>
                  <Enumerable value="Subcontract" />
                </HStack>
              </Td>
              {quantityCosts.map(({ quantity, costs }) => {
                return (
                  <Td key={quantity.toString()}  >
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

            <Tr className="font-bold ">
              <Td className="border-r border-border ">
                <HStack className="w-full justify-between ">
                  <span>Total Estimated Cost</span>
                  <Enumerable value="Total" />
                </HStack>
              </Td>
              {quantityCosts.map(({ quantity, costs }) => {
                const totalCost =
                  costs.materialCost +
                  costs.partCost +
                  costs.toolCost +
                  costs.fixtureCost +
                  costs.consumableCost +
                  costs.serviceCost +
                  costs.laborCost +
                  costs.overheadCost +
                  costs.outsideCost;
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
