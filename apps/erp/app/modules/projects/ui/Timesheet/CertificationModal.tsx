// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
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
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useId, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { path } from "~/utils/path";

/**
 * DCAA mode: the employee certifies the week before it is submitted. The
 * modal posts the text it showed, so the server refuses a submit whose text
 * changed after the page loaded.
 */
export function CertificationModal({
  certificationText,
  weekStart,
  weekEnd,
  weekOffset,
  weekLabel,
  onClose
}: {
  /** The text for the employee's FLSA status, or null when none is set. */
  certificationText: string | null;
  weekStart: string;
  weekEnd: string;
  weekOffset: number;
  weekLabel: string;
  onClose: () => void;
}) {
  const checkboxId = useId();
  const [certified, setCertified] = useState(false);
  // The submit redirects back to the timesheet, which flashes the outcome.
  const fetcher = useAction({ onSettled: () => onClose() });
  const isSubmitting = fetcher.state !== "idle";

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <fetcher.Form method="post" action={path.to.timesheetSubmit}>
          <ModalHeader>
            <ModalTitle>
              <Trans>Certify and Submit</Trans>
            </ModalTitle>
            <ModalDescription>{weekLabel}</ModalDescription>
          </ModalHeader>
          <ModalBody>
            <input type="hidden" name="from" value={weekStart} />
            <input type="hidden" name="to" value={weekEnd} />
            <input type="hidden" name="week" value={weekOffset} />
            {certificationText ? (
              <VStack spacing={4}>
                <input
                  type="hidden"
                  name="certificationText"
                  value={certificationText}
                />
                <blockquote className="w-full whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm">
                  {certificationText}
                </blockquote>
                <label
                  htmlFor={checkboxId}
                  className="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    id={checkboxId}
                    isChecked={certified}
                    onCheckedChange={(checked) =>
                      setCertified(checked === true)
                    }
                  />
                  <Trans>I certify this statement</Trans>
                </label>
              </VStack>
            ) : (
              <Alert variant="warning">
                <LuTriangleAlert />
                <AlertDescription>
                  <Trans>
                    No certification text is set for you. Ask an administrator
                    to set it in Settings → Time.
                  </Trans>
                </AlertDescription>
              </Alert>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              type="submit"
              isDisabled={!certificationText || !certified || isSubmitting}
              isLoading={isSubmitting}
            >
              <Trans>Certify and submit</Trans>
            </Button>
          </ModalFooter>
        </fetcher.Form>
      </ModalContent>
    </Modal>
  );
}
