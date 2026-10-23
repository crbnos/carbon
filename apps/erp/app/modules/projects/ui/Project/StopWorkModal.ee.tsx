// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { STOP_WORK_DAYS, stopWorkValidator } from "@carbon/ee/project-control";
import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuOctagonX } from "react-icons/lu";
import { DatePicker, Hidden, Submit } from "~/components/Form";
import {
  UpgradeOverlayActions,
  UpgradeOverlayContent,
  UpgradeOverlayDescription,
  UpgradeOverlayDialog,
  UpgradeOverlayIcon,
  UpgradeOverlayTitle,
  UpgradeOverlayUpgradeButton
} from "~/components/UpgradeOverlay";
import { useCompanyToday } from "~/hooks";
import { usePlanGate } from "~/hooks/usePlanGate";
import { path } from "~/utils/path";

/**
 * Stop work (Government Contracting 5c, FAR 52.242-15): sets a Released
 * Direct project On Hold from the order date for 90 days. A company without
 * government contracting sees the upgrade dialog instead.
 */
export default function StopWorkModal({
  projectId,
  onClose
}: {
  projectId: string;
  onClose: () => void;
}) {
  const { isGated } = usePlanGate({ feature: "GOVERNMENT_CONTRACTING" });

  if (isGated) {
    return (
      <UpgradeOverlayDialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <UpgradeOverlayIcon>
          <LuOctagonX className="size-6 text-muted-foreground" />
        </UpgradeOverlayIcon>
        <UpgradeOverlayContent>
          <UpgradeOverlayTitle>
            <Trans>Stop-Work Orders</Trans>
          </UpgradeOverlayTitle>
          <UpgradeOverlayDescription>
            <Trans>
              Put a contract project on hold under a stop-work order, with its
              90-day end date, and resume it when the order ends.
            </Trans>
          </UpgradeOverlayDescription>
        </UpgradeOverlayContent>
        <UpgradeOverlayActions>
          <UpgradeOverlayUpgradeButton />
        </UpgradeOverlayActions>
      </UpgradeOverlayDialog>
    );
  }

  return <StopWorkForm projectId={projectId} onClose={onClose} />;
}

function StopWorkForm({
  projectId,
  onClose
}: {
  projectId: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const today = useCompanyToday();
  // The route redirects back with a flash, so the modal closes either way.
  const fetcher = useAction({ onSettled: () => onClose() });

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={stopWorkValidator}
          method="post"
          action={path.to.projectStopWork(projectId)}
          fetcher={fetcher}
          defaultValues={{ projectId, orderDate: today }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Stop Work</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                The project goes On Hold and takes no new charges. Open
                commitments still post. The order ends after {STOP_WORK_DAYS}{" "}
                days unless you resume work first.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value="stop" />
            <Hidden name="projectId" />
            <DatePicker name="orderDate" label={t`Order date`} />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit variant="destructive">
              <Trans>Stop Work</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
