import { Checkbox } from "@carbon/react";
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
  const fetcher = useFetcher<{ success?: boolean }>();
  const permissions = usePermissions();

  const checked = fetcher.formData
    ? fetcher.formData.get("active") === "on"
    : active;

  return (
    <Checkbox
      isChecked={checked}
      disabled={!permissions.can("update", "workflows")}
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
