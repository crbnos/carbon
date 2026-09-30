import { useRouteData } from "@carbon/react";
import { useFetcher } from "react-router";
import type { ChangelogPanelEntry } from "~/modules/account";
import { changelogFlagKey } from "~/modules/users";
import { path } from "~/utils/path";
import { useUser } from "./useUser";

// Dismissing sets the user flag `changelog:<slug>`, so it holds on every device;
// a newer entry has a new slug and shows again.
export function useChangelogPanel(): {
  entry: ChangelogPanelEntry | null;
  isOpen: boolean;
  dismiss: () => void;
} {
  const { flags } = useUser();
  const data = useRouteData<{ changelog?: ChangelogPanelEntry | null }>(
    path.to.authenticatedRoot
  );
  const entry = data?.changelog ?? null;
  const flagKey = entry ? changelogFlagKey(entry.slug) : null;
  const fetcher = useFetcher({ key: "changelog-dismiss" });

  const isPendingDismiss =
    flagKey !== null && fetcher.formData?.get("flag") === flagKey;
  const isDismissed =
    isPendingDismiss || (flagKey !== null && flags[flagKey] === true);

  const dismiss = () => {
    if (!flagKey) return;
    fetcher.submit(
      { intent: "flag", flag: flagKey, value: "true" },
      { method: "POST", action: path.to.acknowledge }
    );
  };

  return { entry, isOpen: entry !== null && !isDismissed, dismiss };
}
