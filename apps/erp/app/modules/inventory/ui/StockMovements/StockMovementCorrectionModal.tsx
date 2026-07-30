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
  // Original quantity plus all on-page corrections in its group — what the
  // movement currently nets to. The server recomputes this authoritatively.
  effectiveQuantity: number;
  onClose: () => void;
};

// Correct a posted stock movement: the user enters the SIGNED quantity the
// movement should have been; the server books one opposite (delta) movement
// linked to the original, dated with the original's postingDate.
const StockMovementCorrectionModal = ({
  movement,
  effectiveQuantity,
  onClose
}: StockMovementCorrectionModalProps) => {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const permissions = usePermissions();
  const fetcher = useFetcher<{
    error: { message: string } | null;
    data: { id: string } | null;
  }>();

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.error) {
      toast.error(fetcher.data.error.message);
    } else {
      toast.success(t`Stock movement corrected`);
      onClose();
    }
  }, [fetcher.state, fetcher.data, onClose, t]);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          validator={stockMovementCorrectionValidator}
          method="post"
          action={path.to.stockMovementCorrect(movement.id!)}
          defaultValues={{ correctedQuantity: effectiveQuantity }}
          fetcher={fetcher}
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
                  fetcher.state !== "idle"
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
      </ModalContent>
    </Modal>
  );
};

export default StockMovementCorrectionModal;
