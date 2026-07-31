import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure
} from "@carbon/react";
import type { WorkflowIssue } from "@carbon/workflows";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import { LuLock, LuUser } from "react-icons/lu";
import { useFetcher } from "react-router";
import { EmployeeAvatar } from "~/components";
import { usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import type {
  WorkflowDetail,
  WorkflowVersionSummary
} from "../../workflows.service";
import { WorkflowActiveSwitch } from "../WorkflowActiveSwitch";
import { useBuilderStore, useBuilderStoreApi } from "./context";
import { VersionMenu } from "./VersionMenu";

type BuilderHeaderProps = {
  workflow: WorkflowDetail;
  versions: WorkflowVersionSummary[];
  versionId: string;
  onIssues: () => void;
};

function SaveMarker() {
  const saveState = useBuilderStore((state) => state.saveState);
  if (saveState === "idle") return null;

  return (
    <span className="text-[11px] text-muted-foreground">
      {saveState === "saving" ? (
        <Trans>Saving…</Trans>
      ) : saveState === "saved" ? (
        <Trans>Saved</Trans>
      ) : (
        <Trans>Could not save</Trans>
      )}
    </span>
  );
}

export function BuilderHeader({
  workflow,
  versions,
  versionId,
  onIssues
}: BuilderHeaderProps) {
  const { t } = useLingui();
  const { id: userId } = useUser();
  const permissions = usePermissions();
  const store = useBuilderStoreApi();
  const isReadOnly = useBuilderStore((state) => state.isReadOnly);

  const ownerFetcher = useFetcher<{ success?: boolean }>();
  const publishFetcher = useFetcher<{
    ok?: boolean;
    issues?: WorkflowIssue[];
  }>();
  const confirmPublish = useDisclosure();

  const current = versions.find((version) => version.id === versionId);
  const live = versions.find(
    (version) => version.id === workflow.activeVersionId
  );
  const isLiveVersion = versionId === workflow.activeVersionId;

  // Publish issues drive the node outlines and the panel.
  useEffect(() => {
    if (publishFetcher.state !== "idle" || !publishFetcher.data) return;
    const issues = publishFetcher.data.issues ?? [];
    store.getState().setIssues(issues);
    if (issues.length) onIssues();
  }, [publishFetcher.data, publishFetcher.state, store, onIssues]);

  const publish = () => {
    const formData = new FormData();
    formData.set("versionId", versionId);
    publishFetcher.submit(formData, {
      method: "post",
      action: path.to.workflowPublish(workflow.id)
    });
  };

  return (
    <header className="flex h-[49px] shrink-0 items-center gap-3 border-b px-4">
      <h1 className="truncate text-sm font-semibold">{workflow.name}</h1>

      {current && (
        <Badge variant="outline">
          v{current.versionNumber}
          {!isLiveVersion && ` · ${t`editing`}`}
        </Badge>
      )}

      {isReadOnly && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-muted-foreground">
              <LuLock className="size-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {isLiveVersion ? (
              <Trans>This version is live. Create a new version to edit.</Trans>
            ) : (
              <Trans>You do not have permission to edit workflows</Trans>
            )}
          </TooltipContent>
        </Tooltip>
      )}

      {live && !isLiveVersion && (
        <Badge variant="green">
          v{live.versionNumber} {t`live`}
        </Badge>
      )}

      <SaveMarker />

      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" leftIcon={<LuUser />}>
              <EmployeeAvatar employeeId={workflow.ownerId} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={
                workflow.ownerId === userId ||
                !permissions.can("update", "workflows")
              }
              onClick={() =>
                ownerFetcher.submit(new FormData(), {
                  method: "post",
                  action: path.to.workflowOwner(workflow.id)
                })
              }
            >
              <DropdownMenuIcon icon={<LuUser />} />
              <Trans>Take ownership</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <WorkflowActiveSwitch
          workflowId={workflow.id}
          active={workflow.active}
        />

        <VersionMenu
          workflowId={workflow.id}
          versionId={versionId}
          activeVersionId={workflow.activeVersionId}
          versions={versions}
        />

        <Button
          isDisabled={
            !permissions.can("update", "workflows") ||
            isLiveVersion ||
            publishFetcher.state !== "idle"
          }
          isLoading={publishFetcher.state !== "idle"}
          onClick={() => {
            // Replacing a live version is worth asking about; a first publish is not.
            if (live) confirmPublish.onOpen();
            else publish();
          }}
        >
          {current ? t`Publish v${current.versionNumber}` : t`Publish`}
        </Button>
      </div>

      {confirmPublish.isOpen && current && live && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) confirmPublish.onClose();
          }}
        >
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>
              <ModalTitle>{t`Publish v${current.versionNumber}?`}</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <p className="text-sm text-muted-foreground">
                {t`Version ${live.versionNumber} is live now and will be replaced.`}
              </p>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={confirmPublish.onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                onClick={() => {
                  confirmPublish.onClose();
                  publish();
                }}
              >
                <Trans>Publish</Trans>
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </header>
  );
}
