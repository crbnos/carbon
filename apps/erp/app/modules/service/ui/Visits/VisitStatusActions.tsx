// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
  ModalTitle,
  toast,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCar, LuCircleCheck, LuCircleStop, LuMapPin } from "react-icons/lu";
import { path } from "~/utils/path";
import type { ServiceVisitStatus } from "../../service.models";
import { canMoveVisit } from "../../service.models";

/**
 * The next steps of a visit: Start Travel, Arrive, Complete (which asks
 * **Work complete?**) and Cancel. The next step is the primary button.
 */
export function VisitStatusActions({
  serviceOrderId,
  visitId,
  status,
  isDisabled,
  size = "md"
}: {
  serviceOrderId: string;
  visitId: string;
  status: ServiceVisitStatus;
  isDisabled: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const { t } = useLingui();
  const completeDisclosure = useDisclosure();
  const fetcher = useAction<{ error?: { message: string } | null }>({
    onSuccess: () => completeDisclosure.onClose(),
    onError: (data) =>
      toast.error(data?.error?.message ?? t`Failed to update the visit`)
  });
  const isMoving = fetcher.state !== "idle";
  const pending = fetcher.formData?.get("status");

  const move = (to: ServiceVisitStatus, workComplete = false) =>
    fetcher.submit(
      { status: to, ...(workComplete ? { workComplete: "on" } : {}) },
      {
        method: "post",
        action: path.to.serviceVisitStatus(serviceOrderId, visitId)
      }
    );

  if (status === "Completed" || status === "Cancelled") return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {canMoveVisit(status, "Traveling") && (
          <Button
            size={size}
            variant="primary"
            leftIcon={<LuCar />}
            isDisabled={isDisabled || isMoving}
            isLoading={isMoving && pending === "Traveling"}
            onClick={() => move("Traveling")}
          >
            <Trans>Start Travel</Trans>
          </Button>
        )}
        {canMoveVisit(status, "On Site") && (
          <Button
            size={size}
            variant={status === "Traveling" ? "primary" : "secondary"}
            leftIcon={<LuMapPin />}
            isDisabled={isDisabled || isMoving}
            isLoading={isMoving && pending === "On Site"}
            onClick={() => move("On Site")}
          >
            <Trans>Arrive</Trans>
          </Button>
        )}
        {canMoveVisit(status, "Completed") && (
          <Button
            size={size}
            variant="primary"
            leftIcon={<LuCircleCheck />}
            isDisabled={isDisabled || isMoving}
            onClick={completeDisclosure.onOpen}
          >
            <Trans>Complete</Trans>
          </Button>
        )}
        <Button
          size={size}
          variant="secondary"
          leftIcon={<LuCircleStop />}
          isDisabled={isDisabled || isMoving}
          isLoading={isMoving && pending === "Cancelled"}
          onClick={() => move("Cancelled")}
        >
          <Trans>Cancel Visit</Trans>
        </Button>
      </div>

      {completeDisclosure.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) completeDisclosure.onClose();
          }}
        >
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                <Trans>Work complete?</Trans>
              </ModalTitle>
              <ModalDescription>
                <Trans>
                  Is all the work on this unit done? If it is, the service order
                  is completed and ready to invoice. If not, it stays In
                  Progress for another visit.
                </Trans>
              </ModalDescription>
            </ModalHeader>
            <ModalBody />
            <ModalFooter>
              <Button
                variant="secondary"
                isDisabled={isMoving}
                onClick={completeDisclosure.onClose}
              >
                <Trans>Cancel</Trans>
              </Button>
              <Button
                variant="secondary"
                isDisabled={isMoving}
                isLoading={isMoving && !fetcher.formData?.get("workComplete")}
                onClick={() => move("Completed", false)}
              >
                <Trans>No, More Work</Trans>
              </Button>
              <Button
                variant="primary"
                isDisabled={isMoving}
                isLoading={isMoving && !!fetcher.formData?.get("workComplete")}
                onClick={() => move("Completed", true)}
              >
                <Trans>Yes, Work Complete</Trans>
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </>
  );
}
