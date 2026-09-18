import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  NumberField,
  NumberInput,
  ScrollArea,
  useMount,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { useFetcher, useParams } from "react-router";
import {
  useCurrencyFormatter,
  usePercentFormatter,
  useQuantityFormatter
} from "~/hooks";
import type { loader as creditLoader } from "~/routes/x+/sales-return-order+/$id.credit";
import { path } from "~/utils/path";

type SalesReturnOrderCreditModalProps = {
  currencyCode?: string;
  onClose: () => void;
};

const SalesReturnOrderCreditModal = ({
  currencyCode,
  onClose
}: SalesReturnOrderCreditModalProps) => {
  const { id: orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");

  const currencyFormatter = useCurrencyFormatter({ currency: currencyCode });
  const percentFormatter = usePercentFormatter();
  const quantityFormatter = useQuantityFormatter();

  const loadFetcher = useFetcher<typeof creditLoader>();
  const submitFetcher = useFetcher<{ success: boolean }>();

  useMount(() => {
    loadFetcher.load(path.to.salesReturnOrderCredit(orderId));
  });

  const lines = (loadFetcher.data?.lines ?? []).filter(
    (line) => line.creditableQuantity > 0
  );

  // salesReturnOrderLineId -> quantity to credit. Defaults to the full
  // creditable pool per line; clamping here is UX only — the authoritative cap
  // is the row-locked validation inside createSalesReturnOrderCredit.
  const [quantities, setQuantities] = useState<Record<string, number> | null>(
    null
  );
  const selected =
    quantities ??
    Object.fromEntries(
      lines.map((line) => [
        line.salesReturnOrderLineId,
        line.creditableQuantity
      ])
    );

  const setQuantity = (
    salesReturnOrderLineId: string,
    value: number,
    creditableQuantity: number
  ) => {
    const clamped = Math.max(
      0,
      Math.min(Number.isFinite(value) ? value : 0, creditableQuantity)
    );
    setQuantities({ ...selected, [salesReturnOrderLineId]: clamped });
  };

  const amountFor = (line: (typeof lines)[number]) => {
    const quantity = selected[line.salesReturnOrderLineId] ?? 0;
    return quantity * line.unitPrice * (1 - line.restockFeePercent);
  };

  const total = lines.reduce((acc, line) => acc + amountFor(line), 0);

  const payload = lines
    .map((line) => ({
      salesReturnOrderLineId: line.salesReturnOrderLineId,
      quantity: selected[line.salesReturnOrderLineId] ?? 0
    }))
    .filter((line) => line.quantity > 0);

  const isLoading = loadFetcher.state !== "idle" && !loadFetcher.data;
  const isSubmitting = submitFetcher.state !== "idle";

  // The action redirects on success (fetcher.data stays undefined) and
  // returns { success: false } on failure — close only on success.
  const hasSubmitted = useRef(false);
  useEffect(() => {
    if (submitFetcher.state !== "idle") {
      hasSubmitted.current = true;
      return;
    }
    if (hasSubmitted.current && submitFetcher.data === undefined) {
      hasSubmitted.current = false;
      onClose();
    }
  }, [submitFetcher.state, submitFetcher.data, onClose]);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="xlarge">
        <submitFetcher.Form
          method="post"
          action={path.to.salesReturnOrderCredit(orderId)}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Issue Credit</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Received quantity not yet credited. The credit memo is created
                as a draft.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            {isLoading ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                <Trans>Loading creditable lines...</Trans>
              </p>
            ) : lines.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                <Trans>No received quantity remains creditable</Trans>
              </p>
            ) : (
              <ScrollArea className="max-h-[50dvh] w-full">
                <VStack spacing={2} className="w-full">
                  {lines.map((line) => {
                    const quantity = selected[line.salesReturnOrderLineId] ?? 0;
                    return (
                      <HStack
                        key={line.salesReturnOrderLineId}
                        className="w-full justify-between p-3 border rounded-lg"
                      >
                        <VStack spacing={0} className="min-w-0 items-start">
                          <span className="text-sm font-medium">
                            <Trans>Line {line.lineNumber}</Trans>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            <Trans>
                              {quantityFormatter(line.quantityReceived)}{" "}
                              received
                              {" · "}
                              {quantityFormatter(line.quantityCredited)}{" "}
                              credited
                            </Trans>
                          </span>
                          {line.restockFeePercent > 0 && (
                            <span className="text-xs text-muted-foreground">
                              <Trans>
                                Restocking fee{" "}
                                {percentFormatter.format(
                                  line.restockFeePercent
                                )}
                              </Trans>
                            </span>
                          )}
                        </VStack>
                        <HStack spacing={4}>
                          <NumberField
                            formatOptions={INPUT_FORMAT.quantity}
                            step={INPUT_STEP.quantity}
                            value={quantity}
                            onChange={(value) =>
                              setQuantity(
                                line.salesReturnOrderLineId,
                                value,
                                line.creditableQuantity
                              )
                            }
                          >
                            <NumberInput
                              className="min-w-[100px]"
                              size="sm"
                              min={0}
                              max={line.creditableQuantity}
                            />
                          </NumberField>
                          <span className="text-sm font-medium tabular-nums whitespace-nowrap min-w-[80px] text-right">
                            {currencyFormatter.format(amountFor(line))}
                          </span>
                        </HStack>
                      </HStack>
                    );
                  })}
                </VStack>
              </ScrollArea>
            )}
            <input type="hidden" name="lines" value={JSON.stringify(payload)} />
          </ModalBody>
          <ModalFooter>
            <HStack className="w-full justify-between">
              <span className="text-sm font-medium tabular-nums">
                <Trans>Total</Trans> {currencyFormatter.format(total)}
              </span>
              <HStack>
                <Button variant="secondary" onClick={onClose} type="button">
                  <Trans>Cancel</Trans>
                </Button>
                <Button
                  type="submit"
                  isLoading={isSubmitting}
                  isDisabled={isSubmitting || payload.length === 0}
                >
                  <Trans>Issue Credit</Trans>
                </Button>
              </HStack>
            </HStack>
          </ModalFooter>
        </submitFetcher.Form>
      </ModalContent>
    </Modal>
  );
};

export default SalesReturnOrderCreditModal;
