// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuGitPullRequestArrow, LuLogOut } from "react-icons/lu";
import { Link, useLocation, useSearchParams } from "react-router";
import { path } from "~/utils/path";
import type { ProjectChangeRequestStatus } from "../../projects.models";
import ChangeRequestStatus from "./ChangeRequestStatus";

export type ActiveChangeRequest = {
  id: string;
  readableId: string;
  title: string;
  status: ProjectChangeRequestStatus;
};

/**
 * Shown on the Elements page and the element page while a change request is
 * open (`?cr=`). Plan-layer edits go into it; Leave goes back to the live plan.
 */
const ChangeRequestBanner = ({
  projectId,
  changeRequest
}: {
  projectId: string;
  changeRequest: ActiveChangeRequest;
}) => {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const leave = new URLSearchParams(searchParams);
  leave.delete("cr");
  const isDraft = changeRequest.status === "Draft";

  return (
    <div className="@container flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-muted/40 px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        <LuGitPullRequestArrow className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">
          {isDraft ? (
            <Trans>
              Editing{" "}
              <span className="font-medium">{changeRequest.readableId}</span>:{" "}
              {changeRequest.title}. Changes go to this change request.
            </Trans>
          ) : (
            <Trans>
              Viewing{" "}
              <span className="font-medium">{changeRequest.readableId}</span>:{" "}
              {changeRequest.title}. It is not a Draft, so it takes no changes.
            </Trans>
          )}
        </span>
        <ChangeRequestStatus status={changeRequest.status} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="secondary" size="sm" asChild>
          <Link to={path.to.projectChangeRequest(projectId, changeRequest.id)}>
            <Trans>Review</Trans>
          </Link>
        </Button>
        <Button variant="ghost" size="sm" leftIcon={<LuLogOut />} asChild>
          <Link to={`${pathname}${leave.size > 0 ? `?${leave}` : ""}`}>
            <Trans>Leave</Trans>
          </Link>
        </Button>
      </div>
    </div>
  );
};

export default ChangeRequestBanner;
