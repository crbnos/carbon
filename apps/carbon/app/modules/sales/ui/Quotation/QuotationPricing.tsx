import {
  Button,
  Card,
  CardContent,
  CardFooter,
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
import { ValidatedForm } from "@carbon/remix-validated-form";
import { useParams } from "@remix-run/react";
import { useMemo, useState } from "react";
import type { z } from "zod";
import { Hidden, Number, NumberControlled, Submit } from "~/components/Form";
import {
  getLinePriceUpdate,
  quotationPricingValidator,
  useQuotationLinePriceEffects,
} from "~/modules/sales";
import { path } from "~/utils/path";

type QuotationPricingProps = {
  initialValues: z.infer<typeof quotationPricingValidator>;
  isMade: boolean;
};

export default function QuotationPricing({
  initialValues,
  isMade,
}: QuotationPricingProps) {
  const linePriceEffects = useQuotationLinePriceEffects();

  const { id, lineId } = useParams();
  if (!id) throw new Error("id not found");
  if (!lineId) throw new Error("lineId not found");

  const [quantities] = useState([1, 25, 50, 100]);
  const [state, setState] = useState({
    quantity: initialValues.quantity ?? 1,
    unitCost: initialValues.unitCost ?? 0,
    discountPercent: initialValues.discountPercent ?? 0,
    markupPercent: initialValues.markupPercent ?? 0,
    extendedPrice: initialValues.extendedPrice ?? 0,
  });

  const quantityPriceEffects = useMemo(
    () =>
      quantities.map((quantity) => {
        const effects = linePriceEffects.effects[lineId];
        return {
          quantity,
          effects: getLinePriceUpdate(quantity, effects),
        };
      }),
    [lineId, linePriceEffects.effects, quantities]
  );

  const onAdd = ({
    quantity,
    effects,
  }: (typeof quantityPriceEffects)[number]) => {
    const totalCost =
      effects.materialCost +
      effects.laborCost +
      effects.overheadCost +
      effects.outsideCost;
    const unitCost = totalCost / quantity;

    setState((prevState) => ({
      ...prevState,
      quantity,
      unitCost,
      extendedPrice:
        totalCost +
        totalCost * (prevState.markupPercent / 100) -
        totalCost * (prevState.discountPercent / 100),
    }));
  };

  // TODO: factor in default currency, po currency and exchange rate
  const formatter = useMemo(
    () =>
      new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }),
    []
  );

  return (
    <>
      {isMade && (
        <Card>
          <HStack className="justify-between items-start">
            <CardHeader>
              <CardTitle>Costing</CardTitle>
            </CardHeader>
            {/* <CardAction>
            <IconButton
            variant="secondary"
            icon={<BsThreeDotsVertical />}
            aria-label="Options"
            />
          </CardAction> */}
          </HStack>
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
                  {quantityPriceEffects.map(({ quantity, effects }) => {
                    return (
                      <Td key={quantity.toString()} className="font-mono">
                        <VStack spacing={0}>
                          <span>
                            {effects.materialCost
                              ? formatter.format(effects.materialCost)
                              : formatter.format(0)}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {effects.materialCost && quantity > 0
                              ? formatter.format(
                                  effects.materialCost / quantity
                                )
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
                  {quantityPriceEffects.map(({ quantity, effects }) => {
                    return (
                      <Td key={quantity.toString()} className="font-mono">
                        <VStack spacing={0}>
                          <span>
                            {effects.overheadCost
                              ? formatter.format(
                                  effects.overheadCost + effects.laborCost
                                )
                              : formatter.format(0)}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {effects.overheadCost && quantity > 0
                              ? formatter.format(
                                  (effects.overheadCost + effects.laborCost) /
                                    quantity
                                )
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
                      <span>Total Outside Processing</span>
                      <Enumerable value="Subcontract" />
                    </HStack>
                  </Td>
                  {quantityPriceEffects.map(({ quantity, effects }) => {
                    return (
                      <Td key={quantity.toString()} className="font-mono">
                        <VStack spacing={0}>
                          <span>
                            {effects.outsideCost
                              ? formatter.format(effects.outsideCost)
                              : formatter.format(0)}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {effects.outsideCost && quantity > 0
                              ? formatter.format(effects.outsideCost / quantity)
                              : formatter.format(0)}
                          </span>
                        </VStack>
                      </Td>
                    );
                  })}
                </Tr>
                <Tr className="font-bold">
                  <Td className="border-r border-border">
                    <HStack className="w-full justify-between ">
                      <span>Total Cost</span>
                    </HStack>
                  </Td>
                  {quantityPriceEffects.map(({ quantity, effects }) => {
                    const totalCost =
                      effects.materialCost +
                      effects.laborCost +
                      effects.overheadCost +
                      effects.outsideCost;
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
                <Tr className="font-bold">
                  <Td className="border-r border-border" />
                  {quantityPriceEffects.map((quantityEffect) => (
                    <Td key={quantityEffect.quantity} className="font-mono">
                      <Button
                        variant="secondary"
                        onClick={() => onAdd(quantityEffect)}
                      >
                        Add
                      </Button>
                    </Td>
                  ))}
                </Tr>
              </Tfoot>
            </Table>
          </CardContent>
        </Card>
      )}

      <ValidatedForm
        validator={quotationPricingValidator}
        defaultValues={initialValues}
        method="post"
        action={path.to.quoteLine(id, lineId)}
        className="w-full"
      >
        <Card>
          <CardHeader>
            <CardTitle>Pricing</CardTitle>
          </CardHeader>
          <CardContent>
            <Hidden name="intent" value="pricing" />
            <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
              <NumberControlled
                name="quantity"
                label="Quantity"
                value={state.quantity}
                onChange={(quantity) =>
                  setState((prevState) => ({
                    ...prevState,
                    quantity,
                    extendedPrice:
                      prevState.unitCost *
                        quantity *
                        (1 + prevState.markupPercent / 100) -
                      prevState.unitCost *
                        quantity *
                        (prevState.discountPercent / 100),
                  }))
                }
              />
              <NumberControlled
                name="unitCost"
                label="Unit Cost"
                value={state.unitCost}
                onChange={(unitCost) =>
                  setState((prevState) => ({
                    ...prevState,
                    unitCost,
                    extendedPrice:
                      unitCost *
                        prevState.quantity *
                        (1 + prevState.markupPercent / 100) -
                      unitCost *
                        prevState.quantity *
                        (prevState.discountPercent / 100),
                  }))
                }
                formatOptions={{ style: "currency", currency: "USD" }}
              />
              <Number name="leadTime" label="Lead Time (Days)" />
              <NumberControlled
                name="discountPercent"
                label="Discount %"
                value={state.discountPercent}
                onChange={(discountPercent) =>
                  setState((prevState) => ({
                    ...prevState,
                    discountPercent,
                    extendedPrice:
                      prevState.unitCost *
                        prevState.quantity *
                        (1 + prevState.markupPercent / 100) -
                      prevState.unitCost *
                        prevState.quantity *
                        (discountPercent / 100),
                  }))
                }
              />
              <NumberControlled
                name="markupPercent"
                label="Markup %"
                value={state.markupPercent}
                onChange={(markupPercent) =>
                  setState((prevState) => ({
                    ...prevState,
                    markupPercent,
                    extendedPrice:
                      prevState.unitCost *
                        prevState.quantity *
                        (1 + markupPercent / 100) -
                      prevState.unitCost *
                        prevState.quantity *
                        (prevState.discountPercent / 100),
                  }))
                }
              />
              <NumberControlled
                name="extendedPrice"
                label="Extended Price"
                value={state.extendedPrice}
                isReadOnly
                formatOptions={{ style: "currency", currency: "USD" }}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Submit>Save</Submit>
          </CardFooter>
        </Card>
      </ValidatedForm>
    </>
  );
}
