// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useId, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";

/**
 * DCAA mode: the employee certifies the week before it is submitted, as in
 * the ERP's `CertificationModal`. It submits the text it showed, so
 * `submit-timesheet-week` refuses a week whose text changed after the page
 * loaded, and stores who certified, when, and the text's hash.
 */
export function WeekCertificationModal({
  certificationText,
  weekLabel,
  isSubmitting,
  onSubmit,
  onClose
}: {
  /** The text for the employee's FLSA status, or null when none is set. */
  certificationText: string | null;
  weekLabel: string;
  isSubmitting: boolean;
  onSubmit: (certificationText: string) => void;
  onClose: () => void;
}) {
  const checkboxId = useId();
  const [certified, setCertified] = useState(false);

  return (
    <Modal open onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Certify and Submit</Trans>
          </ModalTitle>
          <ModalDescription>{weekLabel}</ModalDescription>
        </ModalHeader>
        <ModalBody>
          {certificationText ? (
            <div className="flex flex-col gap-4">
              <blockquote className="w-full whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-4 text-base">
                {certificationText}
              </blockquote>
              {/* The whole row is the touch target, not only the box. */}
              <label
                htmlFor={checkboxId}
                className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-border px-4 text-base"
              >
                <Checkbox
                  id={checkboxId}
                  className="size-6"
                  isChecked={certified}
                  onCheckedChange={(checked) => setCertified(checked === true)}
                />
                <Trans>I certify this statement</Trans>
              </label>
            </div>
          ) : (
            <Alert variant="warning">
              <LuTriangleAlert />
              <AlertDescription>
                <Trans>
                  No certification text is set for you. Ask an administrator to
                  set it in Settings → Time.
                </Trans>
              </AlertDescription>
            </Alert>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            size="lg"
            variant="secondary"
            isDisabled={isSubmitting}
            onClick={onClose}
          >
            <Trans>Cancel</Trans>
          </Button>
          <Button
            size="lg"
            isDisabled={!certificationText || !certified || isSubmitting}
            isLoading={isSubmitting}
            onClick={() => {
              if (certificationText && certified) onSubmit(certificationText);
            }}
          >
            <Trans>Certify and submit</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
