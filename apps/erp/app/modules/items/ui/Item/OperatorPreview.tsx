// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalTitle,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuMonitor } from "react-icons/lu";
import { path } from "~/utils/path";

/**
 * Opens the real MES screen for this operation, built from the saved Bill of
 * Process. The MES page is view-only: tabs and steps move, nothing records.
 */
export function OperatorPreviewButton({
  operationId,
  isDisabled
}: {
  operationId: string;
  isDisabled?: boolean;
}) {
  const { t } = useLingui();
  const disclosure = useDisclosure();

  return (
    <>
      <Button
        variant="secondary"
        leftIcon={<LuMonitor />}
        isDisabled={isDisabled}
        onClick={disclosure.onOpen}
      >
        <Trans>Operator Preview</Trans>
      </Button>
      <Modal
        open={disclosure.isOpen}
        onOpenChange={(open) => {
          if (!open) disclosure.onClose();
        }}
      >
        <ModalContent size="xxxlarge">
          <ModalHeader>
            <ModalTitle>
              <Trans>Operator Preview</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                What the operator sees on the shop floor, from the saved steps.
                Nothing here records or starts work.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <iframe
              title={t`Operator Preview`}
              src={path.to.external.mesOperationPreview(operationId)}
              className="h-[75vh] w-full rounded-lg border border-border bg-background"
            />
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
}
