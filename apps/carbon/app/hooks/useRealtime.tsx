import { useCarbon } from "@carbon/auth";
import { useRevalidator } from "@remix-run/react";
import { useEffect } from "react";
import { useUser } from "./useUser";

export function useRealtime(table: string, filter?: string) {
  const { company } = useUser();
  const { accessToken, carbon } = useCarbon();
  const revalidator = useRevalidator();

  useEffect(() => {
    if (!carbon || !accessToken || !table) return;
    carbon.realtime.setAuth(accessToken);

    const channel = carbon
      .channel(`postgres_changes:${table}}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: table,
          filter: filter,
        },
        (payload) => {
          if (
            "companyId" in payload.new &&
            payload.new.companyId !== company.id
          )
            return;

          revalidator.revalidate();
        }
      )
      .subscribe();

    return () => {
      if (channel) carbon?.removeChannel(channel);
    };
    // Don't put the revalidator in the deps array
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carbon, table, filter, accessToken, company.id]);
}
