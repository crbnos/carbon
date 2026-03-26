import { useEffect, useRef } from "react";
import { useFetcher, useLocation } from "react-router";
import { path } from "~/utils/path";
import { getTrainingForPath, getTrainingKey } from "~/utils/training";
import { useUser } from "./useUser";

const FLAG_PREFIX = "training:";
const MAX_IMPRESSIONS = 3;

function safeLocalGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function useTrainingPanel() {
  const { pathname, key: locationKey } = useLocation();
  const { flags } = useUser();
  const fetcher = useFetcher({ key: "training-dismiss" });
  const lastCountedKey = useRef<string | null>(null);

  const training = getTrainingForPath(pathname);
  const trainingKey = getTrainingKey(pathname);
  const flagKey = trainingKey ? `${FLAG_PREFIX}${trainingKey}` : null;

  const pendingDismissFlag = fetcher.formData?.get("flag") as string | null;
  const isPendingDismiss = pendingDismissFlag === flagKey;
  const isDbDismissed = flagKey ? flags[flagKey] === true : false;
  const isLocalDismissed = flagKey
    ? safeLocalGet(`training_dismissed_${flagKey}`) === "true"
    : false;

  const impressionCount = flagKey
    ? parseInt(safeLocalGet(`training_impressions_${flagKey}`) ?? "0", 10)
    : 0;
  const tooManyImpressions = impressionCount >= MAX_IMPRESSIONS;

  const isDismissed = isPendingDismiss || isDbDismissed || isLocalDismissed;
  const isOpen = !!training && !!flagKey && !isDismissed && !tooManyImpressions;

  // Count impressions per navigation (locationKey deduplicates StrictMode remounts)
  useEffect(() => {
    if (isOpen && flagKey && lastCountedKey.current !== locationKey) {
      lastCountedKey.current = locationKey;
      const key = `training_impressions_${flagKey}`;
      const count = parseInt(safeLocalGet(key) ?? "0", 10);
      safeLocalSet(key, String(count + 1));
    }
  }, [isOpen, flagKey, locationKey]);

  // Once the impression cap is hit, sync the dismiss to DB on the next visit
  useEffect(() => {
    if (tooManyImpressions && flagKey && !isDismissed) {
      safeLocalSet(`training_dismissed_${flagKey}`, "true");
      fetcher.submit(
        { intent: "flag", flag: flagKey, value: "true" },
        { method: "POST", action: path.to.acknowledge }
      );
    }
  }, [tooManyImpressions, flagKey, isDismissed, fetcher]);

  const dismiss = () => {
    if (!flagKey) return;
    safeLocalSet(`training_dismissed_${flagKey}`, "true");
    fetcher.submit(
      { intent: "flag", flag: flagKey, value: "true" },
      { method: "POST", action: path.to.acknowledge }
    );
  };

  return {
    isOpen,
    training,
    hasTraining: training !== null,
    dismiss
  };
}
