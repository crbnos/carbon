import { Switch } from "@carbon/react";
import { useFetcher } from "react-router";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";

/**
 * The on/off kill switch, shared by the list and the builder header so both post
 * to the one toggle route that re-syncs the trigger rows. Reads its checked state
 * from the in-flight submission so the switch does not snap back while saving.
 */
export function WorkflowActiveSwitch({
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
    <Switch
      checked={checked}
      disabled={!permissions.can("update", "workflows")}
      onCheckedChange={(next) => {
        const formData = new FormData();
        if (next) formData.set("active", "on");
        fetcher.submit(formData, {
          method: "post",
          action: path.to.workflowToggle(workflowId)
        });
      }}
    />
  );
}
