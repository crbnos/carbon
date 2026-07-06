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

// IndexedDB entries are keyed per company (`items:<companyId>`) — a global key
// let one company's cached list hydrate the pickers after switching to another
// company. `activeCompanyId` also guards async callbacks racing a mid-flight
// company switch.
let activeCompanyId: string | null = null;
let hydratedFromServer = false;

const LEGACY_IDB_KEYS = ["items", "people"];

const RealtimeDataProvider = ({ children }: { children: React.ReactNode }) => {
  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { carbon, accessToken, isRealtimeAuthSet } = useCarbon();
  const {
    company: { id: companyId }
  } = useUser();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    hydratedFromServer = false;
  }, [companyId]);

  const [, setItems] = useItems();
  const [, setPeople] = usePeople();

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const channelRef = useRef<RealtimeChannel | null>(null);

  const hydrate = async () => {
    const requestedCompanyId = companyId;
    if (activeCompanyId !== requestedCompanyId) {
      activeCompanyId = requestedCompanyId;

      // pre-keying entries were global; purge so they can never hydrate again
      for (const key of LEGACY_IDB_KEYS) {
        void idb.removeItem(key);
      }

      const fresh = () =>
        !hydratedFromServer && activeCompanyId === requestedCompanyId;

      idb.getItem(`items:${requestedCompanyId}`).then((data) => {
        if (data && fresh()) setItems(data as Item[], true);
      });
      idb.getItem(`people:${requestedCompanyId}`).then((data) => {
        // @ts-ignore
        if (data && fresh()) setPeople(data, true);
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
      )
    ]);

    if (items.error) {
      throw new Error("Failed to fetch items");
    }
    if (people.error) {
      throw new Error("Failed to fetch people");
    }

    // company switched while fetching — these results belong to the old company
    if (activeCompanyId !== requestedCompanyId) return;

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
          item.thumbnailPath ?? item.modelUpload?.thumbnailPath ?? null
      }))
    );
    setPeople(
      // @ts-ignore
      people.data ?? []
    );
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (!companyId) return;
    hydrate();
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
          filter: `companyId=eq.${companyId}`
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
                    thumbnailPath: inserted.thumbnailPath
                  }
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
                        thumbnailPath: updated.thumbnailPath
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
    }
  });

  return <>{children}</>;
};

export default RealtimeDataProvider;
