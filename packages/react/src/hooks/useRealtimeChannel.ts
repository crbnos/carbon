import { useCarbon } from "@carbon/auth";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef } from "react";
import useMount from "./useMount";

interface UseRealtimeChannelOptions<TDeps extends any[]> {
  topic: string;
  setup: (
    channel: RealtimeChannel,
    carbon: SupabaseClient,
    deps: TDeps
  ) => RealtimeChannel;
  enabled?: boolean;
  dependencies?: TDeps;
}

export const useRealtimeChannel = <TDeps extends any[]>(
  options: UseRealtimeChannelOptions<TDeps>
) => {
  const { topic, setup, enabled = true, dependencies = [] } = options;
  const channelRef = useRef<RealtimeChannel | null>(null);
  const { carbon, isRealtimeAuthSet } = useCarbon();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoSetup = useCallback(setup, [topic, ...dependencies]);

  const teardown = useCallback(async () => {
    const channel = channelRef.current;

    if (!channel || !carbon) return;

    try {
      await carbon.removeChannel(channel); // prefer removeChannel always[web:14][web:37]
    } catch (error) {
      console.error(`❌ Error removing channel ${topic}:`, error);
    } finally {
      channelRef.current = null;
    }
  }, [carbon, topic]);

  useEffect(() => {
    if (!carbon) return;

    if (!isRealtimeAuthSet || !enabled) {
      // If disabled/auth lost, tear down any existing channel
      void teardown();
      return;
    }

    // Always create a fresh channel instance when deps change
    (async () => {
      // Ensure previous instance is gone before creating a new one
      if (channelRef.current) {
        await teardown();
      }

      try {
        const channel = carbon.channel(topic);

        const configuredChannel = memoSetup(
          channel,
          carbon,
          dependencies as TDeps
        );

        channelRef.current = configuredChannel;

        configuredChannel.subscribe(async (status, err) => {
          if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
            return;
          }

          // Treat error/timeout/closed as dead; tear down so effect can recreate
          if (
            status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
            status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT ||
            status === REALTIME_SUBSCRIBE_STATES.CLOSED
          ) {
            await teardown();
          }
        });
      } catch (error) {
        console.error(
          `Failed to subscribe to realtime channel ${topic}:`,
          error
        );
      }
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    carbon,
    isRealtimeAuthSet,
    enabled,
    topic,
    memoSetup,
    teardown,
    // dependencies are already in memoSetup, so not needed here
  ]);

  useMount(() => {
    return () => void teardown();
  });

  return channelRef;
};
