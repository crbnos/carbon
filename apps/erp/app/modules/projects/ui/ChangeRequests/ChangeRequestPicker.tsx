// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuChevronDown, LuGitPullRequestArrow } from "react-icons/lu";
import { Link } from "react-router";
import { useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { ActiveChangeRequest } from "./ChangeRequestBanner";
import ChangeRequestStatus from "./ChangeRequestStatus";

/**
 * The Elements header's picker of the plan on screen: the live plan, or one
 * open change request (`?cr=`). The other params stay as they are.
 */
export function ChangeRequestPicker({
  projectId,
  changeRequests,
  active
}: {
  projectId: string;
  changeRequests: ActiveChangeRequest[];
  active: ActiveChangeRequest | null;
}) {
  const [, setParams] = useUrlParams();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={active ? "active" : "secondary"}
          leftIcon={<LuGitPullRequestArrow />}
          rightIcon={<LuChevronDown />}
          className="max-w-48"
        >
          <span className="truncate">
            {active ? active.readableId : <Trans>Live plan</Trans>}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuRadioGroup
          value={active?.id ?? "base"}
          onValueChange={(value) =>
            setParams({ cr: value === "base" ? null : value })
          }
        >
          <DropdownMenuRadioItem value="base">
            <span className="flex min-w-0 flex-col">
              <Trans>Live plan</Trans>
              <span className="text-xs text-muted-foreground">
                <Trans>No change request</Trans>
              </span>
            </span>
          </DropdownMenuRadioItem>
          <DropdownMenuLabel>
            <Trans>Open change requests</Trans>
          </DropdownMenuLabel>
          {changeRequests.map((changeRequest) => (
            <DropdownMenuRadioItem
              key={changeRequest.id}
              value={changeRequest.id}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="shrink-0 font-mono text-xs">
                  {changeRequest.readableId}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {changeRequest.title}
                </span>
                <ChangeRequestStatus status={changeRequest.status} />
              </span>
            </DropdownMenuRadioItem>
          ))}
          {changeRequests.length === 0 && (
            <DropdownMenuItem disabled>
              <Trans>No open change requests</Trans>
            </DropdownMenuItem>
          )}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={path.to.projectChangeRequests(projectId)}>
            <Trans>All change requests</Trans>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
