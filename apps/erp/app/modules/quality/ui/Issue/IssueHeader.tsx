import {
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuChevronDown,
  LuCircleCheck,
  LuCirclePlay,
  LuEllipsisVertical,
  LuExternalLink,
  LuFile,
  LuGitPullRequestArrow,
  LuLoaderCircle,
  LuTrash
} from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
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

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]">
        <VStack spacing={0}>
          <HStack>
            <Link to={path.to.issueDetails(id)}>
              <Heading size="h4" className="flex items-center gap-2">
                {/* <ModuleIcon icon={<MethodItemTypeIcon type="Part" />} /> */}
                <span>{routeData?.nonConformance?.nonConformanceId}</span>
              </Heading>
            </Link>
            <IssueStatus status={status} />
            <Copy text={routeData?.nonConformance?.nonConformanceId ?? ""} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label={t`More options`}
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                  size="sm"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  disabled={!permissions.can("create", "parts")}
                  asChild
                >
                  <Link
                    to={`${
                      path.to.newChangeOrder
                    }?sourceType=nonConformance&sourceId=${id}&name=${encodeURIComponent(
                      routeData?.nonConformance?.nonConformanceId ?? ""
                    )}`}
                  >
                    <DropdownMenuIcon icon={<LuGitPullRequestArrow />} />
                    <Trans>Create Change Order</Trans>
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
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>
        </VStack>

        <HStack>
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
          <statusFetcher.Form method="post" action={path.to.issueStatus(id)}>
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
        </HStack>
      </div>
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
