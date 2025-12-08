import { useRevalidator } from "@remix-run/react";
import { useRealtimeChannel } from "./useRealtimeChannel";
import { useUser } from "./useUser";

export function useRealtime(table: string, filter?: string) {
  const { company } = useUser();
  const revalidator = useRevalidator();

  const channel = useRealtimeChannel({
    topic: `postgres_changes:${table}}`,
    event: "*",
    schema: "public",
    table: table,
    filter: filter,
    autoRemove: true,
    deps: [company.id],
    onMessage({ new: payload }) {
      if ("companyId" in payload && payload.companyId !== company.id) {
        return;
      }
      revalidator.revalidate();
    },
  });

  return channel;
}
