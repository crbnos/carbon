// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
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
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import { DateTimePicker, Employee, Hidden, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { serviceVisitValidator } from "../../service.models";

/**
 * Schedules a visit to the unit, or moves a scheduled one: the technician
 * and the planned window. The picker reads the window in the browser's time
 * zone and stores it as an instant.
 */
export default function ScheduleVisitModal({
  initialValues,
  onClose
}: {
  initialValues: z.input<typeof serviceVisitValidator>;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const isEditing = Boolean(initialValues.id);

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={serviceVisitValidator}
          method="post"
          action={path.to.newServiceVisit(initialValues.serviceOrderId)}
          defaultValues={initialValues}
        >
          <ModalHeader>
            <ModalTitle>
              {isEditing ? (
                <Trans>Reschedule Visit</Trans>
              ) : (
                <Trans>Schedule Visit</Trans>
              )}
            </ModalTitle>
            <ModalDescription>
              <Trans>Choose who goes to the unit, and when.</Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="id" />
            <Hidden name="serviceOrderId" />
            <VStack spacing={4}>
              <Employee name="technicianId" label={t`Technician`} />
              <DateTimePicker name="plannedStart" label={t`Planned Start`} />
              <DateTimePicker name="plannedEnd" label={t`Planned End`} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit isDisabled={!permissions.can("update", "service")}>
              {isEditing ? <Trans>Reschedule</Trans> : <Trans>Schedule</Trans>}
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
