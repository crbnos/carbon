// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuChevronDown,
  LuGitPullRequestArrow,
  LuList,
  LuPlus
} from "react-icons/lu";
import { Link } from "react-router";
import { useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { ActiveChangeRequest } from "./ChangeRequestBanner";
import ChangeRequestStatus from "./ChangeRequestStatus";
import { NewChangeRequestModal } from "./NewChangeRequestModal";

/**
 * The project sidebar's picker of the plan on screen: the live plan, or one
 * open change request (`?cr=`). The other params stay as they are. It also
 * opens a new change request and links to all of them.
 */
export function ChangeRequestPicker({
  projectId,
  changeRequests,
  active,
  canCreate,
  className
}: {
  projectId: string;
  changeRequests: ActiveChangeRequest[];
  active: ActiveChangeRequest | null;
  /** The user may open a change request (`update: projects`, not Closed). */
  canCreate: boolean;
  className?: string;
}) {
  const [, setParams] = useUrlParams();
  const [isOpening, setIsOpening] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={active ? "active" : "secondary"}
            leftIcon={<LuGitPullRequestArrow />}
            rightIcon={<LuChevronDown className="ml-auto" />}
            className={cn("max-w-48 justify-start", className)}
          >
            <span className="truncate">
              {active ? active.readableId : <Trans>Current plan</Trans>}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuRadioGroup
            value={active?.id ?? "base"}
            onValueChange={(value) =>
              setParams({ cr: value === "base" ? null : value })
            }
          >
            <DropdownMenuRadioItem value="base">
              <span className="flex min-w-0 flex-col">
                <Trans>Current plan</Trans>
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
          <DropdownMenuItem
            disabled={!canCreate}
            onSelect={() => setIsOpening(true)}
          >
            <DropdownMenuIcon icon={<LuPlus />} />
            <Trans>New change request</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to={path.to.projectChangeRequests(projectId)}>
              <DropdownMenuIcon icon={<LuList />} />
              <Trans>All change requests</Trans>
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {isOpening && (
        <NewChangeRequestModal
          projectId={projectId}
          onClose={() => setIsOpening(false)}
        />
      )}
    </>
  );
}
