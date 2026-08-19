import { Alert, AlertDescription, AlertTitle, Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";

type WorkflowLockAlertProps = {
  workflowId: string;
  /** Branched from, when the reader makes a new version. */
  versionId: string;
  /** The reader may create a version. Telling someone without that permission to
   * "create a new version" would be wrong, so the two cases get different copy. */
  canCreateVersion: boolean;
  className?: string;
};

/**
 * Shown above the canvas whenever the open version is the live one. The 14px lock glyph
 * in the header is not enough: without this, an edit on a published version is refused
 * silently and the author only finds out when it vanishes on reload.
 */
const WorkflowLockAlert = ({
  workflowId,
  versionId,
  canCreateVersion,
  className
}: WorkflowLockAlertProps) => {
  const fetcher = useFetcher();

  // The new-version route is POST-only and copies the version you are looking at,
  // so this submits rather than linking.
  const newVersion = () => {
    const formData = new FormData();
    formData.set("copyFromVersionId", versionId);
    fetcher.submit(formData, {
      method: "post",
      action: path.to.workflowVersionNew(workflowId)
    });
  };

  return (
    <Alert variant="warning" className={className}>
      <LuTriangleAlert />
      <AlertTitle>
        <Trans>This version is live</Trans>
      </AlertTitle>
      <AlertDescription>
        {canCreateVersion ? (
          <Trans>
            This version is live. Create a new version to make changes. You can
            still move steps around to tidy the layout.
          </Trans>
        ) : (
          <Trans>
            This version is live, so it cannot be changed. You can still move
            steps around to tidy the layout.
          </Trans>
        )}
      </AlertDescription>
      {canCreateVersion && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-2 w-fit"
          isDisabled={fetcher.state !== "idle"}
          onClick={newVersion}
        >
          <Trans>New version</Trans>
        </Button>
      )}
    </Alert>
  );
};

export default WorkflowLockAlert;
