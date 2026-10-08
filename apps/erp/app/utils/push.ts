// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  now,
  parseAbsolute,
  type ZonedDateTime
} from "@internationalized/date";

// The VAPID public key arrives base64url-encoded; pushManager.subscribe()
// wants the raw bytes.
export function urlBase64ToUint8Array(base64Url: string) {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// The bell's "Enable browser notifications" row. "Not now" hides it for
// PROMPT_SNOOZE_DAYS in this browser; the second "Not now", or disabling
// browser notifications in settings, hides it for good. Per browser, like
// the setting it offers.
export const PROMPT_SNOOZE_DAYS = 30;
const PROMPT_MAX_DISMISSALS = 2;

export type PromptDismissal = { count: number; until: string | null };

const NO_DISMISSAL: PromptDismissal = { count: 0, until: null };

const PROMPT_STORAGE_KEY = "browserNotificationsPrompt";

export function parsePromptDismissal(raw: string | null): PromptDismissal {
  if (!raw) return NO_DISMISSAL;
  try {
    const value = JSON.parse(raw) as Partial<PromptDismissal>;
    return {
      count: typeof value.count === "number" ? value.count : 0,
      until: typeof value.until === "string" ? value.until : null
    };
  } catch {
    return NO_DISMISSAL;
  }
}

export function isPromptSnoozed(
  dismissal: PromptDismissal,
  at: ZonedDateTime = now("UTC")
) {
  if (dismissal.count >= PROMPT_MAX_DISMISSALS) return true;
  if (!dismissal.until) return false;
  try {
    return at.compare(parseAbsolute(dismissal.until, "UTC")) < 0;
  } catch {
    return false;
  }
}

export function nextPromptDismissal(
  previous: PromptDismissal,
  { permanently = false, at = now("UTC") } = {}
): PromptDismissal {
  return {
    count: permanently ? PROMPT_MAX_DISMISSALS : previous.count + 1,
    until: at.add({ days: PROMPT_SNOOZE_DAYS }).toAbsoluteString()
  };
}

export function readPromptDismissal(): PromptDismissal {
  try {
    return parsePromptDismissal(
      window.localStorage.getItem(PROMPT_STORAGE_KEY)
    );
  } catch {
    // private mode / storage disabled: ask again
    return NO_DISMISSAL;
  }
}

export function dismissBrowserNotificationsPrompt(options?: {
  permanently?: boolean;
}) {
  const next = nextPromptDismissal(readPromptDismissal(), options);
  try {
    window.localStorage.setItem(PROMPT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage disabled: the row simply comes back next time
  }
}

// Browser notifications are a setting of the browser, not of a user: once
// enabled here, whoever is signed in gets their own notifications. Signing
// out deletes the server row (so the previous user's pushes stop at once);
// the next sign-in saves the browser again for the new user. Disable turns
// it off for this browser, for everyone.
const ENABLED_STORAGE_KEY = "browserNotificationsEnabled";

export function rememberBrowserNotifications(on: boolean) {
  try {
    if (on) window.localStorage.setItem(ENABLED_STORAGE_KEY, "1");
    else window.localStorage.removeItem(ENABLED_STORAGE_KEY);
  } catch {
    // storage disabled: the next user is asked instead
  }
}

export function areBrowserNotificationsEnabled() {
  try {
    return window.localStorage.getItem(ENABLED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

// What a page load does about this browser's notifications for the user
// signed in now (useRestoreBrowserNotifications):
// - "remember": the user already owns the row — mark the browser enabled, so
//   the next user to sign in gets theirs too, and save the row again so its
//   updatedAt shows a live session.
// - "save": the browser is enabled but this user has no row (sign-out
//   deleted the previous one) — save it for them, with no prompt.
// - "skip": nobody enabled notifications here; the bell row asks.
export type RestoreStep = "remember" | "save" | "skip";

export function restoreStep({
  ownedBySignedInUser,
  browserEnabled
}: {
  ownedBySignedInUser: boolean;
  browserEnabled: boolean;
}): RestoreStep {
  if (ownedBySignedInUser) return "remember";
  return browserEnabled ? "save" : "skip";
}

// Was this subscription made with the deployment's current VAPID key? A
// subscription is bound to the key it was created with: after a key change
// every push to it fails (403), and pushManager.subscribe() refuses a new key
// while it exists. Such a subscription must be replaced, not re-saved.
export function hasApplicationServerKey(
  subscriptionKey: ArrayBuffer | null | undefined,
  publicKey: string
) {
  if (!subscriptionKey) return false;
  const current = urlBase64ToUint8Array(publicKey);
  const stored = new Uint8Array(subscriptionKey);
  if (stored.length !== current.length) return false;
  return stored.every((byte, index) => byte === current[index]);
}
