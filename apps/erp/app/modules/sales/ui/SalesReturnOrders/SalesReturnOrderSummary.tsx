import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  TruncatedTooltipText,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { motion } from "framer-motion";
import { LuImage } from "react-icons/lu";
import { Link, useParams } from "react-router";
import { CustomerAvatar, DateTime, MotionMoney } from "~/components";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePercentFormatter,
  useRouteData
} from "~/hooks";
import { getPrivateUrl, path } from "~/utils/path";
import type { SalesReturnOrder, SalesReturnOrderLine } from "./types";

const SalesReturnOrderSummary = () => {
  const { id: orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");

  const routeData = useRouteData<{
    salesReturnOrder: SalesReturnOrder;
    lines: SalesReturnOrderLine[];
  }>(path.to.salesReturnOrder(orderId));

  const lines = routeData?.lines ?? [];
  const currencyCode = routeData?.salesReturnOrder?.currencyCode ?? "USD";
  const formatter = useCurrencyFormatter({ currency: currencyCode });
  const percentFormatter = usePercentFormatter();
  // Settlement money at the document currency's configured decimals.
  const currencyDecimals = useCurrencyDecimals(currencyCode);

  const subtotal = lines.reduce(
    (acc, line) => acc + (line.quantity ?? 0) * (line.unitPrice ?? 0),
    0
  );
  const restockFee = lines.reduce(
    (acc, line) =>
      acc +
      (line.quantity ?? 0) *
        (line.unitPrice ?? 0) *
        (line.restockFeePercent ?? 0),
    0
  );
  const total = subtotal - restockFee;

  return (
    <Card>
      <CardHeader>
        <HStack className="justify-between items-center">
          <CardTitle>
            {routeData?.salesReturnOrder?.salesReturnOrderId}
          </CardTitle>
          <div className="flex flex-col gap-1 items-end">
            <CustomerAvatar
              customerId={routeData?.salesReturnOrder?.customerId ?? null}
            />
            {routeData?.salesReturnOrder?.orderDate && (
              <span className="text-xs text-muted-foreground tracking-tight">
                <Trans>Ordered</Trans>{" "}
                <DateTime
                  value={routeData.salesReturnOrder.orderDate}
                  variant="date"
                />
              </span>
            )}
          </div>
        </HStack>
      </CardHeader>
      <CardContent>
        <VStack spacing={8} className="w-full overflow-hidden">
          {lines.length === 0 && (
            <p className="text-sm text-muted-foreground py-6">
              <Trans>No lines yet</Trans>
            </p>
          )}
          {lines.map((line) => {
            if (!line.id) return null;
            const lineCredit =
              (line.quantity ?? 0) *
              (line.unitPrice ?? 0) *
              (1 - (line.restockFeePercent ?? 0));

            return (
              <motion.div
                key={line.id}
                initial={{ opacity: 0, y: 50 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="border-b border-input py-6 w-full"
              >
                <HStack spacing={4} className="items-start">
                  {line.item?.thumbnailPath ? (
                    <img
                      alt={line.item?.readableIdWithRevision ?? ""}
                      className="w-24 h-24 shrink-0 bg-gradient-to-bl from-muted to-muted/40 rounded-lg"
                      src={getPrivateUrl(line.item.thumbnailPath)}
                    />
                  ) : (
                    <div className="w-24 h-24 shrink-0 bg-gradient-to-bl from-muted to-muted/40 rounded-lg p-4">
                      <LuImage className="w-16 h-16 text-muted-foreground" />
                    </div>
                  )}

                  <VStack spacing={0} className="flex-1 min-w-0">
                    <div className="flex items-center justify-between w-full">
                      <VStack spacing={0} className="flex-1 min-w-0">
                        <HStack spacing={2} className="flex min-w-0 w-full">
                          <Heading className="truncate">
                            {line.item?.readableIdWithRevision}
                          </Heading>
                          <Button
                            asChild
                            variant="link"
                            size="sm"
                            className="text-muted-foreground flex-shrink-0"
                          >
                            <Link
                              to={path.to.salesReturnOrderLine(
                                orderId,
                                line.id
                              )}
                            >
                              <Trans>Edit</Trans>
                            </Link>
                          </Button>
                        </HStack>
                        <TruncatedTooltipText
                          className="text-muted-foreground text-sm truncate w-full"
                          tooltip={line.item?.name ?? ""}
                        >
                          {line.item?.name}
                        </TruncatedTooltipText>
                      </VStack>
                      <VStack
                        spacing={2}
                        className="flex-shrink-0 items-end w-auto"
                      >
                        <MotionMoney
                          value={lineCredit}
                          currency={currencyCode}
                          decimalPlaces={currencyDecimals}
                        />
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="tabular-nums">
                            {line.quantityReceived ?? 0} / {line.quantity ?? 0}
                          </Badge>
                          <Badge variant="green">
                            {formatter.format(line.unitPrice ?? 0)}{" "}
                            {line.unitOfMeasureCode}
                          </Badge>
                          {(line.restockFeePercent ?? 0) > 0 && (
                            <Badge variant="red">
                              {percentFormatter.format(
                                line.restockFeePercent ?? 0
                              )}{" "}
                              <Trans>Restock</Trans>
                            </Badge>
                          )}
                          {line.disposition &&
                            line.disposition !== "Pending" && (
                              <Badge variant="secondary">
                                {line.disposition}
                              </Badge>
                            )}
                        </div>
                      </VStack>
                    </div>
                  </VStack>
                </HStack>
              </motion.div>
            );
          })}
        </VStack>

        <VStack spacing={2} className="mt-8">
          <HStack className="justify-between text-sm text-muted-foreground w-full">
            <span>
              <Trans>Subtotal:</Trans>
            </span>
            <MotionMoney
              value={subtotal}
              currency={currencyCode}
              decimalPlaces={currencyDecimals}
            />
          </HStack>
          {restockFee > 0 && (
            <HStack className="justify-between text-sm text-muted-foreground w-full">
              <span>
                <Trans>Restocking fee:</Trans>
              </span>
              <MotionMoney
                value={-restockFee}
                currency={currencyCode}
                decimalPlaces={currencyDecimals}
              />
            </HStack>
          )}
          <HStack className="justify-between text-xl font-semibold w-full">
            <span>
              <Trans>Total:</Trans>
            </span>
            <MotionMoney
              value={total}
              currency={currencyCode}
              decimalPlaces={currencyDecimals}
            />
          </HStack>
        </VStack>
      </CardContent>
    </Card>
  );
};

export default SalesReturnOrderSummary;
