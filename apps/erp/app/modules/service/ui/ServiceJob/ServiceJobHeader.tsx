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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  useDisclosure
} from "@carbon/react";
import { isServiceJobLocked, serviceJobPrimaryAction } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef } from "react";
import {
  LuCircleCheck,
  LuCirclePause,
  LuCirclePlay,
  LuCircleX,
  LuCreditCard,
  LuEye,
  LuLoaderCircle,
  LuPlay,
  LuSend,
  LuTvMinimalPlay,
  LuUndo2
} from "react-icons/lu";
import { Link, useParams } from "react-router";
import { RecordAction, RecordHeader } from "~/components/Layout/RecordHeader";
import { usePermissions, useRouteData } from "~/hooks";
import type { action as completeAction } from "~/routes/x+/service-job+/$jobId.complete";
import type { action as estimateReopenAction } from "~/routes/x+/service-job+/$jobId.estimate.reopen";
import type { action as responseAction } from "~/routes/x+/service-job+/$jobId.estimate.response";
import type { action as reopenAction } from "~/routes/x+/service-job+/$jobId.reopen";
import type { action as statusAction } from "~/routes/x+/service-job+/$jobId.status";
import type { action as stopClockAction } from "~/routes/x+/service-job+/$jobId.stop-clock";
import { path } from "~/utils/path";
import type { ServiceJobStatusAction } from "../../service.models";
import { SERVICE_JOB_STATUS_TRANSITIONS } from "../../service.models";
import type {
  ServiceJobDetail,
  ServiceJobEstimateLine,
  ServiceJobItem,
  ServiceJobTime
} from "../../types";
import CoverageBadge from "./CoverageBadge";
import EstimateSendModal from "./EstimateSendModal";
import ServiceJobActionModal from "./ServiceJobActionModal";
import ServiceJobStatus from "./ServiceJobStatus";

const ServiceJobHeader = () => {
  const { t } = useLingui();
  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  const routeData = useRouteData<{
    job: ServiceJobDetail;
    estimateLines: ServiceJobEstimateLine[];
    time: ServiceJobTime[];
    items: ServiceJobItem[];
  }>(path.to.serviceJob(jobId));
  const job = routeData?.job;
  const status = job?.status;
  const returnLine = job?.salesReturnOrderLine;
  const returnOrder = returnLine?.salesReturnOrder;
  const hasEstimateLines = (routeData?.estimateLines.length ?? 0) > 0;
  const time = routeData?.time ?? [];
  const hasRunningClock = time.some(
    (entry) => entry.startTime !== null && entry.endTime === null
  );
  // Cancel is refused while the job has time or issued parts.
  const hasWork =
    time.length > 0 ||
    (routeData?.items ?? []).some((item) => item.lineType === "Part");
  const needsFixedPrice =
    job?.billingMethod === "Fixed Price" && job?.fixedPrice === null;

  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "service");
  const cancelModal = useDisclosure();
  const sendModal = useDisclosure();
  const completeModal = useDisclosure();
  const invoiceModal = useDisclosure();
  // The price the Complete dialog asked for, kept while the clock stops.
  const completeFixedPrice = useRef<number | undefined>(undefined);

  const statusFetcher = useAction<typeof statusAction>({
    onSuccess: () => {
      toast.success(t`Updated job status`);
      cancelModal.onClose();
    }
  });
  const completeFetcher = useAction<typeof completeAction>({
    onSuccess: () => {
      toast.success(t`Job completed`);
      completeModal.onClose();
    }
  });
  const estimateReopenFetcher = useAction<typeof estimateReopenAction>({
    onSuccess: () => toast.success(t`Estimate reopened`)
  });
  const reopenFetcher = useAction<typeof reopenAction>({
    onSuccess: () => toast.success(t`Job reopened`)
  });
  const responseFetcher = useAction<typeof responseAction>({
    onSuccess: () => toast.success(t`Recorded the customer's answer`)
  });
  const invoiceFetcher = useAction({
    onSettled: () => invoiceModal.onClose()
  });

  const submitComplete = (fixedPrice: number | undefined) => {
    completeFetcher.submit(
      fixedPrice === undefined ? {} : { fixedPrice: String(fixedPrice) },
      { method: "post", action: path.to.serviceJobComplete(jobId) }
    );
  };
  // Stop clock and complete: the clocks stop and post first.
  const stopClockFetcher = useAction<typeof stopClockAction>({
    onSuccess: (result) => {
      if (result.data?.warning) toast.warning(result.data.warning);
      submitComplete(completeFixedPrice.current);
    }
  });

  const isBusy = [
    statusFetcher,
    completeFetcher,
    stopClockFetcher,
    reopenFetcher,
    estimateReopenFetcher,
    responseFetcher,
    invoiceFetcher
  ].some((fetcher) => fetcher.state !== "idle");
  const isCompleting =
    completeFetcher.state !== "idle" || stopClockFetcher.state !== "idle";

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
  // Sending the estimate is the next step while an Open Billable job has an
  // estimate the customer has not seen: Send is primary and Start steps back.
  const isEstimateNext =
    status === "Open" &&
    job?.coverage === "Billable" &&
    hasEstimateLines &&
    job?.estimateStatus !== "Sent" &&
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

  const confirmComplete = (fixedPrice: number | undefined) => {
    if (hasRunningClock) {
      completeFixedPrice.current = fixedPrice;
      stopClockFetcher.submit(
        {},
        { method: "post", action: path.to.serviceJobStopClock(jobId) }
      );
      return;
    }
    submitComplete(fixedPrice);
  };

  const confirmInvoice = (fixedPrice: number | undefined) => {
    invoiceFetcher.submit(
      fixedPrice === undefined ? {} : { fixedPrice: String(fixedPrice) },
      { method: "post", action: path.to.serviceJobInvoice(jobId) }
    );
  };

  // Accept starts the repair; Reject marks the unit not repairable.
  const respond = (response: "Accepted" | "Declined") => {
    responseFetcher.submit(
      { response },
      { method: "post", action: path.to.serviceJobEstimateResponse(jobId) }
    );
  };
  const respondingWith =
    responseFetcher.state !== "idle"
      ? responseFetcher.formData?.get("response")
      : null;

  // Reopen steps back one stage: a Completed job reopens; otherwise a sent or
  // answered estimate goes back to Draft, to be edited and sent again.
  const canReopenJob = status === "Completed";
  const canReopenEstimate =
    !isLocked &&
    (job?.estimateStatus === "Sent" ||
      job?.estimateStatus === "Accepted" ||
      job?.estimateStatus === "Declined");
  const reopen = () => {
    if (canReopenJob) {
      reopenFetcher.submit(
        {},
        { method: "post", action: path.to.serviceJobReopen(jobId) }
      );
    } else if (canReopenEstimate) {
      estimateReopenFetcher.submit(
        {},
        { method: "post", action: path.to.serviceJobEstimateReopen(jobId) }
      );
    }
  };

  const menuItems = (
    <>
      <DropdownMenuItem asChild>
        <a
          href={path.to.external.mesServiceJob(jobId)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <DropdownMenuIcon icon={<LuTvMinimalPlay />} />
          <Trans>Open in MES</Trans>
        </a>
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
        disabled={!(canReopenJob || canReopenEstimate) || !canUpdate || isBusy}
        onClick={reopen}
      >
        <DropdownMenuIcon icon={<LuLoaderCircle />} />
        <Trans>Reopen</Trans>
      </DropdownMenuItem>
      {hasWork ? (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* A disabled item fires no pointer events: the span does. */}
            <span tabIndex={0} className="block">
              <DropdownMenuItem destructive disabled>
                <DropdownMenuIcon icon={<LuCircleX />} />
                <Trans>Cancel Job</Trans>
              </DropdownMenuItem>
            </span>
          </TooltipTrigger>
          <TooltipContent side="left">
            <Trans>Remove the time entries and return the parts first.</Trans>
          </TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenuItem
          destructive
          disabled={!isAllowed("Cancel")}
          onClick={cancelModal.onOpen}
        >
          <DropdownMenuIcon icon={<LuCircleX />} />
          <Trans>Cancel Job</Trans>
        </DropdownMenuItem>
      )}
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
              variant={isEstimateNext ? "secondary" : "primary"}
              isDisabled={!isAllowed("Start")}
              isLoading={statusFetcher.state !== "idle"}
            >
              <Trans>Start</Trans>
            </Button>
          </statusFetcher.Form>
        );
      case "Complete":
        return (
          <Button
            leftIcon={<LuCircleCheck />}
            variant="primary"
            isDisabled={!canComplete}
            isLoading={isCompleting}
            onClick={completeModal.onOpen}
          >
            <Trans>Complete</Trans>
          </Button>
        );
      // Accept and Reject answer a sent estimate (below).
      case "Record Response":
        return null;
      case "Create Invoice":
        return (
          <Button
            leftIcon={<LuCreditCard />}
            variant="primary"
            isDisabled={!canInvoice}
            isLoading={invoiceFetcher.state !== "idle"}
            onClick={invoiceModal.onOpen}
          >
            <Trans>Invoice</Trans>
          </Button>
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
          <>
            {returnLine && returnOrder && (
              <RecordAction slot="overflow">
                <Button leftIcon={<LuUndo2 />} variant="secondary" asChild>
                  <Link
                    to={path.to.salesReturnOrderLine(
                      returnOrder.id,
                      returnLine.id
                    )}
                  >
                    {returnOrder.salesReturnOrderId}
                  </Link>
                </Button>
              </RecordAction>
            )}
            {(job?.coverage === "Billable" || hasEstimateLines) && (
              <RecordAction slot="icon">
                <Button
                  leftIcon={<LuEye />}
                  variant="secondary"
                  isDisabled={!hasEstimateLines}
                  onClick={() =>
                    window.open(
                      path.to.file.serviceJobEstimate(jobId),
                      "_blank"
                    )
                  }
                >
                  <Trans>Preview</Trans>
                </Button>
              </RecordAction>
            )}
            {job?.coverage === "Billable" && (
              <RecordAction slot={isEstimateNext ? "primary" : "overflow"}>
                <Button
                  leftIcon={<LuSend />}
                  variant={isEstimateNext ? "primary" : "secondary"}
                  isDisabled={!canSendEstimate}
                  onClick={sendModal.onOpen}
                >
                  <Trans>Send</Trans>
                </Button>
              </RecordAction>
            )}
            {job?.estimateStatus === "Sent" && (
              <>
                <RecordAction slot="primary">
                  <Button
                    leftIcon={<LuCircleCheck />}
                    variant="primary"
                    isDisabled={!canRecordResponse}
                    isLoading={respondingWith === "Accepted"}
                    onClick={() => respond("Accepted")}
                  >
                    <Trans>Accept</Trans>
                  </Button>
                </RecordAction>
                <RecordAction slot="secondary">
                  <Button
                    leftIcon={<LuCircleX />}
                    variant="destructive"
                    isDisabled={!canRecordResponse}
                    isLoading={respondingWith === "Declined"}
                    onClick={() => respond("Declined")}
                  >
                    <Trans>Reject</Trans>
                  </Button>
                </RecordAction>
              </>
            )}
            {primary && (
              <RecordAction
                slot={
                  primaryAction === "Start" && isEstimateNext
                    ? "overflow"
                    : "primary"
                }
              >
                {primary}
              </RecordAction>
            )}
          </>
        }
      />
      {job && (
        <EstimateSendModal
          open={sendModal.isOpen}
          jobId={jobId}
          serviceJobId={job.serviceJobId}
          customerId={job.customerId}
          customerContactId={job.customerContactId}
          onClose={sendModal.onClose}
        />
      )}
      <ServiceJobActionModal
        open={completeModal.isOpen}
        title={<Trans>Complete {job?.serviceJobId}</Trans>}
        description={
          hasRunningClock ? (
            <Trans>A clock is still running on this job.</Trans>
          ) : (
            <Trans>
              The job closes. Its time and parts cannot change until it is
              reopened.
            </Trans>
          )
        }
        submitLabel={
          hasRunningClock ? (
            <Trans>Stop clock and complete</Trans>
          ) : (
            <Trans>Complete</Trans>
          )
        }
        needsFixedPrice={needsFixedPrice}
        isPending={isCompleting}
        onConfirm={confirmComplete}
        onClose={completeModal.onClose}
      />
      <ServiceJobActionModal
        open={invoiceModal.isOpen}
        title={<Trans>Invoice {job?.serviceJobId}</Trans>}
        description={
          <Trans>
            A draft sales invoice is created for the job, and the job becomes
            Invoiced.
          </Trans>
        }
        submitLabel={<Trans>Create Invoice</Trans>}
        needsFixedPrice={needsFixedPrice}
        isPending={invoiceFetcher.state !== "idle"}
        onConfirm={confirmInvoice}
        onClose={invoiceModal.onClose}
      />
      <Modal
        open={cancelModal.isOpen}
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
    </>
  );
};

export default ServiceJobHeader;
