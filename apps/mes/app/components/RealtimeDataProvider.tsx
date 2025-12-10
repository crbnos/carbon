"use client";

import { useCarbon } from "@carbon/auth";
import { fetchAllFromTable } from "@carbon/database";
import { useRealtimeChannel } from "@carbon/react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import idb from "localforage";
import { useEffect, useRef } from "react";
import { useUser } from "~/hooks";
import { useItems, usePeople } from "~/stores";
import type { Item } from "~/stores/items";

let hydratedFromIdb = false;
let hydratedFromServer = false;

const RealtimeDataProvider = ({ children }: { children: React.ReactNode }) => {
  const { carbon, accessToken, isRealtimeAuthSet } = useCarbon();
  const {
    company: { id: companyId },
  } = useUser();

  useEffect(() => {
    hydratedFromServer = false;
  }, [companyId]);

  const [, setItems] = useItems();
  const [, setPeople] = usePeople();

  const channelRef = useRef<RealtimeChannel | null>(null);

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
      fetchAllFromTable(
        carbon,
        "item",
        "id, readableIdWithRevision, name, type, replenishmentSystem, itemTrackingType, active, thumbnailPath, modelUpload:modelUploadId(thumbnailPath)",
        (query) =>
          query
            .eq("companyId", companyId)
            .order("readableId", { ascending: true })
            .order("revision", { ascending: false })
      ),
      fetchAllFromTable(
        carbon,
        "employees",
        "id, name, email, avatarUrl",
        (query) => query.eq("companyId", companyId).order("name")
      ),
    ]);

    if (items.error) {
      throw new Error("Failed to fetch items");
    }
    if (people.error) {
      throw new Error("Failed to fetch people");
    }

    hydratedFromServer = true;

    type ItemWithModelUpload = Item & {
      modelUpload?: { thumbnailPath: string | null } | null;
    };
    const itemData = (items.data ?? []) as unknown as ItemWithModelUpload[];
    setItems(
      itemData.map((item) => ({
        id: item.id,
        name: item.name,
        readableIdWithRevision: item.readableIdWithRevision,
        type: item.type,
        replenishmentSystem: item.replenishmentSystem,
        itemTrackingType: item.itemTrackingType,
        active: item.active,
        thumbnailPath:
          item.thumbnailPath ?? item.modelUpload?.thumbnailPath ?? null,
      }))
    );
    setPeople(
      // @ts-ignore
      people.data?.filter((p) => !p.email?.includes("@carbon.ms")) ?? []
    );
  };

  useEffect(() => {
    if (!companyId) return;
    hydrate();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, accessToken]);

  useRealtimeChannel({
    topic: "realtime:core",
    dependencies: [companyId],
    setup(channel) {
      return channel.on(
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
                    replenishmentSystem: inserted.replenishmentSystem,
                    itemTrackingType: inserted.itemTrackingType,
                    type: inserted.type,
                    active: inserted.active,
                    thumbnailPath: inserted.thumbnailPath,
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
                        thumbnailPath: updated.thumbnailPath,
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
      );
    },
  });

  return <>{children}</>;
};

export default RealtimeDataProvider;
