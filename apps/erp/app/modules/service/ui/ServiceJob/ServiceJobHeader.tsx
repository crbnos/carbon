// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Button,
  DropdownMenuIcon,
  DropdownMenuItem,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  toast,
  useDisclosure
} from "@carbon/react";
import { serviceJobPrimaryAction } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCirclePause, LuCirclePlay, LuCircleX, LuPlay } from "react-icons/lu";
import { useParams } from "react-router";
import { RecordAction, RecordHeader } from "~/components/Layout/RecordHeader";
import { usePermissions, useRouteData } from "~/hooks";
import type { action as statusAction } from "~/routes/x+/service-job+/$jobId.status";
import { path } from "~/utils/path";
import type { ServiceJobStatusAction } from "../../service.models";
import { SERVICE_JOB_STATUS_TRANSITIONS } from "../../service.models";
import type { ServiceJobDetail } from "../../types";
import CoverageBadge from "./CoverageBadge";
import ServiceJobStatus from "./ServiceJobStatus";

const ServiceJobHeader = () => {
  const { t } = useLingui();
  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  const routeData = useRouteData<{ job: ServiceJobDetail }>(
    path.to.serviceJob(jobId)
  );
  const job = routeData?.job;
  const status = job?.status;

  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "service");
  const cancelModal = useDisclosure();
  const statusFetcher = useAction<typeof statusAction>({
    onSuccess: () => {
      toast.success(t`Updated job status`);
      cancelModal.onClose();
    }
  });

  const primaryAction = job ? serviceJobPrimaryAction(job) : null;

  const isAllowed = (action: ServiceJobStatusAction) =>
    !!status &&
    SERVICE_JOB_STATUS_TRANSITIONS[action].from.includes(status) &&
    canUpdate &&
    statusFetcher.state === "idle";

  const submitStatus = (action: ServiceJobStatusAction) => {
    statusFetcher.submit(
      { action },
      { method: "post", action: path.to.serviceJobStatus(jobId) }
    );
  };

  const menuItems = (
    <>
      <DropdownMenuItem
        disabled={!isAllowed("Hold")}
        onClick={() => submitStatus("Hold")}
      >
        <DropdownMenuIcon icon={<LuCirclePause />} />
        <Trans>Hold</Trans>
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!isAllowed("Resume")}
        onClick={() => submitStatus("Resume")}
      >
        <DropdownMenuIcon icon={<LuPlay />} />
        <Trans>Resume</Trans>
      </DropdownMenuItem>
      <DropdownMenuItem
        destructive
        disabled={!isAllowed("Cancel")}
        onClick={cancelModal.onOpen}
      >
        <DropdownMenuIcon icon={<LuCircleX />} />
        <Trans>Cancel Job</Trans>
      </DropdownMenuItem>
    </>
  );

  return (
    <>
      <RecordHeader
        title={job?.serviceJobId}
        titleTo={path.to.serviceJob(jobId)}
        copyValue={job?.serviceJobId ?? ""}
        menu={menuItems}
        status={
          <div className="flex flex-wrap items-center gap-2">
            <ServiceJobStatus status={status} />
            <CoverageBadge coverage={job?.coverage} />
          </div>
        }
        actions={
          primaryAction === "Start" ? (
            <RecordAction slot="primary">
              <statusFetcher.Form
                method="post"
                action={path.to.serviceJobStatus(jobId)}
              >
                <input type="hidden" name="action" value="Start" />
                <Button
                  type="submit"
                  leftIcon={<LuCirclePlay />}
                  variant="primary"
                  isDisabled={!isAllowed("Start")}
                  isLoading={
                    statusFetcher.state !== "idle" &&
                    statusFetcher.formData?.get("action") === "Start"
                  }
                >
                  <Trans>Start</Trans>
                </Button>
              </statusFetcher.Form>
            </RecordAction>
          ) : null
        }
      />
      {cancelModal.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) cancelModal.onClose();
          }}
        >
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                <Trans>Cancel {job?.serviceJobId}</Trans>
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  The job closes without work. A job with time entries or issued
                  parts cannot be cancelled.
                </Trans>
              </p>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={cancelModal.onClose}>
                <Trans>Keep Job</Trans>
              </Button>
              <statusFetcher.Form
                method="post"
                action={path.to.serviceJobStatus(jobId)}
              >
                <input type="hidden" name="action" value="Cancel" />
                <Button
                  type="submit"
                  variant="destructive"
                  isDisabled={statusFetcher.state !== "idle"}
                  isLoading={statusFetcher.state !== "idle"}
                >
                  <Trans>Cancel Job</Trans>
                </Button>
              </statusFetcher.Form>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </>
  );
};

export default ServiceJobHeader;
