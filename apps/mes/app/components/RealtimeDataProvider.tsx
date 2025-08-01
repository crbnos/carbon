"use client";

import { useCarbon } from "@carbon/auth";
import idb from "localforage";
import { useEffect } from "react";
import { useUser } from "~/hooks";
import { useItems, usePeople } from "~/stores";
import type { Item } from "~/stores/items";

let hydratedFromIdb = false;
let hydratedFromServer = false;

const RealtimeDataProvider = ({ children }: { children: React.ReactNode }) => {
  const { carbon, accessToken } = useCarbon();
  const {
    company: { id: companyId },
  } = useUser();

  useEffect(() => {
    hydratedFromServer = false;
  }, [companyId]);

  const [, setItems] = useItems();
  const [, setPeople] = usePeople();

  const hydrate = async () => {
    if (!hydratedFromIdb) {
      hydratedFromIdb = true;

      idb.getItem("items").then((data) => {
        if (data && !hydratedFromServer) setItems(data as Item[], true);
      });
      idb.getItem("people").then((data) => {
        // @ts-ignore
        if (data && !hydratedFromServer) setPeople(data, true);
      });
    }

    if (!carbon || !accessToken || hydratedFromServer) return;

    const [items, people] = await Promise.all([
      carbon
        .from("item")
        .select(
          "id, readableIdWithRevision, name, type, replenishmentSystem, itemTrackingType, active"
        )
        .eq("companyId", companyId)
        .order("readableId", { ascending: true })
        .order("revision", { ascending: false }),

      carbon
        .from("employees")
        .select("id, name, email, avatarUrl")
        .eq("companyId", companyId)
        .order("name"),
    ]);

    if (items.error) {
      throw new Error("Failed to fetch items");
    }
    if (people.error) {
      throw new Error("Failed to fetch people");
    }

    hydratedFromServer = true;

    // @ts-ignore
    setItems(items.data ?? []);
    setPeople(
      // @ts-ignore
      people.data?.filter((p) => !p.email?.includes("@carbon.ms")) ?? []
    );
  };

  useEffect(() => {
    if (!companyId) return;
    hydrate();

    if (!carbon || !accessToken) return;
    carbon.realtime.setAuth(accessToken);
    const channel = carbon
      .channel("realtime:core")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "item",
          filter: `companyId=eq.${companyId}`,
        },
        (payload) => {
          if ("companyId" in payload.new && payload.new.companyId !== companyId)
            return;
          switch (payload.eventType) {
            case "INSERT":
              const { new: inserted } = payload;

              setItems((items) =>
                [
                  ...items,
                  {
                    id: inserted.id,
                    name: inserted.name,
                    readableIdWithRevision: inserted.readableIdWithRevision,
                    description: inserted.description,
                    replenishmentSystem: inserted.replenishmentSystem,
                    itemTrackingType: inserted.itemTrackingType,
                    type: inserted.type,
                    active: inserted.active,
                  },
                ].sort((a, b) =>
                  a.readableIdWithRevision.localeCompare(
                    b.readableIdWithRevision
                  )
                )
              );

              break;
            case "UPDATE":
              const { new: updated } = payload;

              setItems((items) =>
                items
                  .map((i) => {
                    if (i.id === updated.id) {
                      return {
                        ...i,
                        readableIdWithRevision: updated.readableIdWithRevision,
                        name: updated.name,
                        replenishmentSystem: updated.replenishmentSystem,
                        type: updated.type,
                        active: updated.active,
                      };
                    }
                    return i;
                  })
                  .sort((a, b) =>
                    a.readableIdWithRevision.localeCompare(
                      b.readableIdWithRevision
                    )
                  )
              );
              break;
            case "DELETE":
              const { old: deleted } = payload;
              setItems((items) => items.filter((p) => p.id !== deleted.id));
              break;
            default:
              break;
          }
        }
      )
      .subscribe();

    return () => {
      if (channel) carbon?.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carbon, accessToken, companyId]);

  return <>{children}</>;
};

export default RealtimeDataProvider;
