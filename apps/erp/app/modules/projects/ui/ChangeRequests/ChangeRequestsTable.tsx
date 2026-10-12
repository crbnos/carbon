// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button } from "@carbon/react";
import { Plural, Trans } from "@lingui/react/macro";
import { useState } from "react";
import { LuGitPullRequestArrow, LuPlus } from "react-icons/lu";
import { Link } from "react-router";
import EmployeeAvatar from "~/components/EmployeeAvatar";
import { useDateFormatter, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { ProjectChangeRequestListItem } from "../../types";
import ChangeRequestStatus from "./ChangeRequestStatus";
import { NewChangeRequestModal } from "./NewChangeRequestModal";

type ChangeRequestsTableProps = {
  projectId: string;
  changeRequests: ProjectChangeRequestListItem[];
  isClosed: boolean;
};

/** The change requests of a project, newest first, with New change request. */
const ChangeRequestsTable = ({
  projectId,
  changeRequests,
  isClosed
}: ChangeRequestsTableProps) => {
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "projects") && !isClosed;
  const [isOpening, setIsOpening] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-[80rem] flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-medium">
          <Trans>Change Requests</Trans>
        </h2>
        <Button
          variant="secondary"
          leftIcon={<LuPlus />}
          isDisabled={!canUpdate}
          onClick={() => setIsOpening(true)}
        >
          <Trans>New Change Request</Trans>
        </Button>
      </div>

      {changeRequests.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <LuGitPullRequestArrow className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            <Trans>
              No change requests yet. Open one to change the plan in a draft
              that reviewers approve before it applies.
            </Trans>
          </p>
          <Button
            leftIcon={<LuPlus />}
            isDisabled={!canUpdate}
            onClick={() => setIsOpening(true)}
          >
            <Trans>Open the first change request</Trans>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col rounded-lg border border-border bg-card">
          {changeRequests.map((changeRequest) => (
            <ChangeRequestRow
              key={changeRequest.id}
              projectId={projectId}
              changeRequest={changeRequest}
            />
          ))}
        </div>
      )}

      {isOpening && (
        <NewChangeRequestModal
          projectId={projectId}
          onClose={() => setIsOpening(false)}
        />
      )}
    </div>
  );
};

function ChangeRequestRow({
  projectId,
  changeRequest
}: {
  projectId: string;
  changeRequest: ProjectChangeRequestListItem;
}) {
  const { formatDate } = useDateFormatter();
  const itemCount = changeRequest.items?.[0]?.count ?? 0;

  return (
    <Link
      to={path.to.projectChangeRequest(projectId, changeRequest.id)}
      className="@container flex flex-col gap-1 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-accent/50 @min-[42rem]:flex-row @min-[42rem]:items-center @min-[42rem]:gap-4"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 whitespace-nowrap text-sm font-medium">
          {changeRequest.readableId}
        </span>
        <span className="truncate text-sm">{changeRequest.title}</span>
        <span className="shrink-0">
          <ChangeRequestStatus status={changeRequest.status} />
        </span>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
        <span className="whitespace-nowrap">
          <Plural value={itemCount} one="# change" other="# changes" />
        </span>
        {changeRequest.submittedAt && (
          <span className="whitespace-nowrap">
            <Trans>Submitted {formatDate(changeRequest.submittedAt)}</Trans>
          </span>
        )}
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <EmployeeAvatar employeeId={changeRequest.createdBy} size="xxs" />
          {formatDate(changeRequest.createdAt)}
        </span>
      </div>
    </Link>
  );
}

export default ChangeRequestsTable;
