import {
  Button,
  Checkbox,
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
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher, useParams } from "react-router";
import { useCurrencyFormatter, usePercentFormatter } from "~/hooks";
import type { loader as creditLoader } from "~/routes/x+/purchase-return-order+/$id.credit";
import { path } from "~/utils/path";

type PurchaseReturnOrderCreditModalProps = {
  currencyCode?: string | null;
  onClose: () => void;
};

const PurchaseReturnOrderCreditModal = ({
  currencyCode,
  onClose
}: PurchaseReturnOrderCreditModalProps) => {
  const { t } = useLingui();
  const { id: orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");

  const loadFetcher = useFetcher<typeof creditLoader>();
  const submitFetcher = useFetcher<{ error?: string }>();

  const currencyFormatter = useCurrencyFormatter({
    currency: currencyCode ?? undefined
  });
  const percentFormatter = usePercentFormatter();

  useMount(() => {
    loadFetcher.load(path.to.purchaseReturnOrderCredit(orderId));
  });

  const lines = loadFetcher.data?.lines ?? [];

  // purchaseReturnOrderLineId -> selected quantity. Clamping here is UX only —
  // the authoritative cap is the row-locked validation in
  // createPurchaseReturnOrderCredit.
  const [selected, setSelected] = useState<Record<string, number>>({});

  const toggle = (lineId: string, creditableQuantity: number) => {
    setSelected((prev) => {
      if (lineId in prev) {
        const { [lineId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [lineId]: creditableQuantity };
    });
  };

  const setQuantity = (
    lineId: string,
    value: number,
    creditableQuantity: number
  ) => {
    const clamped = Math.max(
      0,
      Math.min(Number.isFinite(value) ? value : 0, creditableQuantity)
    );
    setSelected((prev) => ({ ...prev, [lineId]: clamped }));
  };

  const selectedRows = lines.filter(
    (line) =>
      line.purchaseReturnOrderLineId in selected &&
      selected[line.purchaseReturnOrderLineId] > 0
  );

  // Preview only — the memo amount is computed and rounded server-side.
  const total = selectedRows.reduce((sum, line) => {
    const quantity = selected[line.purchaseReturnOrderLineId];
    const gross = quantity * line.unitPrice;
    return sum + gross - gross * line.restockFeePercent;
  }, 0);

  const onSubmit = () => {
    if (selectedRows.length === 0) return;
    const formData = new FormData();
    formData.append(
      "lines",
      JSON.stringify(
        selectedRows.map((line) => ({
          purchaseReturnOrderLineId: line.purchaseReturnOrderLineId,
          quantity: selected[line.purchaseReturnOrderLineId]
        }))
      )
    );
    submitFetcher.submit(formData, {
      method: "post",
      action: path.to.purchaseReturnOrderCredit(orderId)
    });
  };

  const isLoading = loadFetcher.state !== "idle" && !loadFetcher.data;
  const isSubmitting = submitFetcher.state !== "idle";

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="xlarge">
        <ModalHeader>
          <ModalTitle>
            <Trans>Issue Credit</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Creates a draft supplier credit memo for the shipped quantities
              that have not been credited yet
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
              <Trans>This return order has no lines to credit</Trans>
            </p>
          ) : (
            <ScrollArea className="max-h-[50dvh] w-full">
              <VStack spacing={2} className="w-full">
                {lines.map((line) => {
                  const isSelected = line.purchaseReturnOrderLineId in selected;
                  const isCreditable = line.creditableQuantity > 0;
                  return (
                    <HStack
                      key={line.purchaseReturnOrderLineId}
                      className="w-full justify-between p-3 border rounded-lg"
                    >
                      <HStack spacing={3} className="min-w-0">
                        <Checkbox
                          isChecked={isSelected}
                          disabled={!isCreditable}
                          onCheckedChange={() =>
                            toggle(
                              line.purchaseReturnOrderLineId,
                              line.creditableQuantity
                            )
                          }
                        />
                        <VStack spacing={0} className="min-w-0 items-start">
                          <span className="text-sm font-medium">
                            <Trans>Line</Trans> {line.lineNumber}
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {currencyFormatter.format(line.unitPrice)}
                            {line.restockFeePercent > 0
                              ? ` · ${percentFormatter.format(
                                  line.restockFeePercent
                                )} ${t`restock fee`}`
                              : ""}
                          </span>
                        </VStack>
                      </HStack>
                      <HStack spacing={4}>
                        <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                          {line.creditableQuantity} <Trans>creditable</Trans> (
                          {line.quantityCredited} / {line.quantityShipped}{" "}
                          <Trans>credited</Trans>)
                        </span>
                        {isSelected && (
                          <NumberField
                            value={selected[line.purchaseReturnOrderLineId]}
                            onChange={(value) =>
                              setQuantity(
                                line.purchaseReturnOrderLineId,
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
                        )}
                      </HStack>
                    </HStack>
                  );
                })}
              </VStack>
            </ScrollArea>
          )}
        </ModalBody>
        <ModalFooter>
          <HStack className="w-full justify-between">
            <span className="text-sm text-muted-foreground tabular-nums">
              <Trans>Credit total</Trans>: {currencyFormatter.format(total)}
            </span>
            <HStack>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                isLoading={isSubmitting}
                isDisabled={isSubmitting || selectedRows.length === 0}
                onClick={onSubmit}
              >
                <Trans>Issue Credit</Trans>
              </Button>
            </HStack>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default PurchaseReturnOrderCreditModal;
