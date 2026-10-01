// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import {
  Badge,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { equals, round } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useCurrencyFormatter } from "~/hooks";
import { path } from "~/utils/path";
import { buildPriceTraceMatrix } from "../../sales.utils";
import type {
  PriceTraceStep,
  QuotationPrice,
  QuoteLinePriceTrace
} from "../../types";
import {
  DeltaPill,
  PriceTraceStepSource,
  StepTypeBadge
} from "../Pricing/PriceTraceModal";

const logger = getLogger("erp", "sales", "quote-price-trace");

// Null when the traces could not be loaded; the failure is already logged.
export async function fetchQuoteLinePriceTraces(input: {
  quoteId: string;
  quoteLineId: string;
  rollupPrices: Record<number, number>;
}): Promise<QuoteLinePriceTrace[] | null> {
  try {
    const response = await fetch(path.to.api.salesQuoteLinePriceTrace, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      logger.error("Failed to load quote line price traces", {
        quoteLineId: input.quoteLineId,
        status: response.status
      });
      return null;
    }
    const result: { traces: QuoteLinePriceTrace[] | null } =
      await response.json();
    return result.traces;
  } catch (error) {
    logger.error("Failed to load quote line price traces", {
      quoteLineId: input.quoteLineId,
      error
    });
    return null;
  }
}

type QuotePriceTraceModalProps = {
  quoteId: string;
  lineId: string;
  quantities: number[];
  /** The grid's live prices: the quoted unit price and whether it was typed. */
  prices: Record<number, QuotationPrice>;
  /** Cost-plus price per quantity, as the grid computes it. */
  rollupPrices: Record<number, number>;
  currencyCode: string;
  unitPricePrecision: number;
  onClose: () => void;
};

const QuotePriceTraceModal = ({
  quoteId,
  lineId,
  quantities,
  prices,
  rollupPrices,
  currencyCode,
  unitPricePrecision,
  onClose
}: QuotePriceTraceModalProps) => {
  const formatter = useCurrencyFormatter({
    rate: true,
    currency: currencyCode,
    decimalPlaces: unitPricePrecision
  });
  const format = (value: number) => formatter.format(value);

  const [traces, setTraces] = useState<QuoteLinePriceTrace[] | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">(
    "loading"
  );

  // The explanation is of the prices as they stand when the modal opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    let stale = false;
    fetchQuoteLinePriceTraces({
      quoteId,
      quoteLineId: lineId,
      rollupPrices
    }).then((result) => {
      if (stale) return;
      setTraces(result);
      setStatus(result ? "ready" : "error");
    });
    return () => {
      stale = true;
    };
  }, []);

  // A manual price was typed, so the rules had no part in it and its column
  // carries no trace.
  const columns = quantities.map((quantity) => {
    const isManual = prices[quantity]?.priceSource === "manual";
    return {
      quantity,
      isManual,
      quotedPrice: prices[quantity]?.unitPrice,
      trace: isManual
        ? null
        : (traces?.find((t) => t.quantity === quantity)?.trace ?? null)
    };
  });

  const rows = buildPriceTraceMatrix(columns);
  const stepRows = rows.filter((row) => row.step.step !== "Final Price");
  const finalByQuantity =
    rows.find((row) => row.step.step === "Final Price")?.byQuantity ?? {};

  const isOutdated = (column: (typeof columns)[number]) => {
    const final = finalByQuantity[column.quantity];
    return (
      final !== undefined &&
      column.quotedPrice !== undefined &&
      column.quotedPrice !== null &&
      !equals(round(final.amount, unitPricePrecision), column.quotedPrice)
    );
  };

  const anyManual = columns.some((column) => column.isManual);
  const anyOutdated = columns.some(isOutdated);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size={quantities.length > 4 ? "xxlarge" : "xlarge"}>
        <ModalHeader>
          <ModalTitle>
            <Trans>Pricing Trace</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>How the unit price for each quantity was calculated.</Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          {status === "loading" ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <Spinner className="size-6" />
              <p className="text-sm text-muted-foreground">
                <Trans>Calculating prices…</Trans>
              </p>
            </div>
          ) : status === "error" ? (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-4 text-destructive">
              <LuTriangleAlert className="mt-0.5 size-4 shrink-0" />
              <p className="text-sm font-medium">
                <Trans>Could not explain these prices</Trans>
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <Thead>
                    <Tr>
                      <Th className="w-[300px]">
                        <Trans>Quantity</Trans>
                      </Th>
                      {columns.map((column) => (
                        <Th key={column.quantity} className="whitespace-nowrap">
                          <span className="inline-flex items-center gap-2 tabular-nums">
                            {column.quantity}
                            {column.isManual && (
                              <Badge variant="gray">
                                <Trans>Manual</Trans>
                              </Badge>
                            )}
                          </span>
                        </Th>
                      ))}
                    </Tr>
                  </Thead>
                  <Tbody>
                    {stepRows.map((row) => (
                      <Tr key={row.key}>
                        <Td className="border-r border-border">
                          <div className="flex max-w-[300px] items-center gap-2">
                            <StepTypeBadge step={row.step} />
                            <span
                              className="min-w-0 text-sm text-muted-foreground"
                              title={row.step.source}
                            >
                              <PriceTraceStepSource step={row.step} />
                            </span>
                          </div>
                        </Td>
                        {columns.map((column) => (
                          <Td
                            key={column.quantity}
                            className="whitespace-nowrap"
                          >
                            <StepCell
                              step={row.byQuantity[column.quantity]}
                              format={format}
                            />
                          </Td>
                        ))}
                      </Tr>
                    ))}
                    <Tr className="font-semibold [&>td]:bg-muted/60">
                      <Td className="border-r border-border">
                        <Trans>Final Price</Trans>
                      </Td>
                      {columns.map((column) => {
                        const final = finalByQuantity[column.quantity];
                        const quoted = column.quotedPrice ?? undefined;
                        return (
                          <Td
                            key={column.quantity}
                            className="whitespace-nowrap tabular-nums"
                          >
                            {final ? (
                              <div className="flex flex-col gap-0.5">
                                <span>
                                  {format(
                                    round(final.amount, unitPricePrecision)
                                  )}
                                </span>
                                {isOutdated(column) && quoted !== undefined && (
                                  <span className="text-xs font-normal text-muted-foreground">
                                    <Trans>Quoted at {format(quoted)}</Trans>
                                  </span>
                                )}
                              </div>
                            ) : quoted !== undefined ? (
                              format(quoted)
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </Td>
                        );
                      })}
                    </Tr>
                  </Tbody>
                </Table>
              </div>
              {(anyManual || anyOutdated) && (
                <ul className="mt-4 flex flex-col gap-0.5 text-xs text-muted-foreground text-pretty">
                  {anyManual && (
                    <li>
                      <Trans>
                        A manual price was entered directly, so the pricing
                        rules are not applied to it.
                      </Trans>
                    </li>
                  )}
                  {anyOutdated && (
                    <li>
                      <Trans>
                        A quoted price differs from the final price when the
                        pricing rules or the line's costs changed after it was
                        set.
                      </Trans>
                    </li>
                  )}
                </ul>
              )}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Close</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

// What a step did at one quantity: its change, then the running price.
function StepCell({
  step,
  format
}: {
  step: PriceTraceStep | undefined;
  format: (value: number) => string;
}) {
  if (!step) return <span className="text-muted-foreground">—</span>;
  if (step.adjustment === undefined) {
    return <span className="text-sm tabular-nums">{format(step.amount)}</span>;
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <DeltaPill value={step.adjustment} format={format} />
      <span className="text-xs text-muted-foreground tabular-nums">
        {format(step.amount)}
      </span>
    </div>
  );
}

export default QuotePriceTraceModal;
