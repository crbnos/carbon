import {
  Badge,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Switch,
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
  useDisclosure,
  VStack,
} from "@carbon/react";
import { formatDurationHours } from "@carbon/utils";
import { useParams } from "@remix-run/react";
import { LuClock, LuInfo } from "react-icons/lu";
import { MethodItemTypeIcon, TimeTypeIcon } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useCurrencyFormatter } from "~/hooks";
import type { Costs } from "../../types";

const QuoteLineCosting = ({
  quantities,
  getLineCosts,
  unitPricePrecision,
}: {
  quantities: number[];
  getLineCosts: (quantity: number) => Costs;
  unitPricePrecision: number;
}) => {
  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const quantityCosts = quantities.map((quantity) => ({
    quantity,
    costs: getLineCosts(quantity),
  }));

  const formatter = useCurrencyFormatter();
  const unitCostFormatter = useCurrencyFormatter(undefined, unitPricePrecision);

  const detailsDisclosure = useDisclosure();

  return (
    <Card>
      <HStack className="justify-between items-start">
        <CardHeader>
          <CardTitle>Costing</CardTitle>
        </CardHeader>
        <CardAction>
          <div className="flex items-center space-x-2 py-2">
            <Switch
              variant="small"
              checked={detailsDisclosure.isOpen}
              onCheckedChange={detailsDisclosure.onToggle}
              id="cost-details"
            />
            <label className="text-sm" htmlFor="cost-details">
              Show Details
            </label>
          </div>
        </CardAction>
      </HStack>
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
                          ? unitCostFormatter.format(
                              totalMaterialCost / quantity
                            )
                          : unitCostFormatter.format(0)}
                      </span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>
            {detailsDisclosure.isOpen && (
              <>
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
                              ? unitCostFormatter.format(
                                  costs.partCost / quantity
                                )
                              : unitCostFormatter.format(0)}
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
                              ? unitCostFormatter.format(
                                  costs.materialCost / quantity
                                )
                              : unitCostFormatter.format(0)}
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
                              ? unitCostFormatter.format(
                                  costs.toolCost / quantity
                                )
                              : unitCostFormatter.format(0)}
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
                              ? unitCostFormatter.format(
                                  costs.consumableCost / quantity
                                )
                              : unitCostFormatter.format(0)}
                          </span>
                        </VStack>
                      </Td>
                    );
                  })}
                </Tr>
                {/* <Tr>
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
                              ? unitCostFormatter.format(
                                  costs.serviceCost / quantity
                                )
                              : unitCostFormatter.format(0)}
                          </span>
                        </VStack>
                      </Td>
                    );
                  })}
                </Tr> */}
              </>
            )}
            <Tr>
              <Td className="border-r border-border ">
                <HStack className="w-full justify-between ">
                  <span>Total Direct Cost</span>
                  <Enumerable value="Direct" />
                </HStack>
              </Td>
              {quantityCosts.map(({ quantity, costs }, index) => {
                const totalDirectCost =
                  (costs.laborCost ?? 0) + (costs.machineCost ?? 0);
                return (
                  <Td key={quantity.toString()}>
                    <VStack spacing={0}>
                      <span>{formatter.format(totalDirectCost)}</span>
                      <span className="text-muted-foreground text-xs">
                        {totalDirectCost && quantity > 0
                          ? unitCostFormatter.format(totalDirectCost / quantity)
                          : unitCostFormatter.format(0)}
                      </span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>

            {detailsDisclosure.isOpen && (
              <>
                <Tr>
                  <Td className="border-r border-border pl-10 ">
                    <HStack className="w-full justify-between ">
                      <span className="whitespace-nowrap flex items-center justify-start gap-2">
                        Labor Costs
                      </span>
                      <Badge variant="secondary">
                        <TimeTypeIcon type="Labor" />
                      </Badge>
                    </HStack>
                  </Td>
                  {quantityCosts.map(({ quantity, costs }) => {
                    return (
                      <Td key={quantity.toString()}>
                        <VStack spacing={0}>
                          <span>
                            {costs.laborCost
                              ? formatter.format(costs.laborCost)
                              : formatter.format(0)}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {costs.laborCost && quantity > 0
                              ? unitCostFormatter.format(
                                  costs.laborCost / quantity
                                )
                              : unitCostFormatter.format(0)}
                          </span>
                        </VStack>
                      </Td>
                    );
                  })}
                </Tr>
                <Tr>
                  <Td className="border-r border-border pl-14 ">
                    <HStack className="w-full justify-between ">
                      <span className="whitespace-nowrap flex items-center justify-start gap-2">
                        Labor Hours
                      </span>
                      <Badge variant="secondary">
                        <LuClock />
                      </Badge>
                    </HStack>
                  </Td>
                  {quantityCosts.map(({ quantity, costs }) => {
                    const laborHours =
                      (costs.laborHours ?? 0) + (costs.setupHours ?? 0);
                    return (
                      <Td key={quantity.toString()}>
                        <VStack spacing={0}>
                          <span>{formatDurationHours(laborHours)}</span>
                          <span className="text-muted-foreground text-xs">
                            {laborHours && quantity > 0
                              ? formatDurationHours(laborHours / quantity)
                              : formatDurationHours(0)}
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
                        Machine Costs
                      </span>
                      <Badge variant="secondary">
                        <TimeTypeIcon type="Machine" />
                      </Badge>
                    </HStack>
                  </Td>
                  {quantityCosts.map(({ quantity, costs }) => {
                    return (
                      <Td key={quantity.toString()}>
                        <VStack spacing={0}>
                          <span>
                            {costs.machineCost
                              ? formatter.format(costs.machineCost)
                              : formatter.format(0)}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {costs.machineCost && quantity > 0
                              ? unitCostFormatter.format(
                                  costs.machineCost / quantity
                                )
                              : unitCostFormatter.format(0)}
                          </span>
                        </VStack>
                      </Td>
                    );
                  })}
                </Tr>
                <Tr>
                  <Td className="border-r border-border pl-14 ">
                    <HStack className="w-full justify-between ">
                      <span className="whitespace-nowrap flex items-center justify-start gap-2">
                        Machine Hours
                      </span>
                      <Badge variant="secondary">
                        <LuClock />
                      </Badge>
                    </HStack>
                  </Td>
                  {quantityCosts.map(({ quantity, costs }) => {
                    const machineHours = costs.machineHours ?? 0;
                    return (
                      <Td key={quantity.toString()}>
                        <VStack spacing={0}>
                          <span>{formatDurationHours(machineHours)}</span>
                          <span className="text-muted-foreground text-xs">
                            {machineHours && quantity > 0
                              ? formatDurationHours(machineHours / quantity)
                              : formatDurationHours(0)}
                          </span>
                        </VStack>
                      </Td>
                    );
                  })}
                </Tr>
              </>
            )}
            <Tr>
              <Td className="border-r border-border ">
                <HStack className="w-full justify-between ">
                  <span>Total Indirect Cost</span>
                  <Enumerable value="Indirect" />
                </HStack>
              </Td>
              {quantityCosts.map(({ quantity, costs }, index) => {
                return (
                  <Td key={quantity.toString()}>
                    <VStack spacing={0}>
                      <span>
                        {costs.overheadCost
                          ? formatter.format(costs.overheadCost)
                          : formatter.format(0)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {costs.overheadCost && quantity > 0
                          ? unitCostFormatter.format(
                              costs.overheadCost / quantity
                            )
                          : unitCostFormatter.format(0)}
                      </span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>
            <Tr>
              <Td className="border-r border-border ">
                <HStack className="w-full justify-between ">
                  <span>Total Outside Cost</span>
                  <Enumerable value="Outside" />
                </HStack>
              </Td>
              {quantityCosts.map(({ quantity, costs }) => {
                return (
                  <Td key={quantity.toString()}>
                    <VStack spacing={0}>
                      <span>
                        {costs.outsideCost
                          ? formatter.format(costs.outsideCost)
                          : formatter.format(0)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {costs.outsideCost && quantity > 0
                          ? unitCostFormatter.format(
                              costs.outsideCost / quantity
                            )
                          : unitCostFormatter.format(0)}
                      </span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>

            <Tr className="font-bold ">
              <Td className="border-r border-border ">Total Estimated Cost</Td>
              {quantityCosts.map(({ quantity, costs }) => {
                const totalCost =
                  costs.consumableCost +
                  costs.laborCost +
                  costs.machineCost +
                  costs.materialCost +
                  costs.outsideCost +
                  costs.overheadCost +
                  costs.partCost +
                  costs.serviceCost +
                  costs.toolCost;
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
                          ? unitCostFormatter.format(totalCost / quantity)
                          : unitCostFormatter.format(0)}
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
