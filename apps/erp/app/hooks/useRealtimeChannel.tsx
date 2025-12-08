import { useCarbon } from "@carbon/auth";
import type {
  REALTIME_LISTEN_TYPES,
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT,
  RealtimeChannel,
  RealtimePostgresChangesFilter,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import type { DependencyList } from "react";
import { useCallback, useEffect, useRef } from "react";

interface UseRealtimeChannelOptions<
  T extends `${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT}`
> extends RealtimePostgresChangesFilter<`${T}`> {
  /**
   * The realtime channel topic to subscribe to
   * Format: "realtime:table_name" or custom topic
   */
  topic: RealtimeChannel["topic"];

  /**
   * The type of realtime event to listen for
   * @default "postgres_changes"
   */
  type?: `${REALTIME_LISTEN_TYPES.POSTGRES_CHANGES}`;

  /**
   * Callback function called when a matching event is received
   * @param payload - The realtime event payload containing old/new data
   */
  onMessage: (payload: RealtimePostgresChangesPayload<any>) => void;

  /**
   * Whether to automatically remove the channel on cleanup
   * @default true
   */
  autoRemove?: boolean;

  /**
   * Dependency array for memoizing the onMessage callback
   * Use this to prevent unnecessary resubscriptions
   */
  deps?: DependencyList;

  enabled?: boolean;
}

/**
 * Hook for subscribing to Supabase realtime channels
 *
 * Automatically handles authentication, subscription lifecycle, and cleanup.
 * The channel will only be created when Carbon client and access token are available.
 *
 * @example
 * ```tsx
 * // Listen for all changes on a table
 * useRealtimeChannel({
 *   topic: "realtime:orders",
 *   filter: {
 *     event: "*",
 *     schema: "public",
 *     table: "orders"
 *   },
 *   onMessage: (payload) => {
 *     console.log('Order updated:', payload.new);
 *   }
 * });
 *
 * // Listen for specific events with filters
 * useRealtimeChannel({
 *   topic: "realtime:users",
 *   filter: {
 *     event: "UPDATE",
 *     schema: "public",
 *     table: "users",
 *     filter: "status=eq.active"
 *   },
 *   onMessage: handleUserUpdate,
 *   deps: [userId] // Prevent unnecessary resubscriptions
 * });
 * ```
 *
 * @template T - The postgres changes event type
 * @param options - Configuration options for the realtime channel
 * @returns React ref containing the RealtimeChannel instance
 */
export const useRealtimeChannel = <
  T extends `${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT}`
>(
  options: UseRealtimeChannelOptions<T>
) => {
  const channel = useRef<RealtimeChannel | null>(null);
  const { carbon, accessToken, realtimeAuthSet } = useCarbon();

  const {
    topic,
    type = "postgres_changes",
    onMessage,
    autoRemove = true,
    deps = [],
    enabled = true,
    ...filter
  } = options;

  // Memoize the callback to prevent unnecessary resubscriptions
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoizedOnMessage = useCallback(onMessage, deps);

  useEffect(() => {
    // Wait for Carbon client and authentication to be ready
    if (!carbon || !accessToken || !realtimeAuthSet || !enabled) {
      return;
    }

    // Avoid duplicate subscriptions
    if (channel.current) {
      return;
    }

    try {
      channel.current = carbon
        .channel(topic)
        // @ts-expect-error - will get back to supabase types later
        .on(type, filter, memoizedOnMessage)
        .subscribe();
    } catch (error) {
      console.error("Failed to subscribe to realtime channel:", error);
    }

    return () => {
      if (channel.current) {
        try {
          channel.current.unsubscribe();

          if (autoRemove) {
            carbon?.removeChannel(channel.current);
          }
        } catch (error) {
          console.error("Failed to cleanup realtime channel:", error);
        } finally {
          channel.current = null;
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    carbon,
    accessToken,
    realtimeAuthSet,
    topic,
    type,
    memoizedOnMessage,
    autoRemove,
    enabled,
  ]);

  return channel;
};
