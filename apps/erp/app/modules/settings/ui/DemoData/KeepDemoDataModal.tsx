import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";

/**
 * Keep drops the pre-apply snapshot, so the company's previous data is gone for
 * good. Unlike Apply (reversible, so no friction), this is the one irreversible
 * step of the demo data flow, and it gets a typed confirmation.
 */
export function KeepDemoDataModal({
  onConfirm,
  onCancel
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  // Translated, so the phrase the user is asked to type is always in their language.
  const confirmPhrase = t`I understand, keep the demo data`;
  const [typed, setTyped] = useState("");
  const canConfirm = typed.trim().toLowerCase() === confirmPhrase.toLowerCase();

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Keep demo data and delete your previous data?</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4}>
            <p className="text-sm text-muted-foreground">
              <Trans>
                Your data from before the demo data was applied will be
                permanently deleted. You won't be able to revert or recover it.
              </Trans>
            </p>
            <VStack spacing={1}>
              <label className="text-sm" htmlFor="keep-demo-data-confirm">
                <Trans>
                  Type <span className="font-medium">"{confirmPhrase}"</span> to
                  continue.
                </Trans>
              </label>
              <Input
                id="keep-demo-data-confirm"
                value={typed}
                autoComplete="off"
                autoFocus
                placeholder={confirmPhrase}
                onChange={(e) => setTyped(e.target.value)}
              />
            </VStack>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            variant="destructive"
            isDisabled={!canConfirm}
            onClick={onConfirm}
          >
            <Trans>Keep demo data</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
