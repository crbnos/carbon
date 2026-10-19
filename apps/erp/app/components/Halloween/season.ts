// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLocalTimeZone, today } from "@internationalized/date";
import { useSyncExternalStore } from "react";

// When the decorations show, and the user's choice to hide them, shared by
// everything seasonal: the spider layer and the pumpkin in the breadcrumbs.
// It shows only from October 20 to November 1 in the user's own time zone,
// so it switches itself off on time.

export function isHalloweenSeason() {
  const date = today(getLocalTimeZone());
  return (
    (date.month === 10 && date.day >= 20) ||
    (date.month === 11 && date.day === 1)
  );
}

// Hiding lasts for this Halloween only, so next year's decorations show again.
function hiddenKey(userId: string) {
  return `halloween-hidden:${today(getLocalTimeZone()).year}:${userId}`;
}

const CHANGED = "halloween-hidden-changed";
// Hidden for this visit when storage refuses the write (private mode).
const hiddenThisVisit = new Set<string>();

function readHidden(userId: string) {
  if (hiddenThisVisit.has(userId)) return true;
  try {
    return window.localStorage.getItem(hiddenKey(userId)) === "true";
  } catch {
    return false;
  }
}

export function hideDecorations(userId: string) {
  hiddenThisVisit.add(userId);
  try {
    window.localStorage.setItem(hiddenKey(userId), "true");
  } catch {
    // Storage refused: hidden for this visit only.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  // Hidden in another tab.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Whether the decorations show for this user now. False on the server: the
 * season and the stored choice are the browser's, decided after hydration.
 */
export function useHalloweenDecorations(userId: string) {
  return useSyncExternalStore(
    subscribe,
    () => isHalloweenSeason() && !readHidden(userId),
    () => false
  );
}
