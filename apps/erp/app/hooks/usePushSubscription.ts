// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";
import { path } from "~/utils/path";
import { urlBase64ToUint8Array } from "~/utils/push";

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

// Stops this browser receiving pushes: drops the server row, then the
// browser's own subscription. Never throws — Sign Out must not wait on it.
export async function unsubscribeThisDevice() {
  try {
    if (!supportsPush()) return;
    const subscription = await currentSubscription();
    if (!subscription) return;
    await sendSubscription("DELETE", { endpoint: subscription.endpoint });
    await subscription.unsubscribe();
  } catch (error) {
    logger.error("Failed to unsubscribe this device from push", { error });
  }
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
        // Re-save the row for the current company: the browser keeps one
        // subscription, the server keeps one row per company.
        const response = await sendSubscription(
          "PUT",
          subscription.toJSON() as Record<string, unknown>
        );
        if (!cancelled) setState(response.ok ? "on" : "off");
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

        await navigator.serviceWorker.register(WORKER_URL, { scope: "/" });
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
        const response = await sendSubscription(
          "PUT",
          subscription.toJSON() as Record<string, unknown>
        );
        if (!response.ok) {
          await subscription.unsubscribe();
          setState("off");
          toast.error(t`Failed to turn on push notifications`);
          return;
        }
        setState("on");
      }, t`Failed to turn on push notifications`),
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
        setState("off");
      }, t`Failed to turn off push notifications`),
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
