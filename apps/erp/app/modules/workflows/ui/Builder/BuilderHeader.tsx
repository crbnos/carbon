import {
  Button,
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
import { useEffect, useRef, useState } from "react";
import { LuLock, LuPencil } from "react-icons/lu";
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

// Renaming is a property of the workflow, not of the version being viewed, so a
// live (read-only) version is still renameable — only the permission gates it.
function WorkflowTitle({ workflow }: { workflow: WorkflowDetail }) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{ success: boolean }>();
  const [isEditing, setIsEditing] = useState(false);
  // Prevents onBlur from re-submitting after Enter or Escape already resolved
  const settled = useRef(false);

  // Show the in-flight name so the title never flickers back before revalidation.
  const pending = fetcher.formData?.get("name");
  const name = typeof pending === "string" && pending ? pending : workflow.name;

  function commit(raw: string) {
    if (settled.current) return;
    settled.current = true;
    setIsEditing(false);

    const next = raw.trim();
    if (!next || next === workflow.name) return;

    const formData = new FormData();
    formData.set("id", workflow.id);
    formData.set("name", next);
    formData.set("description", workflow.description ?? "");
    formData.set("type", "inline");
    fetcher.submit(formData, {
      method: "post",
      action: path.to.workflowRename(workflow.id)
    });
  }

  if (!permissions.can("update", "workflows")) {
    return <h1 className="truncate text-sm font-semibold">{name}</h1>;
  }

  if (isEditing) {
    return (
      <input
        autoFocus
        aria-label={t`Workflow name`}
        className="w-64 max-w-full bg-transparent text-sm font-semibold focus:outline-none"
        defaultValue={name}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            settled.current = true;
            setIsEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className="group/title flex min-w-0 items-center gap-1.5 text-left"
      title={t`Click to rename`}
      onClick={() => {
        settled.current = false;
        setIsEditing(true);
      }}
    >
      <h1 className="truncate text-sm font-semibold">{name}</h1>
      <LuPencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100" />
    </button>
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
  // The lock glyph means "this is the live version"; the tooltip below distinguishes
  // that from simply lacking permission.
  const isVersionLocked = useBuilderStore((state) => state.isVersionLocked);
  const canEdit = useBuilderStore((state) => state.canEdit);
  const isReadOnly = isVersionLocked || !canEdit;

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
      <WorkflowTitle workflow={workflow} />

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

      <div className="ml-auto flex items-center gap-2">
        <SaveMarker />
        <VersionMenu
          versions={versions}
          currentVersionId={versionId}
          getKey={(v) => v.id}
          getHref={(v) => `${path.to.workflow(workflow.id)}?version=${v.id}`}
          label={current && <span>Version {current.versionNumber}</span>}
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
          <Trans>Publish</Trans>
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
