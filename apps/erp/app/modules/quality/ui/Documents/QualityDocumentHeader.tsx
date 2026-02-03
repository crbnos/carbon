import {
  Badge,
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure,
  VStack
} from "@carbon/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { Suspense, useEffect, useState } from "react";
import {
  LuCheckCheck,
  LuChevronDown,
  LuCirclePlus,
  LuClipboardCheck,
  LuEllipsisVertical,
  LuGitPullRequestArrow,
  LuPanelLeft,
  LuPanelRight,
  LuTrash,
  LuX
} from "react-icons/lu";
import { Await, useFetcher, useNavigate, useParams } from "react-router";
import { usePanels } from "~/components/Layout";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData } from "~/hooks";
import type { ApprovalDecision } from "~/modules/shared/types";
import { path } from "~/utils/path";
import type { QualityDocument } from "../../types";
import QualityDocumentApprovalModal from "./QualityDocumentApprovalModal";
import QualityDocumentForm from "./QualityDocumentForm";
import QualityDocumentStatus from "./QualityDocumentStatus";

const QualityDocumentHeader = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    document: QualityDocument;
    versions: PostgrestResponse<QualityDocument>;
    approvalRequest: { id: string } | null;
    canApprove: boolean;
    canReopen: boolean;
    canDelete: boolean;
    isApprovalRequired: boolean;
  }>(path.to.qualityDocument(id));

  const navigate = useNavigate();
  const permissions = usePermissions();
  const { toggleExplorer, toggleProperties } = usePanels();
  const newVersionDisclosure = useDisclosure();
  const deleteDisclosure = useDisclosure();
  const statusFetcher = useFetcher<{ error?: { message: string } }>();
  const approvalFetcher = useFetcher<{
    error?: string;
    success?: boolean;
  }>();
  const [approvalDecision, setApprovalDecision] =
    useState<ApprovalDecision | null>(null);

  const status = routeData?.document?.status ?? null;
  const isDraft = status === "Draft";
  const isArchived = status === "Archived";
  const canActivate = isDraft || isArchived;
  const approvalRequestId = routeData?.approvalRequest?.id;
  const hasApprovalRequest = !!approvalRequestId;
  const canApprove = routeData?.canApprove ?? false;
  const canDelete = routeData?.canDelete ?? true;
  const isApprovalRequired = routeData?.isApprovalRequired ?? false;

  const statusIdle = statusFetcher.state === "idle";
  const submitLoading =
    !statusIdle &&
    statusFetcher.formData?.get("field") === "status" &&
    statusFetcher.formData?.get("value") === "Active";

  let submitButtonLabel: string;
  let submitButtonTooltip: string;
  if (isApprovalRequired) {
    submitButtonLabel = "Submit for approval";
    submitButtonTooltip =
      "Sends this document for approval before it can go active.";
  } else if (isArchived) {
    submitButtonLabel = "Reactivate";
    submitButtonTooltip = "Makes this document active again.";
  } else {
    submitButtonLabel = "Publish";
    submitButtonTooltip = "Makes this document active and visible.";
  }

  const submitForActivation = () => {
    const formData = new FormData();
    formData.append("ids", id);
    formData.append("field", "status");
    formData.append("value", "Active");
    statusFetcher.submit(formData, {
      method: "post",
      action: path.to.bulkUpdateQualityDocument
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    newVersionDisclosure.onClose();
  }, [id]);

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]">
      <VStack spacing={0} className="flex-grow">
        <HStack>
          <IconButton
            aria-label="Toggle Explorer"
            icon={<LuPanelLeft />}
            onClick={toggleExplorer}
            variant="ghost"
          />
          <Heading size="h4" className="flex items-center gap-2">
            <span>{routeData?.document?.name}</span>
            <Badge variant="outline">V{routeData?.document?.version}</Badge>
            <QualityDocumentStatus status={routeData?.document?.status} />
          </Heading>
          <Copy text={routeData?.document?.name ?? ""} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label="More options"
                icon={<LuEllipsisVertical />}
                variant="secondary"
                size="sm"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                disabled={
                  !permissions.can("delete", "quality") ||
                  !permissions.is("employee") ||
                  (canActivate && hasApprovalRequest && !canDelete)
                }
                destructive
                onClick={deleteDisclosure.onOpen}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                Delete Document
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </HStack>
      </VStack>
      <div className="flex flex-shrink-0 gap-1 items-center justify-end">
        {canActivate && !hasApprovalRequest && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  leftIcon={
                    isApprovalRequired ? <LuClipboardCheck /> : <LuCheckCheck />
                  }
                  variant="primary"
                  isLoading={submitLoading}
                  isDisabled={
                    !permissions.can("update", "quality") ||
                    !permissions.is("employee") ||
                    !statusIdle
                  }
                  onClick={submitForActivation}
                >
                  {submitButtonLabel}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{submitButtonTooltip}</TooltipContent>
          </Tooltip>
        )}
        {canActivate && hasApprovalRequest && (
          <>
            <Button
              leftIcon={<LuCheckCheck />}
              variant="primary"
              isDisabled={!canApprove}
              onClick={() => setApprovalDecision("Approved")}
            >
              Approve
            </Button>
            <Button
              leftIcon={<LuX />}
              variant="destructive"
              isDisabled={!canApprove}
              onClick={() => setApprovalDecision("Rejected")}
            >
              Reject
            </Button>
          </>
        )}
        <Suspense fallback={null}>
          <Await resolve={routeData?.versions}>
            {(versions) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    leftIcon={<LuGitPullRequestArrow />}
                    rightIcon={<LuChevronDown />}
                  >
                    Versions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {permissions.can("create", "quality") && (
                    <>
                      <DropdownMenuItem onClick={newVersionDisclosure.onOpen}>
                        <DropdownMenuIcon icon={<LuCirclePlus />} />
                        New Version
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuRadioGroup
                    value={id}
                    onValueChange={(value) =>
                      navigate(path.to.qualityDocument(value))
                    }
                  >
                    {routeData?.document && (
                      <DropdownMenuRadioItem
                        key={routeData.document.id}
                        value={routeData.document.id}
                        className="flex items-center justify-between gap-2"
                      >
                        <Badge variant="outline">
                          V{routeData.document.version}
                        </Badge>
                        <span>{routeData.document.name}</span>
                        <QualityDocumentStatus
                          status={routeData.document.status}
                        />
                      </DropdownMenuRadioItem>
                    )}
                    {versions?.data
                      ?.filter((v) => v.id !== id)
                      .map((version) => (
                        <DropdownMenuRadioItem
                          key={version.id}
                          value={version.id}
                          className="flex items-center justify-between gap-2"
                        >
                          <Badge variant="outline">V{version.version}</Badge>
                          <span>{version.name}</span>
                          <QualityDocumentStatus status={version.status} />
                        </DropdownMenuRadioItem>
                      ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </Await>
        </Suspense>
        <IconButton
          aria-label="Toggle Properties"
          icon={<LuPanelRight />}
          onClick={toggleProperties}
          variant="ghost"
        />
      </div>
      {newVersionDisclosure.isOpen && (
        <QualityDocumentForm
          type="copy"
          initialValues={{
            name: routeData?.document?.name ?? "",
            version: (routeData?.document?.version ?? 0) + 1,
            content: JSON.stringify(routeData?.document?.content) ?? "",
            copyFromId: routeData?.document?.id ?? ""
          }}
          open={newVersionDisclosure.isOpen}
          onClose={newVersionDisclosure.onClose}
        />
      )}
      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteQualityDocument(id)}
          isOpen={deleteDisclosure.isOpen}
          name={routeData?.document?.name ?? "document"}
          text={`Are you sure you want to delete ${routeData?.document?.name}? This cannot be undone.`}
          onCancel={() => {
            deleteDisclosure.onClose();
          }}
          onSubmit={() => {
            deleteDisclosure.onClose();
          }}
        />
      )}
      {approvalDecision && approvalRequestId && (
        <QualityDocumentApprovalModal
          qualityDocument={routeData?.document}
          approvalRequestId={approvalRequestId}
          decision={approvalDecision}
          fetcher={approvalFetcher}
          onClose={() => setApprovalDecision(null)}
        />
      )}
    </div>
  );
};

export default QualityDocumentHeader;
