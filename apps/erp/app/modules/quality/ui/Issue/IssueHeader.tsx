// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MENU_ITEM_SHORTCUTS,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuChevronDown,
  LuCircleCheck,
  LuCirclePlay,
  LuExternalLink,
  LuFile,
  LuGitPullRequestArrow,
  LuLoaderCircle,
  LuTrash
} from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { RecordAction, RecordHeader } from "~/components/Layout/RecordHeader";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData } from "~/hooks";
import { useSuppliers } from "~/stores/suppliers";
import { path } from "~/utils/path";
import { isIssueLocked } from "../../quality.models";
import type { Issue } from "../../types";
import IssueStatus from "./IssueStatus";

const IssueHeader = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    nonConformance: Issue;
    suppliers: { supplierId: string; externalLinkId: string | null }[];
  }>(path.to.issue(id));

  const status = routeData?.nonConformance?.status;
  const { t } = useLingui();
  const permissions = usePermissions();
  const statusFetcher = useFetcher<{}>();
  const [suppliers] = useSuppliers();
  const deleteIssueModal = useDisclosure();

  const statusBadge = <IssueStatus status={status} />;
  const menuItems = (
    <>
      <DropdownMenuItem disabled={!permissions.can("create", "parts")} asChild>
        <Link
          to={`${
            path.to.newChangeNotice
          }?sourceType=nonConformance&sourceId=${id}&name=${encodeURIComponent(
            routeData?.nonConformance?.nonConformanceId ?? ""
          )}`}
        >
          <DropdownMenuIcon icon={<LuGitPullRequestArrow />} />
          <Trans>Create Change Notice</Trans>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={
          !["In Progress", "Closed"].includes(status ?? "") ||
          statusFetcher.state !== "idle" ||
          !permissions.can("update", "quality")
        }
        onClick={() => {
          statusFetcher.submit(
            { status: "Registered" },
            { method: "post", action: path.to.issueStatus(id) }
          );
        }}
      >
        <DropdownMenuIcon icon={<LuLoaderCircle />} />
        <Trans>Reopen</Trans>
      </DropdownMenuItem>
      <DropdownMenuItem
        shortcut={MENU_ITEM_SHORTCUTS.delete}
        destructive
        disabled={
          !permissions.can("delete", "quality") ||
          !permissions.is("employee") ||
          isIssueLocked(status)
        }
        onClick={deleteIssueModal.onOpen}
      >
        <DropdownMenuIcon icon={<LuTrash />} />
        <Trans>Delete Issue</Trans>
      </DropdownMenuItem>
    </>
  );

  return (
    <>
      <RecordHeader
        title={routeData?.nonConformance?.nonConformanceId}
        titleTo={path.to.issueDetails(id)}
        copyValue={routeData?.nonConformance?.nonConformanceId ?? ""}
        menu={menuItems}
        status={statusBadge}
        subtitle={routeData?.nonConformance?.name}
        actions={
          <>
            <RecordAction slot="overflow">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    leftIcon={<LuFile />}
                    variant="secondary"
                    rightIcon={<LuChevronDown />}
                  >
                    <Trans>Reports</Trans>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {routeData?.suppliers?.map((s) => {
                    if (!s.externalLinkId) return null;
                    const supplier = suppliers.find(
                      (sup) => sup.id === s.supplierId
                    );
                    return (
                      <DropdownMenuItem key={s.supplierId} asChild>
                        <Link to={path.to.externalScar(s.externalLinkId)}>
                          <DropdownMenuIcon icon={<LuExternalLink />} />
                          {supplier?.name} <Trans>SCAR</Trans>
                        </Link>
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuItem asChild>
                    <a
                      target="_blank"
                      href={path.to.file.nonConformance(id)}
                      rel="noreferrer"
                    >
                      <DropdownMenuIcon icon={<LuFile />} />
                      <Trans>Report</Trans>
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </RecordAction>
            <RecordAction
              slot={status === "Registered" ? "primary" : "secondary"}
            >
              <statusFetcher.Form
                method="post"
                action={path.to.issueStatus(id)}
              >
                <input type="hidden" name="status" value="In Progress" />
                <Button
                  type="submit"
                  leftIcon={<LuCirclePlay />}
                  variant={status === "Registered" ? "primary" : "secondary"}
                  isDisabled={
                    status !== "Registered" ||
                    statusFetcher.state !== "idle" ||
                    !permissions.can("update", "quality")
                  }
                  isLoading={
                    statusFetcher.state !== "idle" &&
                    statusFetcher.formData?.get("status") === "In Progress"
                  }
                >
                  <Trans>Start</Trans>
                </Button>
              </statusFetcher.Form>
            </RecordAction>

            <RecordAction
              slot={status === "Registered" ? "secondary" : "primary"}
            >
              <statusFetcher.Form method="post" action={path.to.closeIssue(id)}>
                <Button
                  type="submit"
                  leftIcon={<LuCircleCheck />}
                  variant={status === "In Progress" ? "primary" : "secondary"}
                  isDisabled={
                    status !== "In Progress" ||
                    statusFetcher.state !== "idle" ||
                    !permissions.can("update", "quality")
                  }
                  isLoading={
                    statusFetcher.state !== "idle" &&
                    statusFetcher.formAction === path.to.closeIssue(id)
                  }
                >
                  <Trans>Complete</Trans>
                </Button>
              </statusFetcher.Form>
            </RecordAction>
          </>
        }
      />
      {deleteIssueModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteIssue(id)}
          isOpen={deleteIssueModal.isOpen}
          name={routeData?.nonConformance?.nonConformanceId!}
          text={t`Are you sure you want to delete ${routeData?.nonConformance
            ?.nonConformanceId!}? This cannot be undone.`}
          onCancel={() => {
            deleteIssueModal.onClose();
          }}
          onSubmit={() => {
            deleteIssueModal.onClose();
          }}
        />
      )}
    </>
  );
};

export default IssueHeader;
