import { useRealtimeChannel } from "@carbon/react";
import { useRevalidator } from "react-router";

// Live-sync the Implementation Hub both directions: any change by Carbon staff or
// the customer's own users re-runs the hub loaders for every open client. Reuses
// the shared realtime channel infra (auth + reconnect handled there).
export function useImplementationRealtime(companyId: string) {
  const revalidator = useRevalidator();

  useRealtimeChannel({
    topic: `implementation:${companyId}`,
    dependencies: [companyId],
    setup(channel) {
      const onChange = () => revalidator.revalidate();
      return channel
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "implementationHub",
            filter: `id=eq.${companyId}`
          },
          onChange
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "implementationCheckState",
            filter: `companyId=eq.${companyId}`
          },
          onChange
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "implementationFieldValue",
            filter: `companyId=eq.${companyId}`
          },
          onChange
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "implementationRow",
            filter: `companyId=eq.${companyId}`
          },
          onChange
        );
    }
  });
}
