import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuIcon,
  MenuItem,
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
import {
  LuChevronDown,
  LuEllipsisVertical,
  LuHistory,
  LuLock,
  LuTrash
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { VersionMenu } from "~/components";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type {
  WorkflowDetail,
  WorkflowVersionSummary
} from "../../workflows.service";
import { useBuilderStore, useBuilderStoreApi } from "./context";
import { WorkflowVersionStatus } from "./WorkflowVersionStatus";

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
  const permissions = usePermissions();
  const store = useBuilderStoreApi();
  const isReadOnly = useBuilderStore((state) => state.isReadOnly);

  const publishFetcher = useFetcher<{
    ok?: boolean;
    issues?: WorkflowIssue[];
  }>();
  const versionFetcher = useFetcher();
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

      <SaveMarker />

      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" leftIcon={<LuHistory />} asChild>
          <a
            href={`${path.to.workflowRuns}?filter=workflowId:eq:${workflow.id}`}
          >
            {t`Runs`}
          </a>
        </Button>
        <VersionMenu
          versions={versions}
          currentVersionId={versionId}
          getKey={(v) => v.id}
          getHref={(v) => `${path.to.workflow(workflow.id)}?version=${v.id}`}
          label={
            current && (
              <div className="flex items-center gap-2">
                <Badge variant="outline">Version {current.versionNumber}</Badge>
                <WorkflowVersionStatus isLive={isLiveVersion} />
              </div>
            )
          }
          renderLabel={(v) => <span>Version {v.versionNumber}</span>}
          renderStatus={(v) => (
            <WorkflowVersionStatus isLive={v.id === workflow.activeVersionId} />
          )}
          onNewVersion={
            permissions.can("create", "workflows")
              ? () => {
                  const formData = new FormData();
                  formData.set("copyFromVersionId", versionId);
                  versionFetcher.submit(formData, {
                    method: "post",
                    action: path.to.workflowVersionNew(workflow.id)
                  });
                }
              : undefined
          }
        />
        {permissions.can("delete", "workflows") &&
          versionId !== workflow.activeVersionId &&
          versions.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" rightIcon={<LuChevronDown />}>
                  <LuEllipsisVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <MenuItem
                  destructive
                  onClick={() => {
                    versionFetcher.submit(new FormData(), {
                      method: "post",
                      action: path.to.workflowVersionDelete(
                        workflow.id,
                        versionId
                      )
                    });
                  }}
                >
                  <MenuIcon icon={<LuTrash />} />
                  <Trans>Delete this version</Trans>
                </MenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

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
          {current ? t`Publish Version ${current.versionNumber}` : t`Publish`}
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
              <ModalTitle>{t`Publish Version ${current.versionNumber}?`}</ModalTitle>
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
