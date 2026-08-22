import {
  cn,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Spinner
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuChevronRight, LuEye, LuGitBranch } from "react-icons/lu";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";

type WorkflowLockModalProps = {
  workflowId: string;
  /** Branched from, when the reader makes a new version. */
  versionId: string;
};

/**
 * Shown when the open version is the live one. Replaces the old inline warning banner:
 * opening a published version is a fork in the road, so we ask once which way to go —
 * keep reading the read-only canvas, or branch a version you can edit. Dismissing (the X,
 * the overlay, or "View the workflow") lands on the read-only canvas; the header lock glyph
 * stays as the persistent reminder, and the version menu still offers "New version" later.
 *
 * Only rendered when the reader can create a version — without that permission there is no
 * choice to make, and the header lock tooltip already says the version is read-only.
 */
const WorkflowLockModal = ({
  workflowId,
  versionId
}: WorkflowLockModalProps) => {
  const { t } = useLingui();
  const fetcher = useFetcher();
  const [open, setOpen] = useState(true);

  // The new-version route is POST-only and copies the version you are looking at, so this
  // submits rather than links; a success redirects to the fresh version and unmounts this.
  const isCreating = fetcher.state !== "idle";
  const newVersion = () => {
    const formData = new FormData();
    formData.set("copyFromVersionId", versionId);
    fetcher.submit(formData, {
      method: "post",
      action: path.to.workflowVersionNew(workflowId)
    });
  };

  const tile =
    "group flex w-full items-center gap-3 rounded-lg border border-border bg-accent/40 p-3 text-left transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalOverlay />
      <ModalContent size="small">
        <ModalHeader>
          <ModalTitle>
            <Trans>This version is live</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Published versions can't be edited. Look around read-only, or
              branch a new version to make changes.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={isCreating}
              className={cn(tile, "hover:border-foreground/20")}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <LuEye className="size-4" />
              </span>
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">{t`View the workflow`}</span>
                <span className="text-xs leading-snug text-muted-foreground">
                  {t`Browse the live version read-only. You can still rearrange steps to tidy the layout.`}
                </span>
              </span>
              <LuChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>

            <button
              type="button"
              onClick={newVersion}
              disabled={isCreating}
              className={cn(tile, "hover:border-primary/40")}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <LuGitBranch className="size-4" />
              </span>
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">{t`Create a new version`}</span>
                <span className="text-xs leading-snug text-muted-foreground">
                  {t`Branch an editable copy of this version that you can change and publish.`}
                </span>
              </span>
              {isCreating ? (
                <Spinner className="shrink-0 text-muted-foreground" />
              ) : (
                <LuChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              )}
            </button>
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};

export default WorkflowLockModal;
