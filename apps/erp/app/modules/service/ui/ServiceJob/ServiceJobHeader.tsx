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
import { isServiceJobLocked, serviceJobPrimaryAction } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuCircleCheck,
  LuCirclePause,
  LuCirclePlay,
  LuCircleX,
  LuFile,
  LuLoaderCircle,
  LuMessageSquareReply,
  LuPlay,
  LuReceipt,
  LuSend
} from "react-icons/lu";
import { useParams } from "react-router";
import { RecordAction, RecordHeader } from "~/components/Layout/RecordHeader";
import { usePermissions, useRouteData } from "~/hooks";
import type { action as completeAction } from "~/routes/x+/service-job+/$jobId.complete";
import type { action as sendAction } from "~/routes/x+/service-job+/$jobId.estimate.send";
import type { action as reopenAction } from "~/routes/x+/service-job+/$jobId.reopen";
import type { action as statusAction } from "~/routes/x+/service-job+/$jobId.status";
import { path } from "~/utils/path";
import type { ServiceJobStatusAction } from "../../service.models";
import { SERVICE_JOB_STATUS_TRANSITIONS } from "../../service.models";
import type { ServiceJobDetail, ServiceJobEstimateLine } from "../../types";
import CoverageBadge from "./CoverageBadge";
import EstimateResponseModal from "./EstimateResponseModal";
import ServiceJobStatus from "./ServiceJobStatus";

const ServiceJobHeader = () => {
  const { t } = useLingui();
  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  const routeData = useRouteData<{
    job: ServiceJobDetail;
    estimateLines: ServiceJobEstimateLine[];
  }>(path.to.serviceJob(jobId));
  const job = routeData?.job;
  const status = job?.status;
  const hasEstimateLines = (routeData?.estimateLines.length ?? 0) > 0;

  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "service");
  const cancelModal = useDisclosure();
  const responseModal = useDisclosure();

  const statusFetcher = useAction<typeof statusAction>({
    onSuccess: () => {
      toast.success(t`Updated job status`);
      cancelModal.onClose();
    }
  });
  const sendFetcher = useAction<typeof sendAction>({
    onSuccess: () => toast.success(t`Estimate sent`)
  });
  const completeFetcher = useAction<typeof completeAction>({
    onSuccess: () => toast.success(t`Job completed`)
  });
  const reopenFetcher = useAction<typeof reopenAction>({
    onSuccess: () => toast.success(t`Job reopened`)
  });
  const invoiceFetcher = useAction();

  const isBusy = [
    statusFetcher,
    sendFetcher,
    completeFetcher,
    reopenFetcher,
    invoiceFetcher
  ].some((fetcher) => fetcher.state !== "idle");

  const primaryAction = job ? serviceJobPrimaryAction(job) : null;
  const isLocked = isServiceJobLocked(status);

  const isAllowed = (action: ServiceJobStatusAction) =>
    !!status &&
    SERVICE_JOB_STATUS_TRANSITIONS[action].from.includes(status) &&
    canUpdate &&
    !isBusy;

  // Only a Billable job has an estimate; an accepted one is not sent again.
  const canSendEstimate =
    canUpdate &&
    !isLocked &&
    !isBusy &&
    hasEstimateLines &&
    job?.coverage === "Billable" &&
    job?.estimateStatus !== "Accepted";
  const canRecordResponse =
    canUpdate && !isLocked && !isBusy && job?.estimateStatus === "Sent";
  const canComplete =
    canUpdate &&
    !isBusy &&
    (status === "Open" || status === "In Progress" || status === "On Hold");
  const canInvoice =
    permissions.can("update", "service") &&
    permissions.can("create", "invoicing") &&
    !isBusy &&
    status === "Completed" &&
    job?.coverage === "Billable";

  const submitStatus = (action: ServiceJobStatusAction) => {
    statusFetcher.submit(
      { action },
      { method: "post", action: path.to.serviceJobStatus(jobId) }
    );
  };

  const sendEstimate = () => {
    sendFetcher.submit(
      {},
      { method: "post", action: path.to.serviceJobEstimateSend(jobId) }
    );
  };

  const menuItems = (
    <>
      <DropdownMenuItem disabled={!canSendEstimate} onClick={sendEstimate}>
        <DropdownMenuIcon icon={<LuSend />} />
        <Trans>Send Estimate</Trans>
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!hasEstimateLines}
        onClick={() =>
          window.open(path.to.file.serviceJobEstimate(jobId), "_blank")
        }
      >
        <DropdownMenuIcon icon={<LuFile />} />
        <Trans>Print Estimate</Trans>
      </DropdownMenuItem>
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
        disabled={status !== "Completed" || !canUpdate || isBusy}
        onClick={() =>
          reopenFetcher.submit(
            {},
            { method: "post", action: path.to.serviceJobReopen(jobId) }
          )
        }
      >
        <DropdownMenuIcon icon={<LuLoaderCircle />} />
        <Trans>Reopen</Trans>
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

  const primary = (() => {
    switch (primaryAction) {
      case "Start":
        return (
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
              isLoading={statusFetcher.state !== "idle"}
            >
              <Trans>Start</Trans>
            </Button>
          </statusFetcher.Form>
        );
      case "Send Estimate":
        return (
          <Button
            leftIcon={<LuSend />}
            variant="primary"
            isDisabled={!canSendEstimate}
            isLoading={sendFetcher.state !== "idle"}
            onClick={sendEstimate}
          >
            <Trans>Send Estimate</Trans>
          </Button>
        );
      case "Complete":
        return (
          <completeFetcher.Form
            method="post"
            action={path.to.serviceJobComplete(jobId)}
          >
            <Button
              type="submit"
              leftIcon={<LuCircleCheck />}
              variant="primary"
              isDisabled={!canComplete}
              isLoading={completeFetcher.state !== "idle"}
            >
              <Trans>Complete</Trans>
            </Button>
          </completeFetcher.Form>
        );
      case "Record Response":
        return (
          <Button
            leftIcon={<LuMessageSquareReply />}
            variant="primary"
            isDisabled={!canRecordResponse}
            onClick={responseModal.onOpen}
          >
            <Trans>Record Response</Trans>
          </Button>
        );
      case "Create Invoice":
        return (
          <invoiceFetcher.Form
            method="post"
            action={path.to.serviceJobInvoice(jobId)}
          >
            <Button
              type="submit"
              leftIcon={<LuReceipt />}
              variant="primary"
              isDisabled={!canInvoice}
              isLoading={invoiceFetcher.state !== "idle"}
            >
              <Trans>Create Invoice</Trans>
            </Button>
          </invoiceFetcher.Form>
        );
      default:
        return null;
    }
  })();

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
          primary ? <RecordAction slot="primary">{primary}</RecordAction> : null
        }
      />
      {responseModal.isOpen && (
        <EstimateResponseModal jobId={jobId} onClose={responseModal.onClose} />
      )}
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
