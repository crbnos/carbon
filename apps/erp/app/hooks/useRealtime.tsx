import { getLogger } from "@carbon/logger";
import { useRealtimeChannel } from "@carbon/react";
import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router";
import { useUser } from "./useUser";

const logger = getLogger("erp", "userealtime");

// A revalidation re-runs every loader in the matched chain, including the
// 16-query `x+/_layout` shell — so a burst of row changes must not become a
// burst of revalidations. Short enough to still feel live.
const DEFAULT_DEBOUNCE_MS = 300;

export function useRealtime(
  table: string,
  filter?: string,
  debounceMs = DEFAULT_DEBOUNCE_MS
) {
  const { company } = useUser();
  const revalidator = useRevalidator();
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current);
    },
    []
  );

  const channel = useRealtimeChannel({
    topic: `postgres_changes:${table}`,
    dependencies: [company.id, filter, debounceMs],
    setup(channel) {
      return channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: table, filter: filter },
        (payload) => {
          // The row lives under `new`/`old`, never on the payload itself. This
          // guard is what stops the subscriptions that pass no `filter`
          // (journal, purchaseOrder, changeOrder, printJob, part) from
          // revalidating on another tenant's writes.
          const row = (payload.new ?? payload.old) as
            | { companyId?: string }
            | undefined;
          if (row?.companyId && row.companyId !== company.id) {
            return;
          }

          // Metadata only — `payload.new`/`payload.old` carry the whole changed
          // row, and this hook is shared by every ERP table, so logging the
          // payload puts arbitrary tenant data and PII into the logs.
          logger.info("🌀 Revalidation payload received:", {
            table,
            eventType: payload.eventType
          });

          if (timeout.current) clearTimeout(timeout.current);
          timeout.current = setTimeout(() => {
            revalidator.revalidate();
          }, debounceMs);
        }
      );
    }
  });

  return channel;
}
