// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, DropdownMenuIcon, DropdownMenuItem } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuCircleCheck, LuCircleX, LuSend } from "react-icons/lu";
import { useFetcher } from "react-router";
import { DateTime, EmployeeAvatar } from "~/components";
import { DocumentPageHeader } from "~/components/DocumentPage";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { ProjectStockTransferAction } from "../../projects.models";
import type { ProjectStockTransfer } from "../../types";
import ProjectStockTransferStatus from "./ProjectStockTransferStatus";
import { useStockTransferTypeLabels } from "./useStockTransferTypeLabels";

type ProjectStockTransferHeaderProps = {
  transfer: ProjectStockTransfer;
  lineCount: number;
};

/**
 * The transfer's identity, status and next step: Approve while Draft, Post
 * once Approved. Cancel sits in the ⋯ menu until the transfer is posted.
 */
export default function ProjectStockTransferHeader({
  transfer,
  lineCount
}: ProjectStockTransferHeaderProps) {
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const typeLabels = useStockTransferTypeLabels();
  const canUpdate = permissions.can("update", "projects");
  const pendingAction = fetcher.formData?.get("action");
  const isBusy = fetcher.state !== "idle";

  const submit = (action: ProjectStockTransferAction) =>
    fetcher.submit(
      { action },
      {
        method: "post",
        action: path.to.projectStockTransferStatus(transfer.id)
      }
    );

  const status = transfer.status;

  return (
    <DocumentPageHeader
      title={transfer.projectStockTransferId}
      status={<ProjectStockTransferStatus status={status} />}
      meta={[
        <span key="type">{typeLabels[transfer.type]}</span>,
        <Trans key="created">
          Created <DateTime value={transfer.createdAt} variant="relative" /> by{" "}
          <EmployeeAvatar employeeId={transfer.createdBy} />
        </Trans>,
        transfer.approvedAt ? (
          <Trans key="approved">
            Approved <DateTime value={transfer.approvedAt} variant="relative" />{" "}
            by <EmployeeAvatar employeeId={transfer.approvedBy} />
          </Trans>
        ) : null,
        transfer.postedAt ? (
          <Trans key="posted">
            Posted <DateTime value={transfer.postedAt} variant="relative" />
          </Trans>
        ) : null
      ]}
      menuItems={
        <DropdownMenuItem
          destructive
          disabled={
            !canUpdate || isBusy || !["Draft", "Approved"].includes(status)
          }
          onClick={() => submit("cancel")}
        >
          <DropdownMenuIcon icon={<LuCircleX />} />
          <Trans>Cancel Transfer</Trans>
        </DropdownMenuItem>
      }
      actions={
        <>
          {status === "Draft" && (
            <Button
              variant="primary"
              leftIcon={<LuCircleCheck />}
              isDisabled={!canUpdate || isBusy || lineCount === 0}
              isLoading={pendingAction === "approve"}
              onClick={() => submit("approve")}
            >
              <Trans>Approve</Trans>
            </Button>
          )}
          {status === "Approved" && (
            <Button
              variant="primary"
              leftIcon={<LuSend />}
              isDisabled={!canUpdate || isBusy}
              isLoading={pendingAction === "post"}
              onClick={() => submit("post")}
            >
              <Trans>Post</Trans>
            </Button>
          )}
        </>
      }
    />
  );
}
