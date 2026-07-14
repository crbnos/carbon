import { getLogger } from "@carbon/logger";
import { useRealtimeChannel } from "@carbon/react";
import { useRevalidator } from "react-router";
import { useUser } from "./useUser";

const logger = getLogger("erp", "userealtime");

export function useRealtime(table: string, filter?: string) {
  const { company } = useUser();
  const revalidator = useRevalidator();

  const channel = useRealtimeChannel({
    topic: `postgres_changes:${table}`,
    dependencies: [company.id, filter],
    setup(channel) {
      return channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: table, filter: filter },
        (payload) => {
          if ("companyId" in payload && payload.companyId !== company.id) {
            return;
          }
          logger.info("🌀 Revalidaiton payload received:", payload);
          revalidator.revalidate();
        }
      );
    }
  });

  return channel;
}
