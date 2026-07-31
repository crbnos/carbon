import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuIcon,
  MenuItem
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import {
  LuChevronDown,
  LuCirclePlus,
  LuGitPullRequestArrow,
  LuTrash
} from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { WorkflowVersionSummary } from "../../workflows.service";

type VersionMenuProps = {
  workflowId: string;
  versionId: string;
  activeVersionId: string | null;
  versions: WorkflowVersionSummary[];
};

export function VersionMenu({
  workflowId,
  versionId,
  activeVersionId,
  versions
}: VersionMenuProps) {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const fetcher = useFetcher();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          leftIcon={<LuGitPullRequestArrow />}
          rightIcon={<LuChevronDown />}
        >
          <Trans>Versions</Trans>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {permissions.can("create", "workflows") && (
          <>
            <DropdownMenuItem
              onClick={() => {
                const formData = new FormData();
                formData.set("copyFromVersionId", versionId);
                fetcher.submit(formData, {
                  method: "post",
                  action: path.to.workflowVersionNew(workflowId)
                });
              }}
            >
              <DropdownMenuIcon icon={<LuCirclePlus />} />
              <Trans>New version</Trans>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuRadioGroup
          value={versionId}
          onValueChange={(value) =>
            navigate(`${path.to.workflow(workflowId)}?version=${value}`)
          }
        >
          {versions.map((version) => (
            <DropdownMenuRadioItem key={version.id} value={version.id}>
              <Badge variant="outline">v{version.versionNumber}</Badge>
              {version.id === activeVersionId && (
                <Badge variant="green" className="ml-2">
                  <Trans>Live</Trans>
                </Badge>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {permissions.can("delete", "workflows") &&
          versionId !== activeVersionId &&
          versions.length > 1 && (
            <>
              <DropdownMenuSeparator />
              <MenuItem
                destructive
                onClick={() => {
                  fetcher.submit(new FormData(), {
                    method: "post",
                    action: path.to.workflowVersionDelete(workflowId, versionId)
                  });
                }}
              >
                <MenuIcon icon={<LuTrash />} />
                <Trans>Delete this version</Trans>
              </MenuItem>
            </>
          )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
