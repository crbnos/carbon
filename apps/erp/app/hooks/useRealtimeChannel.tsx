import { useCarbon } from "@carbon/auth";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef } from "react";

interface UseRealtimeChannelOptions<TDeps extends any[]> {
  /**
   * The realtime channel topic to subscribe to
   * Format: "realtime:table_name" or custom topic
   */
  topic: string;

  /**
   * Setup function that configures the channel subscriptions
   * Receives the channel and should chain `.on()` calls
   *
   * @example
   * ```tsx
   * setup: (channel) => channel
   *   .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, handleOrders)
   *   .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, handleUsers)
   * ```
   */
  setup: (channel: RealtimeChannel, deps: TDeps) => RealtimeChannel;

  /**
   * Whether the subscription is enabled
   * @default true
   */
  enabled?: boolean;

  /**
   * Whether the subscription is removed automatically on unmount
   */
  autoRemove?: boolean;

  /**
   * Dependency array for the effect
   */
  dependencies?: TDeps;
}

/**
 * Hook for subscribing to Supabase realtime channels with multiple event listeners
 *
 * Automatically handles authentication, subscription lifecycle, and cleanup.
 * Supports chaining multiple `.on()` calls for complex subscription patterns.
 *
 * @example
 * ```tsx
 * // Single subscription
 * useRealtimeChannel({
 *   topic: "orders-channel",
 *   setup: (channel) => channel
 *     .on('postgres_changes', {
 *       event: '*',
 *       schema: 'public',
 *       table: 'orders'
 *     }, (payload) => {
 *       console.log('Order changed:', payload);
 *     }),
 *   deps: []
 * });
 *
 * // Multiple subscriptions on same channel
 * useRealtimeChannel({
 *   topic: "dashboard-channel",
 *   setup: (channel) => channel
 *     .on('postgres_changes', {
 *       event: '*',
 *       schema: 'public',
 *       table: 'orders'
 *     }, handleOrders)
 *     .on('postgres_changes', {
 *       event: 'INSERT',
 *       schema: 'public',
 *       table: 'users'
 *     }, handleNewUsers)
 *     .on('broadcast', { event: 'notification' }, handleBroadcast),
 *   deps: [userId]
 * });
 * ```
 */
export const useRealtimeChannel = <TDeps extends any[]>(
  options: UseRealtimeChannelOptions<TDeps>
) => {
  const {
    topic,
    setup,
    enabled = true,
    dependencies = [],
    autoRemove,
  } = options;
  const channelRef = useRef<RealtimeChannel | null>(null);
  const { carbon, realtimeAuthSet, accessToken } = useCarbon();

  const memoSetup = useCallback(setup, dependencies);

  useEffect(() => {
    if (!carbon || !realtimeAuthSet || !enabled) return;

    // Avoid duplicate subscriptions
    if (channelRef.current) {
      channelRef.current.subscribe();
      return;
    }

    console.log(`🔴 Subscribing to realtime channel: ${topic}`);

    try {
      // Create channel and let setup function configure subscriptions
      const channel = carbon.channel(topic);
      const configuredChannel = memoSetup(channel, dependencies as TDeps);

      // Subscribe to all configured listeners
      channelRef.current = configuredChannel.subscribe((status, err) => {
        if (err) {
          console.error(`❌ Subscription error for ${topic}:`, err);
        } else {
          console.log(`✅ Subscribed to ${topic}: ${status}`);
        }
      });
    } catch (error) {
      console.error(`Failed to subscribe to realtime channel ${topic}:`, error);
    }
    return () => {
      if (channelRef.current && autoRemove) {
        carbon.removeChannel(channelRef.current).finally(() => {
          console.log(`🟡 Unsubscribed from realtime channel: ${topic}`);
          channelRef.current = null;
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtimeAuthSet, accessToken, topic, enabled, autoRemove, memoSetup]);

  return channelRef;
};
