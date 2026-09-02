import { useLingui } from "@lingui/react/macro";
import { Confirm } from "~/components/Modals";
import { path } from "~/utils/path";

type ConfirmUnpublishWorkflowProps = {
  workflowId: string;
  name: string;
  onClose: () => void;
};

/**
 * The one copy of the unpublish confirmation, shared by the list row menu and the builder
 * header. Both post to the same bodyless route, so the only thing to keep in one place is
 * what the dialog says.
 */
export function ConfirmUnpublishWorkflow({
  workflowId,
  name,
  onClose
}: ConfirmUnpublishWorkflowProps) {
  const { t } = useLingui();

  return (
    <Confirm
      action={path.to.workflowUnpublish(workflowId)}
      isOpen
      title={t`Unpublish ${name}?`}
      text={t`It will stop running until you publish a version again. Nothing is deleted.`}
      confirmText={t`Unpublish`}
      onCancel={onClose}
      onSubmit={onClose}
    />
  );
}
