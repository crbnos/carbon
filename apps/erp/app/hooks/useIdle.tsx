import { useCallback, useEffect, useRef, useState } from "react";

// UX-only idle detection for the NIST 3.1.10 session lock. The SERVER is the
// authority (requireAuthSession enforces the idle/absolute cap); this hook drives
// the immediate lock overlay + a throttled activity heartbeat. Background traffic
// (the 60s refresh poll, realtime revalidations) is NOT activity — only real
// user input moves lastActivity, so an unattended tab still locks.

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel"
] as const;

const CHANNEL_NAME = "carbon-session-activity";
const ACTIVITY_BROADCAST_THROTTLE_MS = 5000;
const CHECK_INTERVAL_MS = 1000;

type ChannelMessage = { type: "activity" } | { type: "lock" };

type UseIdleOptions = {
  /** Off (inert) unless true — non-controlled deployments pass false. */
  enabled: boolean;
  /** Idle window before locking (SESSION_IDLE_LOCK_MS). */
  idleMs: number;
  /** Heartbeat throttle while active (SESSION_HEARTBEAT_MS). */
  heartbeatMs: number;
  /** POST target that re-stamps lastActiveAt server-side. */
  heartbeatUrl: string;
};

export function useIdle({
  enabled,
  idleMs,
  heartbeatMs,
  heartbeatUrl
}: UseIdleOptions) {
  const [isIdle, setIsIdle] = useState(false);

  const lastActivityRef = useRef(Date.now());
  const lastHeartbeatRef = useRef(0);
  const lastBroadcastRef = useRef(0);
  const isIdleRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    isIdleRef.current = isIdle;
  }, [isIdle]);

  const resume = useCallback(() => {
    lastActivityRef.current = Date.now();
    isIdleRef.current = false;
    setIsIdle(false);
    // Tell peers the session is active again (an unlock in one tab clears all).
    channelRef.current?.postMessage({
      type: "activity"
    } satisfies ChannelMessage);
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(CHANNEL_NAME)
        : null;
    channelRef.current = channel;

    // Throttled activity heartbeat. It fires ONLY in response to real user input
    // (here), never on the idle countdown itself — otherwise the countdown would
    // keep re-stamping the server's `lastActiveAt` every heartbeatMs and the
    // session would never idle-lock server-side, so /unlock's loader would find
    // the session "not locked" and bounce straight back with no re-auth.
    const sendHeartbeat = (now: number) => {
      lastHeartbeatRef.current = now;
      void fetch(heartbeatUrl, {
        method: "POST",
        credentials: "same-origin"
      }).catch(() => {
        // Best-effort; a missed heartbeat just brings the lock closer.
      });
    };

    // Local real activity. Once locked, local activity does NOT clear the lock —
    // 3.1.10 requires re-authentication; only a successful unlock (resume) does.
    const onActivity = () => {
      if (isIdleRef.current) return;
      const now = Date.now();
      lastActivityRef.current = now;
      // Keep the server's lastActiveAt fresh while genuinely active, throttled.
      if (now - lastHeartbeatRef.current >= heartbeatMs) {
        sendHeartbeat(now);
      }
      if (
        channel &&
        now - lastBroadcastRef.current > ACTIVITY_BROADCAST_THROTTLE_MS
      ) {
        lastBroadcastRef.current = now;
        channel.postMessage({ type: "activity" } satisfies ChannelMessage);
      }
    };

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true });
    }

    if (channel) {
      channel.onmessage = (e: MessageEvent<ChannelMessage>) => {
        if (e.data?.type === "activity") {
          // A peer is active → the session isn't idle. Keep this tab from locking.
          if (!isIdleRef.current) lastActivityRef.current = Date.now();
        } else if (e.data?.type === "lock") {
          // A peer locked → lock all tabs together.
          isIdleRef.current = true;
          setIsIdle(true);
        }
      };
    }

    const interval = window.setInterval(() => {
      const now = Date.now();
      if (isIdleRef.current) return;

      const idleFor = now - lastActivityRef.current;
      if (idleFor > idleMs) {
        isIdleRef.current = true;
        setIsIdle(true);
        channel?.postMessage({ type: "lock" } satisfies ChannelMessage);
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, onActivity);
      }
      window.clearInterval(interval);
      channel?.close();
      channelRef.current = null;
    };
  }, [enabled, idleMs, heartbeatMs, heartbeatUrl]);

  return { isIdle: enabled && isIdle, resume };
}
