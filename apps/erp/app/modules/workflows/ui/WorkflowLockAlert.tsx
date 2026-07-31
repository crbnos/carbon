import { Alert, AlertDescription, AlertTitle, Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";

type WorkflowLockAlertProps = {
  workflowId: string;
  versionId: string;
  className?: string;
};

// The promoted version is read-only; making a change means making a new version.
// Mirrors ReleaseLockAlert for released item revisions.
const WorkflowLockAlert = ({
  workflowId,
  versionId,
  className
}: WorkflowLockAlertProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher();

  return (
    <Alert variant="warning" className={className}>
      <LuTriangleAlert />
      <AlertTitle>
        <Trans>This version is live</Trans>
      </AlertTitle>
      <AlertDescription className="flex items-center justify-between gap-4">
        <Trans>Create a new version to make changes.</Trans>
        {permissions.can("create", "workflows") && (
          <Button
            variant="secondary"
            isLoading={fetcher.state !== "idle"}
            onClick={() => {
              const formData = new FormData();
              formData.set("copyFromVersionId", versionId);
              fetcher.submit(formData, {
                method: "post",
                action: path.to.workflowVersionNew(workflowId)
              });
            }}
          >
            <Trans>New version</Trans>
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
};

export default WorkflowLockAlert;
