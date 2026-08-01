import { ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  toast,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import { Enumerable } from "~/components/Enumerable";
import { Number, Submit, TextArea } from "~/components/Form";
import { useDateFormatter, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { stockMovementCorrectionValidator } from "../../inventory.models";
import type { StockMovement } from "../../types";

type StockMovementCorrectionModalProps = {
  movement: StockMovement;
  onClose: () => void;
};

// Correct a posted stock movement: the user enters the SIGNED quantity the
// movement should have been; the server books one opposite (delta) movement
// linked to the original, dated with the original's postingDate.
//
// The pre-filled effective quantity (original + all prior corrections) is
// LOADED from the route's loader, never derived from the visible page — the
// page can miss off-page corrections, and a correction row has no on-page
// descendants of its own, so a client-side sum could silently submit an
// unintended delta.
const StockMovementCorrectionModal = ({
  movement,
  onClose
}: StockMovementCorrectionModalProps) => {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const permissions = usePermissions();

  const effectiveFetcher = useFetcher<{ effectiveQuantity: number | null }>();
  const submitFetcher = useFetcher<{
    error: { message: string } | null;
    data: { id: string } | null;
  }>();

  const correctionPath = path.to.stockMovementCorrect(movement.id!);

  useEffect(() => {
    if (effectiveFetcher.state === "idle" && effectiveFetcher.data == null) {
      effectiveFetcher.load(correctionPath);
    }
  }, [effectiveFetcher, correctionPath]);

  useEffect(() => {
    if (submitFetcher.state !== "idle" || !submitFetcher.data) return;
    if (submitFetcher.data.error) {
      toast.error(submitFetcher.data.error.message);
    } else {
      toast.success(t`Stock movement corrected`);
      onClose();
    }
  }, [submitFetcher.state, submitFetcher.data, onClose, t]);

  const effectiveQuantity = effectiveFetcher.data?.effectiveQuantity ?? null;
  const isLoaded = effectiveQuantity !== null;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        {isLoaded ? (
          <ValidatedForm
            validator={stockMovementCorrectionValidator}
            method="post"
            action={correctionPath}
            defaultValues={{ correctedQuantity: effectiveQuantity }}
            fetcher={submitFetcher}
          >
            <ModalHeader>
              <ModalTitle>{t`Correct Stock Movement`}</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <VStack spacing={4}>
                <HStack spacing={2} className="text-sm">
                  <Enumerable value={movement.entryType} />
                  <span className="text-muted-foreground">
                    {formatDate(movement.postingDate)}
                  </span>
                  <Badge variant="secondary">
                    {t`Current quantity`}: {effectiveQuantity}
                  </Badge>
                </HStack>
                <p className="text-sm text-muted-foreground">
                  {t`Enter the quantity this movement should have been. An opposite movement for the difference is posted next to the original, in the original's time period.`}
                </p>
                <Number
                  name="correctedQuantity"
                  label={t`Corrected Quantity`}
                  helperText={t`Signed quantity — negative for outbound movements`}
                />
                <TextArea name="comment" label={t`Reason`} />
              </VStack>
            </ModalBody>
            <ModalFooter>
              <HStack>
                <Submit
                  isDisabled={
                    !permissions.can("update", "inventory") ||
                    submitFetcher.state !== "idle"
                  }
                >
                  {t`Correct`}
                </Submit>
                <Button variant="secondary" onClick={onClose}>
                  {t`Cancel`}
                </Button>
              </HStack>
            </ModalFooter>
          </ValidatedForm>
        ) : (
          <>
            <ModalHeader>
              <ModalTitle>{t`Correct Stock Movement`}</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <HStack
                spacing={2}
                className="justify-center py-8 text-muted-foreground"
              >
                <Spinner />
                <span>{t`Loading current quantity…`}</span>
              </HStack>
            </ModalBody>
          </>
        )}
      </ModalContent>
    </Modal>
  );
};

export default StockMovementCorrectionModal;
