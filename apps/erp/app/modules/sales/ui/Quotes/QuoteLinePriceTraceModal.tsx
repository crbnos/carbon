// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
  Spinner
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { LuRefreshCcw } from "react-icons/lu";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { repricedUnitPrice } from "../../sales.utils";
import type { QuoteLinePriceTrace } from "../../types";
import { PriceTraceTable } from "../Pricing/PriceTraceModal";

function repricedTo(price: QuoteLinePriceTrace, precision: number) {
  return repricedUnitPrice(price.currentTrace, price.unitPrice, precision);
}

type QuoteLinePriceTraceModalProps = {
  traces: QuoteLinePriceTrace[];
  isLoading: boolean;
  currencyCode: string;
  unitPricePrecision: number;
  isEditable: boolean;
  isRepricing: boolean;
  onReprice: () => void;
  onClose: () => void;
};

const QuoteLinePriceTraceModal = ({
  traces,
  isLoading,
  currencyCode,
  unitPricePrecision,
  isEditable,
  isRepricing,
  onReprice,
  onClose
}: QuoteLinePriceTraceModalProps) => {
  const unitPriceFormatter = useCurrencyFormatter({
    rate: true,
    currency: currencyCode,
    decimalPlaces: unitPricePrecision
  });

  const canReprice = traces.some(
    (price) => repricedTo(price, unitPricePrecision) !== null
  );

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="xxlarge">
        <ModalHeader>
          <ModalTitle>
            <Trans>Pricing Trace</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>How the unit price of each quantity was calculated.</Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner className="size-6" />
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {traces.map((price) => (
                <QuantityTrace
                  key={price.quantity}
                  price={price}
                  repricedPrice={repricedTo(price, unitPricePrecision)}
                  currencyCode={currencyCode}
                  format={(value) => unitPriceFormatter.format(value)}
                />
              ))}
            </div>
          )}
        </ModalBody>
        {isEditable && canReprice && (
          <ModalFooter>
            <Button
              leftIcon={<LuRefreshCcw />}
              isLoading={isRepricing}
              isDisabled={isRepricing}
              onClick={onReprice}
            >
              <Trans>Reprice with current rules</Trans>
            </Button>
          </ModalFooter>
        )}
      </ModalContent>
    </Modal>
  );
};

function QuantityTrace({
  price,
  repricedPrice,
  currencyCode,
  format
}: {
  price: QuoteLinePriceTrace;
  repricedPrice: number | null;
  currencyCode: string;
  format: (value: number) => string;
}) {
  const [showCurrent, setShowCurrent] = useState(false);
  const isManual = price.priceSource === "manual";
  // A system price with no stored trace was set before traces were recorded:
  // today's calculation is the only explanation there is.
  const trace = price.trace ?? (isManual ? null : price.currentTrace);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-semibold tabular-nums">
          <Trans>Quantity {price.quantity}</Trans>
        </h3>
        <span className="flex items-center gap-2 text-sm tabular-nums">
          {isManual && (
            <Badge variant="gray">
              <Trans>Manual</Trans>
            </Badge>
          )}
          {format(price.unitPrice)}
        </span>
      </div>
      {!isManual && !price.trace && price.currentTrace && (
        <p className="text-sm text-muted-foreground">
          <Trans>
            Priced before pricing traces were recorded — this is today's
            calculation.
          </Trans>
        </p>
      )}
      {trace ? (
        <PriceTraceTable trace={trace} currencyCode={currencyCode} />
      ) : (
        <p className="rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">
          {isManual ? (
            <Trans>
              This price was entered manually, so no pricing rules were applied.
            </Trans>
          ) : (
            <Trans>No pricing rules apply to this quantity.</Trans>
          )}
        </p>
      )}
      {repricedPrice !== null && (
        <div className="flex flex-col gap-2 rounded-lg bg-muted/60 px-4 py-3">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span>
              <Trans>
                Repricing with today's rules and costs gives{" "}
                <span className="font-medium tabular-nums">
                  {format(repricedPrice)}
                </span>
                .
              </Trans>
            </span>
            {price.trace && (
              <Button
                variant="link"
                size="sm"
                onClick={() => setShowCurrent((show) => !show)}
              >
                {showCurrent ? (
                  <Trans>Hide calculation</Trans>
                ) : (
                  <Trans>Show calculation</Trans>
                )}
              </Button>
            )}
          </div>
          {showCurrent && price.trace && price.currentTrace && (
            <PriceTraceTable
              trace={price.currentTrace}
              currencyCode={currencyCode}
            />
          )}
        </div>
      )}
    </section>
  );
}

export default QuoteLinePriceTraceModal;
