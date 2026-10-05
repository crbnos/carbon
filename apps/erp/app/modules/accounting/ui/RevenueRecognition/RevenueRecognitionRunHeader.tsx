// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  Button,
  DropdownMenuIcon,
  DropdownMenuItem,
  useDisclosure
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuCheckCheck,
  LuRefreshCw,
  LuRepeat,
  LuRotateCcw,
  LuTrash
} from "react-icons/lu";
import { useFetcher, useNavigate, useParams } from "react-router";
import { DateTime, EmployeeAvatar } from "~/components";
import { DocumentPageHeader } from "~/components/DocumentPage";
import { Confirm, ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import RevenueRecognitionRunStatus from "./RevenueRecognitionRunStatus";

type RevenueRecognitionRun =
  Database["public"]["Tables"]["revenueRecognitionRun"]["Row"];

const RevenueRecognitionRunHeader = () => {
  const { t } = useLingui();
  const { runId } = useParams();
  if (!runId) throw new Error("runId not found");

  const routeData = useRouteData<{
    run: RevenueRecognitionRun;
    nextPeriodEnd: string;
    canRepeat: boolean;
  }>(path.to.revenueRecognitionRun(runId));

  const permissions = usePermissions();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const deleteModal = useDisclosure();
  const repeatModal = useDisclosure();
  const recalculateModal = useDisclosure();
  const reverseModal = useDisclosure();

  const run = routeData?.run;
  if (!run) throw new Error("Could not find run in routeData");
  const nextPeriodEnd = routeData?.nextPeriodEnd ?? run.periodEnd;
  const canRepeat = routeData?.canRepeat ?? false;

  const isDraft = run.status === "Draft";
  const isPosted = run.status === "Posted";

  return (
    <>
      <DocumentPageHeader
        title={run.runId}
        status={<RevenueRecognitionRunStatus status={run.status} />}
        meta={[
          <Trans key="created">
            Created <DateTime value={run.createdAt} variant="relative" /> by{" "}
            <EmployeeAvatar employeeId={run.createdBy} />
          </Trans>,
          run.postedAt ? (
            run.postedBy ? (
              <Trans key="posted">
                Posted <DateTime value={run.postedAt} variant="date" /> by{" "}
                <EmployeeAvatar employeeId={run.postedBy} />
              </Trans>
            ) : (
              <Trans key="posted">
                Posted <DateTime value={run.postedAt} variant="date" />
              </Trans>
            )
          ) : null
        ]}
        menuItems={
          isDraft || isPosted ? (
            <>
              {isPosted && canRepeat && (
                <DropdownMenuItem
                  disabled={!permissions.can("create", "accounting")}
                  onClick={repeatModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuRepeat />} />
                  <Trans>Repeat Run</Trans>
                </DropdownMenuItem>
              )}
              {isPosted && (
                <DropdownMenuItem
                  disabled={!permissions.can("update", "accounting")}
                  destructive
                  onClick={reverseModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuRotateCcw />} />
                  <Trans>Reverse Run</Trans>
                </DropdownMenuItem>
              )}
              {isDraft && (
                <DropdownMenuItem
                  disabled={!permissions.can("delete", "accounting")}
                  destructive
                  onClick={deleteModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete</Trans>
                </DropdownMenuItem>
              )}
            </>
          ) : undefined
        }
        actions={
          isDraft && permissions.can("update", "accounting") ? (
            <>
              <Button
                variant="secondary"
                leftIcon={<LuRefreshCw />}
                onClick={recalculateModal.onOpen}
              >
                <Trans>Recalculate</Trans>
              </Button>
              <fetcher.Form
                method="post"
                action={path.to.postRevenueRecognitionRun(runId)}
              >
                <Button
                  variant="primary"
                  type="submit"
                  leftIcon={<LuCheckCheck />}
                  isLoading={fetcher.state !== "idle"}
                >
                  <Trans>Post</Trans>
                </Button>
              </fetcher.Form>
            </>
          ) : undefined
        }
      />

      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteRevenueRecognitionRun(runId)}
          isOpen={deleteModal.isOpen}
          name={run.runId}
          text={t`Are you sure you want to delete ${run.runId}? This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={() => {
            deleteModal.onClose();
            navigate(path.to.revenueRecognitionRuns);
          }}
        />
      )}

      {reverseModal.isOpen && (
        <ConfirmDelete
          action={path.to.reverseRevenueRecognitionRun(runId)}
          isOpen={reverseModal.isOpen}
          name={run.runId}
          title={t`Reverse ${run.runId}`}
          deleteText={t`Reverse Run`}
          text={t`This will reverse the journals of ${run.runId} and return it to Draft. You can then recalculate, post or delete it.`}
          onCancel={reverseModal.onClose}
          onSubmit={reverseModal.onClose}
        />
      )}

      {recalculateModal.isOpen && (
        <Confirm
          action={path.to.recalculateRevenueRecognitionRun(runId)}
          isOpen={recalculateModal.isOpen}
          title={t`Recalculate Run`}
          text={t`This will rebuild ${run.runId} from the revenue schedule as it is now: every schedule row due on or before ${formatDate(run.periodEnd)} that no other run holds.`}
          confirmText={t`Recalculate`}
          onCancel={recalculateModal.onClose}
          onSubmit={recalculateModal.onClose}
        />
      )}

      {repeatModal.isOpen && (
        <Confirm
          action={path.to.repeatRevenueRecognitionRun(runId)}
          isOpen={repeatModal.isOpen}
          title={t`Repeat Run`}
          text={t`This will create a draft revenue recognition run for the next period, ending ${formatDate(nextPeriodEnd)}. Every schedule row due on or before that date will be included.`}
          confirmText={t`Create Run`}
          onCancel={repeatModal.onClose}
          onSubmit={repeatModal.onClose}
        />
      )}
    </>
  );
};

export default RevenueRecognitionRunHeader;
