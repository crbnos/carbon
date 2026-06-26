import { useCallback, useState } from "react";

// Per-user, per-browser dismissal of the home-screen hub card. The full hub stays
// reachable from the nav — this only hides the home hijack (mirrors how the
// training panel tracks dismissals). Not shared state, so it lives in localStorage.
const storageKey = (companyId: string) =>
  `implementationHubDismissed:${companyId}`;

export function useHubDismissed(companyId: string): [boolean, () => void] {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(storageKey(companyId)) === "1";
    } catch {
      return false;
    }
  });

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(storageKey(companyId), "1");
    } catch {
      // ignore (private mode / storage disabled)
    }
    setDismissed(true);
  }, [companyId]);

  return [dismissed, dismiss];
}
