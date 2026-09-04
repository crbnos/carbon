import { useRouteData } from "@carbon/react";
import { useFetcher } from "react-router";
import type { ChangelogPanelEntry } from "~/modules/account";
import { changelogFlagKey } from "~/modules/users";
import { path } from "~/utils/path";
import { useUser } from "./useUser";

/**
 * The bottom-right "What's new" panel — same mechanics as useTrainingPanel.
 * The entry comes from the app-shell loader (`changelog`); a dismissal is the
 * user flag `changelog:<slug>` = true, written through /x/acknowledge's
 * generic `flag` intent, so it holds per account on every device. The panel
 * hides optimistically while that write is in flight, and a newer entry has
 * a different slug, so it shows again.
 */
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
