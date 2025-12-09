import { useRevalidator } from "@remix-run/react";
import { useRealtimeChannel } from "./useRealtimeChannel";
import { useUser } from "./useUser";

export function useRealtime(table: string, filter?: string) {
  const { company } = useUser();
  const revalidator = useRevalidator();

  const channel = useRealtimeChannel({
    topic: `postgres_changes:${table}}`,
    dependencies: [company.id],
    autoRemove: true,
    setup(channel) {
      return channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: table, filter: filter },
        (payload) => {
          if ("companyId" in payload && payload.companyId !== company.id) {
            return;
          }
          revalidator.revalidate();
        }
      );
    },
  });

  return channel;
}
