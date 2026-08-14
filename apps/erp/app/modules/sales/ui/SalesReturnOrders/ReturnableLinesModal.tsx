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
  toast,
  useMount,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher, useParams, useRevalidator } from "react-router";
import type { loader as returnableLinesLoader } from "~/routes/x+/sales-return-order+/returnable-lines";
import { path } from "~/utils/path";

// path.ts has no helper for the returnable-lines loader route yet; the static
// segment outranks the `$id` param, so this resolves to
// routes/x+/sales-return-order+/returnable-lines.tsx.
const returnableLinesUrl = path.to.salesReturnOrderReturnableLines;

type ReturnableLinesModalProps = {
  customerId: string;
  salesOrderId?: string | null;
  onClose: () => void;
};

const ReturnableLinesModal = ({
  customerId,
  salesOrderId,
  onClose
}: ReturnableLinesModalProps) => {
  const { t } = useLingui();
  const { id: orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");

  const fetcher = useFetcher<typeof returnableLinesLoader>();
  const revalidator = useRevalidator();

  useMount(() => {
    const params = new URLSearchParams({ customerId });
    if (salesOrderId) params.set("salesOrderId", salesOrderId);
    fetcher.load(`${returnableLinesUrl}?${params.toString()}`);
  });

  const lines = fetcher.data?.lines ?? [];

  // shipmentLineId -> selected quantity. Clamping here is UX only — the
  // authoritative cap is the confirm-time row-locked validation in
  // confirmSalesReturnOrder.
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggle = (shipmentLineId: string, returnableQuantity: number) => {
    setSelected((prev) => {
      if (shipmentLineId in prev) {
        const { [shipmentLineId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [shipmentLineId]: returnableQuantity };
    });
  };

  const setQuantity = (
    shipmentLineId: string,
    value: number,
    returnableQuantity: number
  ) => {
    const clamped = Math.max(
      0,
      Math.min(Number.isFinite(value) ? value : 0, returnableQuantity)
    );
    setSelected((prev) => ({ ...prev, [shipmentLineId]: clamped }));
  };

  const onSubmit = async () => {
    const rows = lines.filter(
      (line) =>
        line.shipmentLineId in selected && selected[line.shipmentLineId] > 0
    );
    if (rows.length === 0) return;

    setIsSubmitting(true);
    try {
      for (const row of rows) {
        const formData = new FormData();
        formData.append("salesReturnOrderId", orderId);
        formData.append("itemId", row.itemId);
        formData.append("quantity", String(selected[row.shipmentLineId]));
        formData.append("unitPrice", String(row.unitPrice));
        if (row.unitOfMeasureCode) {
          formData.append("unitOfMeasureCode", row.unitOfMeasureCode);
        }
        if (row.salesOrderLineId) {
          formData.append("salesOrderLineId", row.salesOrderLineId);
        }
        formData.append("shipmentLineId", row.shipmentLineId);

        const response = await fetch(path.to.newSalesReturnOrderLine(orderId), {
          method: "POST",
          body: formData
        });
        if (!response.ok && !response.redirected) {
          throw new Error(t`Failed to add line`);
        }
      }
      toast.success(t`Added ${rows.length} lines`);
      revalidator.revalidate();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t`Failed to add lines`);
      revalidator.revalidate();
    } finally {
      setIsSubmitting(false);
    }
  };

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
            <Trans>Add lines from document</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Shipped lines for this customer with quantity remaining to return
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          {fetcher.state !== "idle" && !fetcher.data ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              <Trans>Loading returnable lines...</Trans>
            </p>
          ) : lines.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              <Trans>No returnable lines found for this customer</Trans>
            </p>
          ) : (
            <ScrollArea className="max-h-[50dvh] w-full">
              <VStack spacing={2} className="w-full">
                {lines.map((line) => {
                  const isSelected = line.shipmentLineId in selected;
                  return (
                    <HStack
                      key={line.shipmentLineId}
                      className="w-full justify-between p-3 border rounded-lg"
                    >
                      <HStack spacing={3} className="min-w-0">
                        <Checkbox
                          isChecked={isSelected}
                          onCheckedChange={() =>
                            toggle(line.shipmentLineId, line.returnableQuantity)
                          }
                        />
                        <VStack spacing={0} className="min-w-0 items-start">
                          <span className="text-sm font-medium truncate">
                            {line.itemReadableId}
                          </span>
                          <span className="text-xs text-muted-foreground truncate">
                            {line.itemName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {line.shipmentReadableId}
                            {line.salesOrderReadableId
                              ? ` · ${line.salesOrderReadableId}`
                              : ""}
                          </span>
                        </VStack>
                      </HStack>
                      <HStack spacing={4}>
                        <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                          {line.returnableQuantity} <Trans>returnable</Trans>
                        </span>
                        {isSelected && (
                          <NumberField
                            value={selected[line.shipmentLineId]}
                            onChange={(value) =>
                              setQuantity(
                                line.shipmentLineId,
                                value,
                                line.returnableQuantity
                              )
                            }
                          >
                            <NumberInput
                              className="min-w-[100px]"
                              size="sm"
                              min={0}
                              max={line.returnableQuantity}
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
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            isLoading={isSubmitting}
            isDisabled={
              isSubmitting ||
              Object.values(selected).filter((quantity) => quantity > 0)
                .length === 0
            }
            onClick={onSubmit}
          >
            <Trans>Add Lines</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ReturnableLinesModal;
