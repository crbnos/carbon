import { Checkbox } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useFetcher } from "react-router";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";

/**
 * Checkbox variant of {@link WorkflowActiveSwitch} used in the workflows table.
 * Posts to the same toggle route that re-syncs the trigger rows, and reads its
 * checked state from the in-flight submission so it does not snap back while saving.
 */
export function WorkflowActiveCheckbox({
  workflowId,
  active
}: {
  workflowId: string;
  active: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success?: boolean }>();
  const permissions = usePermissions();

  const checked = fetcher.formData
    ? fetcher.formData.get("active") === "on"
    : active;

  // The toggle route performs an unconditional update, so block further clicks
  // until the in-flight submission settles — rapid clicks could otherwise reach
  // the server out of order and leave the workflow with the wrong active value.
  const isUpdating = fetcher.state !== "idle";

  return (
    <Checkbox
      aria-label={t`Active`}
      isChecked={checked}
      disabled={!permissions.can("update", "workflows") || isUpdating}
      onCheckedChange={(next) => {
        const formData = new FormData();
        if (next === true) formData.set("active", "on");
        fetcher.submit(formData, {
          method: "post",
          action: path.to.workflowToggle(workflowId)
        });
      }}
    />
  );
}
