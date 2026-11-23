// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRuleViolations } from "@carbon/ee/rules";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  NumberField,
  NumberInput,
  NumberInputGroup,
  toast,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { Link } from "react-router";
import StorageUnit from "~/components/Form/StorageUnit";
import { useQuantityFormatter } from "~/hooks";
import { path } from "~/utils/path";

type MoveResult = {
  data?: { id: string; stockTransferId: string; moveError?: string } | null;
};

type StockTransferMoveModalProps = {
  itemId: string;
  locationId: string;
  fromStorageUnitId: string | null;
  fromStorageUnitName: string | null;
  quantityOnHand: number;
  unitOfMeasure: string;
  itemTrackingType: string;
  trackedEntityId: string | null;
  trackedEntityLabel: string | null;
  open?: boolean;
  onClose: () => void;
};

/**
 * Moves stock between storage units by creating and picking a one-line stock
 * transfer, so the move shows in the transfer list and item ledger.
 */
export function StockTransferMoveModal({
  open = true,
  onClose,
  ...props
}: StockTransferMoveModalProps) {
  return (
    <Modal
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <StockTransferMoveBody onClose={onClose} {...props} />
      </ModalContent>
    </Modal>
  );
}

function StockTransferMoveBody({
  itemId,
  locationId,
  fromStorageUnitId,
  fromStorageUnitName,
  quantityOnHand,
  unitOfMeasure,
  itemTrackingType,
  trackedEntityId,
  trackedEntityLabel,
  onClose
}: Omit<StockTransferMoveModalProps, "open">) {
  const { t } = useLingui();
  const formatQuantity = useQuantityFormatter();
  const isSerial = itemTrackingType === "Serial";
  const isBatch = itemTrackingType === "Batch";

  const [toStorageUnitId, setToStorageUnitId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(isSerial ? 1 : quantityOnHand);

  const resultRef = useRef<MoveResult | undefined>(undefined);
  const move = useRuleViolations<MoveResult>({
    action: path.to.newStockTransfer,
    onSuccess: () => {
      const created = resultRef.current?.data;
      // Created but not moved: link it to pick there, and close, since
      // sending again would create a second transfer.
      if (created?.moveError) {
        toast.error(
          <span>
            <Trans>
              Not moved: {created.moveError.replace(/\.$/, "")}. Recorded on{" "}
              <Link
                className="underline"
                to={path.to.stockTransfer(created.id)}
              >
                {created.stockTransferId}
              </Link>
            </Trans>
          </span>
        );
        onClose();
        return;
      }
      toast.success(
        created ? (
          <span>
            <Trans>
              Moved. Recorded on{" "}
              <Link
                className="underline"
                to={path.to.stockTransfer(created.id)}
              >
                {created.stockTransferId}
              </Link>
            </Trans>
          </span>
        ) : (
          t`Moved`
        )
      );
      onClose();
    }
  });
  resultRef.current = move.fetcher.data as MoveResult | undefined;
  const isSubmitting = move.fetcher.state !== "idle";

  const sameBin =
    toStorageUnitId !== null && toStorageUnitId === fromStorageUnitId;
  const overdraw = quantity > quantityOnHand;
  const canMove = !!toStorageUnitId && !sameBin && quantity > 0 && !overdraw;

  const submit = () => {
    const fd = new FormData();
    fd.set("locationId", locationId);
    fd.set(
      "lines",
      JSON.stringify([
        {
          itemId,
          fromStorageUnitId,
          toStorageUnitId,
          quantity,
          requiresSerialTracking: isSerial,
          requiresBatchTracking: isBatch,
          trackedEntityId
        }
      ])
    );
    fd.set("moveNow", "true");
    fd.set("stay", "true");
    move.submit(fd);
  };

  return (
    <>
      <ModalHeader>
        <ModalTitle>
          <Trans>Move to Another Storage Unit</Trans>
        </ModalTitle>
        <ModalDescription>
          <Trans>
            From {fromStorageUnitName ?? t`No storage unit`}, where{" "}
            {formatQuantity(quantityOnHand)} {unitOfMeasure} are on hand.
          </Trans>
        </ModalDescription>
      </ModalHeader>
      <ModalBody>
        <VStack spacing={4}>
          {trackedEntityId && (
            <VStack spacing={1}>
              <span className="text-xs text-muted-foreground">
                {isSerial ? t`Serial number` : t`Batch number`}
              </span>
              <span className="font-mono text-sm">
                {trackedEntityLabel ?? trackedEntityId}
              </span>
            </VStack>
          )}
          <VStack spacing={1} className="w-full">
            <span className="text-xs font-medium">
              <Trans>To</Trans>
            </span>
            <div className="w-full">
              <StorageUnit
                locationId={locationId}
                itemId={itemId}
                value={toStorageUnitId}
                stockedFirst
                excludeId={fromStorageUnitId}
                placeholder={t`Storage unit`}
                onChange={(storageUnit) =>
                  setToStorageUnitId(storageUnit?.id ?? null)
                }
              />
            </div>
          </VStack>
          <VStack spacing={1} className="w-full">
            <span className="text-xs font-medium">
              <Trans>Quantity</Trans>
            </span>
            <NumberField
              value={quantity}
              minValue={0}
              maxValue={isSerial ? 1 : undefined}
              isDisabled={isSerial}
              step={isSerial ? 1 : INPUT_STEP.quantity}
              formatOptions={INPUT_FORMAT.quantity}
              aria-label={t`Quantity`}
              onChange={(value: number) =>
                setQuantity(Number.isFinite(value) ? value : 0)
              }
            >
              <NumberInputGroup>
                <NumberInput />
              </NumberInputGroup>
            </NumberField>
            {overdraw ? (
              <span className="text-xs text-destructive">
                <Trans>
                  Only {formatQuantity(quantityOnHand)} {unitOfMeasure} here
                </Trans>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                <Trans>
                  Up to {formatQuantity(quantityOnHand)} {unitOfMeasure}
                </Trans>
              </span>
            )}
          </VStack>
        </VStack>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
        <Button
          isLoading={isSubmitting}
          isDisabled={!canMove || isSubmitting}
          onClick={submit}
        >
          <Trans>Move</Trans>
        </Button>
      </ModalFooter>
      <move.ViolationModal />
    </>
  );
}
