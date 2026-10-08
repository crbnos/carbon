// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { path } from "~/utils/path";
import {
  areBrowserNotificationsEnabled,
  rememberBrowserNotifications,
  urlBase64ToUint8Array
} from "~/utils/push";

const logger = getLogger("erp", "usepushsubscription");

const WORKER_URL = "/push-worker.js";

export type PushState = "loading" | "unsupported" | "denied" | "off" | "on";

function supportsPush() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

// Is the subscription on for the user signed in now? Read-only.
async function isEnabledOnServer(endpoint: string) {
  const params = new URLSearchParams({ endpoint });
  const response = await fetch(
    `${path.to.api.pushSubscription}?${params.toString()}`,
    { credentials: "same-origin" }
  );
  if (!response.ok) return false;
  const status = (await response.json()) as { enabled?: boolean };
  return status.enabled === true;
}

// Registers the worker and subscribes. Needs permission already granted;
// returns the browser's existing subscription when there is one.
async function subscribe(publicKey: string) {
  await navigator.serviceWorker.register(WORKER_URL, { scope: "/" });
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey)
  });
}

function sendSubscription(
  method: "PUT" | "DELETE" | "POST",
  body: Record<string, unknown>
) {
  return fetch(path.to.api.pushSubscription, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

// Browser notifications are a setting of this browser: once enabled, the
// subscription is saved for whoever signs in. Sign-out deletes the row, so
// this re-saves it for the user signed in now — without asking. Runs once per
// tab and user.
export function useRestoreBrowserNotifications({
  publicKey,
  userId
}: {
  publicKey: string | null;
  userId: string;
}) {
  const ran = useRef<string | null>(null);

  useEffect(() => {
    if (!publicKey || !supportsPush()) return;
    if (Notification.permission !== "granted") return;
    if (ran.current === userId) return;
    ran.current = userId;

    (async () => {
      try {
        const existing = await currentSubscription();
        if (existing && (await isEnabledOnServer(existing.endpoint))) {
          // On already — remember it, so the next sign-in keeps it on.
          rememberBrowserNotifications(true);
          return;
        }
        if (!areBrowserNotificationsEnabled()) return;
        const subscription = existing ?? (await subscribe(publicKey));
        const response = await sendSubscription(
          "PUT",
          subscription.toJSON() as Record<string, unknown>
        );
        if (!response.ok) {
          logger.error("Failed to restore browser notifications", {
            status: response.status
          });
        }
      } catch (error) {
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

  const run = useCallback(
    async (work: () => Promise<void>, failure: string) => {
      setBusy(true);
      try {
        await work();
      } catch (error) {
        logger.error(failure, { error });
        toast.error(failure);
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

        const subscription = await subscribe(publicKey);
        const response = await sendSubscription(
          "PUT",
          subscription.toJSON() as Record<string, unknown>
        );
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
          await sendSubscription("DELETE", {
            endpoint: subscription.endpoint
          });
          await subscription.unsubscribe();
        }
        rememberBrowserNotifications(false);
        setState("off");
      }, t`Failed to disable browser notifications`),
    [run, t]
  );

  const sendTest = useCallback(
    () =>
      run(async () => {
        const subscription = await currentSubscription();
        if (!subscription) {
          setState("off");
          return;
        }
        const response = await sendSubscription("POST", {
          endpoint: subscription.endpoint,
          intent: "test"
        });
        if (!response.ok) {
          toast.error(t`Failed to send a test notification`);
          return;
        }
        toast.success(t`Test notification sent`);
      }, t`Failed to send a test notification`),
    [run, t]
  );

  return { state, busy, turnOn, turnOff, sendTest };
}
