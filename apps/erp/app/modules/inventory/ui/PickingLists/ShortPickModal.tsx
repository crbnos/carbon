import { Hidden, NumberControlled, ValidatedForm } from "@carbon/form";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";
import { pickQuantityValidator } from "../../inventory.models";

export function ShortPickModal({
  pickingListId,
  lineId,
  itemName,
  quantityToPick,
  quantityPicked,
  onClose
}: {
  pickingListId: string;
  lineId: string;
  itemName: string;
  quantityToPick: number;
  quantityPicked: number;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean; message?: string }>();
  const [quantity, setQuantity] = useState(
    quantityPicked > 0 ? quantityPicked : quantityToPick
  );
  const submitted = useRef(false);
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (submitted.current && fetcher.state === "idle") {
      onClose();
    }
  }, [fetcher.state, onClose]);

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.pickingListLineQuantity(pickingListId)}
          validator={pickQuantityValidator}
          defaultValues={{
            pickingListLineId: lineId,
            quantity,
            markShort: "true"
          }}
          fetcher={fetcher}
          onSubmit={() => {
            submitted.current = true;
          }}
        >
          <ModalHeader>
            <ModalTitle>{t`Short pick ${itemName}`}</ModalTitle>
            <ModalDescription>
              <Trans>How many were actually picked?</Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="pickingListLineId" />
            <Hidden name="markShort" value="true" />
            <NumberControlled
              name="quantity"
              label={t`Picked quantity`}
              value={quantity}
              onChange={setQuantity}
              minValue={0}
              maxValue={quantityToPick}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button type="submit" isLoading={isSubmitting}>
              <Trans>Mark Short</Trans>
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

export default ShortPickModal;
