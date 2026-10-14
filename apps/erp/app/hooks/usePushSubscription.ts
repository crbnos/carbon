// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";
import { path } from "~/utils/path";
import {
  areBrowserNotificationsEnabled,
  hasApplicationServerKey,
  rememberBrowserNotifications,
  restoreStep,
  supportsPush,
  urlBase64ToUint8Array
} from "~/utils/push";

const logger = getLogger("erp", "usepushsubscription");

const WORKER_URL = "/push-worker.js";

export type PushState = "loading" | "unsupported" | "denied" | "off" | "on";

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

// Is the subscription on for the user signed in now? Read-only. The settings
// card and the bell's restore ask at the same moment on the settings page;
// concurrent asks for one endpoint share a request. Nothing is cached once it
// settles, so the next ask sees an Enable or a Disable.
const statusRequests = new Map<string, Promise<boolean>>();

function isEnabledOnServer(endpoint: string) {
  const inFlight = statusRequests.get(endpoint);
  if (inFlight) return inFlight;
  const request = (async () => {
    const params = new URLSearchParams({ endpoint });
    const response = await fetch(
      `${path.to.api.pushSubscription}?${params.toString()}`,
      { credentials: "same-origin" }
    );
    if (!response.ok) return false;
    const status = (await response.json()) as { enabled?: boolean };
    return status.enabled === true;
  })().finally(() => statusRequests.delete(endpoint));
  statusRequests.set(endpoint, request);
  return request;
}

// Registers the worker and subscribes. Needs permission already granted.
// Returns the browser's existing subscription when it was made with the
// current VAPID key; one made with an older key is unsubscribed and replaced
// (subscribe() refuses a new key while it exists), and its endpoint comes
// back as replacedEndpoint so the server drops that row.
async function subscribe(publicKey: string) {
  await navigator.serviceWorker.register(WORKER_URL, { scope: "/" });
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  let replacedEndpoint: string | null = null;
  if (
    existing &&
    !hasApplicationServerKey(existing.options.applicationServerKey, publicKey)
  ) {
    replacedEndpoint = existing.endpoint;
    await existing.unsubscribe();
  }
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey)
  });
  return { subscription, replacedEndpoint };
}

function saveSubscription(
  subscription: PushSubscription,
  replacedEndpoint: string | null
) {
  return sendSubscription("PUT", {
    ...(subscription.toJSON() as Record<string, unknown>),
    ...(replacedEndpoint ? { oldEndpoint: replacedEndpoint } : {})
  });
}

function sendSubscription(
  method: "PUT" | "DELETE",
  body: Record<string, unknown>
) {
  return fetch(path.to.api.pushSubscription, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

// The users this tab has already restored for. Module scope, not a ref: the
// restore runs once per tab and user even if the bell remounts.
const restoredFor = new Set<string>();

// Browser notifications are a setting of this browser: once enabled, the
// subscription is saved for whoever signs in. Sign-out deletes the row, so
// this re-saves it for the user signed in now — without asking.
export function useRestoreBrowserNotifications({
  publicKey,
  userId
}: {
  publicKey: string | null;
  userId: string;
}) {
  useEffect(() => {
    if (!publicKey || !supportsPush()) return;
    if (Notification.permission !== "granted") {
      // Revoked or reset in the browser's settings: the browser is no longer
      // enabled, so the bell may ask again.
      rememberBrowserNotifications(false);
      return;
    }
    if (restoredFor.has(userId)) return;
    restoredFor.add(userId);

    (async () => {
      try {
        const existing = await currentSubscription();
        const step = restoreStep({
          ownedBySignedInUser: existing
            ? await isEnabledOnServer(existing.endpoint)
            : false,
          browserEnabled: areBrowserNotificationsEnabled()
        });
        if (step === "skip") return;
        if (step === "remember") rememberBrowserNotifications(true);
        // Save on every tab load, also when the row exists: the save refreshes
        // the row's updatedAt, and notify skips rows no session has refreshed
        // within a session's lifetime (a signed-out-by-expiry browser).
        const { subscription, replacedEndpoint } = await subscribe(publicKey);
        const response = await saveSubscription(subscription, replacedEndpoint);
        if (!response.ok) {
          // Not restored: a later mount in this tab may try again.
          restoredFor.delete(userId);
          logger.error("Failed to restore browser notifications", {
            status: response.status
          });
        }
      } catch (error) {
        restoredFor.delete(userId);
        logger.error("Failed to restore browser notifications", { error });
      }
    })();
  }, [publicKey, userId]);
}

export function usePushSubscription({
  publicKey
}: {
  publicKey: string | null;
}) {
  const { t } = useLingui();
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!publicKey || !supportsPush()) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const subscription = await currentSubscription();
        if (!subscription) {
          if (!cancelled) setState("off");
          return;
        }
        // A subscription made with an older VAPID key cannot receive pushes;
        // Enable replaces it.
        if (
          !hasApplicationServerKey(
            subscription.options.applicationServerKey,
            publicKey
          )
        ) {
          if (!cancelled) setState("off");
          return;
        }
        // The browser keeps its subscription across sign-outs, but signing
        // out deletes the row: ask the server whether it is on for the user
        // signed in now. Read-only — only Enable claims the browser.
        const enabled = await isEnabledOnServer(subscription.endpoint);
        if (!cancelled) setState(enabled ? "on" : "off");
      } catch (error) {
        logger.error("Failed to read the push subscription", { error });
        if (!cancelled) setState("off");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  // Resolves false when the work threw (the failure is already toasted).
  const run = useCallback(
    async (work: () => Promise<void>, failure: string) => {
      setBusy(true);
      try {
        await work();
        return true;
      } catch (error) {
        logger.error(failure, { error });
        toast.error(failure);
        return false;
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const turnOn = useCallback(
    () =>
      run(async () => {
        if (!publicKey) return;
        const permission = await Notification.requestPermission();
        if (permission === "denied") {
          setState("denied");
          return;
        }
        if (permission !== "granted") return;

        const { subscription, replacedEndpoint } = await subscribe(publicKey);
        const response = await saveSubscription(subscription, replacedEndpoint);
        if (!response.ok) {
          await subscription.unsubscribe();
          setState("off");
          toast.error(t`Failed to enable browser notifications`);
          return;
        }
        rememberBrowserNotifications(true);
        setState("on");
      }, t`Failed to enable browser notifications`),
    [publicKey, run, t]
  );

  const turnOff = useCallback(
    () =>
      run(async () => {
        const subscription = await currentSubscription();
        if (subscription) {
          const response = await sendSubscription("DELETE", {
            endpoint: subscription.endpoint
          });
          // Keep the browser on when its row could not be deleted.
          if (!response.ok) {
            throw new Error(`DELETE returned ${response.status}`);
          }
          await subscription.unsubscribe();
        }
        rememberBrowserNotifications(false);
        setState("off");
      }, t`Failed to disable browser notifications`),
    [run, t]
  );

  return { state, busy, turnOn, turnOff };
}
