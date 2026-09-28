"use client";

import { useCarbon } from "@carbon/auth";
import { type Database, fetchAllFromTable } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { useRealtimeChannel } from "@carbon/react";
import { useEffect } from "react";
import { useUser } from "~/hooks";
import {
  upsertIntoListStore,
  useCustomers,
  useItems,
  usePeople,
  useSuppliers
} from "~/stores";
import type { Item } from "~/stores/items";
import type { ListItem } from "~/types";
import { ITEM_QUANTITIES_QUERY_KEY } from "~/utils/react-query";

const logger = getLogger("erp", "realtime-data-provider");

// IndexedDB entries are keyed per company (`customers:<companyId>`) — a global
// key let one company's cached list hydrate the pickers after switching to
// another company, which produced cross-tenant refs (e.g. a salesOrder pointing
// at another company's customer). `activeCompanyId` also guards the async idb /
// fetch callbacks racing a mid-flight company switch.
let activeCompanyId: string | null = null;
let hydratedFromServer = false;

const LEGACY_IDB_KEYS = ["customers", "items", "suppliers", "people"];

const RealtimeDataProvider = ({ children }: { children: React.ReactNode }) => {
  const { carbon, accessToken } = useCarbon();
  const {
    company: { id: companyId }
  } = useUser();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    hydratedFromServer = false;
  }, [companyId]);

  // Reset on logout so the next login triggers a fresh server hydrate.
  useEffect(() => {
    if (!accessToken) hydratedFromServer = false;
  }, [accessToken]);

  const [, setItems] = useItems();
  const [, setSuppliers] = useSuppliers();
  const [, setCustomers] = useCustomers();
  const [, setPeople] = usePeople();

  const hydrate = async () => {
    const idb = (await import("localforage")).default;
    const requestedCompanyId = companyId;
    if (activeCompanyId !== requestedCompanyId) {
      activeCompanyId = requestedCompanyId;

      // pre-keying entries were global; purge so they can never hydrate again
      for (const key of LEGACY_IDB_KEYS) {
        void idb.removeItem(key);
      }

      const fresh = () =>
        !hydratedFromServer && activeCompanyId === requestedCompanyId;

      idb.getItem(`customers:${requestedCompanyId}`).then((data) => {
        if (data && fresh()) setCustomers(data as ListItem[], true);
      });
      idb.getItem(`items:${requestedCompanyId}`).then((data) => {
        if (data && fresh()) setItems(data as Item[], true);
      });
      idb.getItem(`suppliers:${requestedCompanyId}`).then((data) => {
        if (data && fresh()) setSuppliers(data as ListItem[], true);
      });
      idb.getItem(`people:${requestedCompanyId}`).then((data) => {
        // @ts-ignore
        if (data && fresh()) setPeople(data, true);
      });
    }

    if (!carbon || !accessToken || hydratedFromServer) return;

    const [items, suppliers, customers, people, supersessions] =
      await Promise.all([
        fetchAllFromTable<{
          id: string;
          readableId: string;
          revision: string;
          readableIdWithRevision: string;
          unitOfMeasureCode: string;
          name: string;
          type: Database["public"]["Enums"]["itemType"];
          replenishmentSystem: Database["public"]["Enums"]["itemReplenishmentSystem"];
          active: boolean;
          itemTrackingType: Database["public"]["Enums"]["itemTrackingType"];
        }>(
          carbon,
          "item",
          "id, readableId, revision, readableIdWithRevision, unitOfMeasureCode, name, type, replenishmentSystem, active, itemTrackingType",
          (query) =>
            query
              .eq("companyId", companyId)
              .order("readableId", { ascending: true })
              .order("revision", { ascending: false })
        ),
        fetchAllFromTable<{
          id: string;
          name: string;
          website: string;
          supplierStatus: string;
          readableId: string | null;
        }>(
          carbon,
          "supplier",
          "id, name, website, supplierStatus, readableId",
          (query) => query.eq("companyId", companyId).order("name")
        ),
        fetchAllFromTable<{
          id: string;
          name: string;
          website: string;
          readableId: string | null;
        }>(carbon, "customer", "id, name, website, readableId", (query) =>
          query.eq("companyId", companyId).order("name")
        ),
        fetchAllFromTable<{
          id: string;
          name: string;
          email: string;
          avatarUrl: string;
          active: boolean;
        }>(carbon, "employees", "id, name, email, avatarUrl, active", (query) =>
          query.eq("companyId", companyId).order("name")
        ),
        fetchAllFromTable<{
          itemId: string;
          supersessionMode: Database["public"]["Enums"]["supersessionMode"];
          successorItemId: string | null;
        }>(
          carbon,
          "itemSupersession",
          "itemId, supersessionMode, successorItemId",
          (query) => query.eq("companyId", companyId)
        )
      ]);

    if (items.error) {
      throw new Error("Failed to fetch items");
    }
    if (suppliers.error) {
      throw new Error("Failed to fetch suppliers");
    }
    if (customers.error) {
      throw new Error("Failed to fetch customers");
    }
    if (people.error) {
      throw new Error("Failed to fetch people");
    }

    // company switched while fetching — these results belong to the old company
    if (activeCompanyId !== requestedCompanyId) return;

    hydratedFromServer = true;

    const supersessionByItem = new Map(
      (supersessions.data ?? []).map((s) => [s.itemId, s])
    );
    const itemsWithLifecycle = (items.data ?? []).map((i) => ({
      ...i,
      supersessionMode: supersessionByItem.get(i.id)?.supersessionMode ?? null,
      successorItemId: supersessionByItem.get(i.id)?.successorItemId ?? null
    }));
    setItems(itemsWithLifecycle);
    setSuppliers(suppliers.data ?? []);
    setCustomers(customers.data ?? []);
    setPeople(people.data ?? []);

    await Promise.all([
      idb.setItem(`items:${requestedCompanyId}`, itemsWithLifecycle),
      idb.setItem(`suppliers:${requestedCompanyId}`, suppliers.data),
      idb.setItem(`customers:${requestedCompanyId}`, customers.data),
      idb.setItem(`people:${requestedCompanyId}`, people.data)
    ]);
  };

  // Re-run when auth becomes ready: `hydrate()` bails if `carbon` / `accessToken` are missing,
  // and with only `[companyId]` that first run could be the only attempt — leaving `items` empty
  // (e.g. New Job item combobox shows no options).
  // biome-ignore lint/correctness/useExhaustiveDependencies: hydrate closes over setters + idb
  useEffect(() => {
    if (!companyId) return;
    hydrate().catch((err) => logger.error("hydrate failed", { error: err }));
  }, [companyId, carbon, accessToken]);

  // Every subscription below is filtered by `companyId` server-side. Without it
  // each tenant's row changes are fanned out to every connected client and then
  // discarded in JS — the client-side guards stay as defence in depth. The filter
  // holds on DELETE too: `companyId` is part of each table's composite PK, so it
  // is present in a payload that otherwise carries only key columns.
  useRealtimeChannel({
    topic: `realtime:core`,
    dependencies: [companyId],
    setup(channel, carbon) {
      return channel
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "item",
            filter: `companyId=eq.${companyId}`
          },
          (payload) => {
            switch (payload.eventType) {
              case "INSERT":
                if (
                  "companyId" in payload.new &&
                  payload.new.companyId !== companyId
                )
                  return;
                const { new: inserted } = payload;

                setItems((items) =>
                  [
                    ...items,
                    {
                      id: inserted.id,
                      name: inserted.name,
                      readableId: inserted.readableId,
                      revision: inserted.revision,
                      readableIdWithRevision: inserted.readableIdWithRevision,
                      description: inserted.description,
                      replenishmentSystem: inserted.replenishmentSystem,
                      itemTrackingType: inserted.itemTrackingType,
                      unitOfMeasureCode: inserted.unitOfMeasureCode,
                      type: inserted.type,
                      active: inserted.active
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
                          readableId: updated.readableId,
                          revision: updated.revision,
                          readableIdWithRevision:
                            updated.readableIdWithRevision,
                          name: updated.name,
                          replenishmentSystem: updated.replenishmentSystem,
                          itemTrackingType: updated.itemTrackingType,
                          unitOfMeasureCode: updated.unitOfMeasureCode,
                          type: updated.type,
                          active: updated.active
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
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            // Quantities are maintained incrementally by triggers on itemLedger,
            // so this fires on the posting itself rather than up to 30 min later
            // (the matview refresh this replaced).
            table: "itemStockQuantities",
            filter: `companyId=eq.${companyId}`
          },
          (payload) => {
            // companyId is part of the primary key, so it is present even on a
            // DELETE payload (which otherwise carries only key columns).
            const row =
              payload.eventType === "DELETE" ? payload.old : payload.new;
            if (row && "companyId" in row && row.companyId !== companyId)
              return;
            // Invalidate rather than refetch: the on-hand map is fetched by the
            // item picker (`useItemQuantities` in `~/components/Form/Item`) and
            // only when one is mounted. Re-reading the whole table here cost a
            // full download per burst of stock movements for a dropdown badge
            // that may not be on screen at all.
            // Every key under this prefix, not just this company's: the
            // companyId term of the key comes from `getCompanyId()`, which
            // reads `document.cookie` — and every cookie here is httpOnly, so
            // it is always "null". Matching on it invalidated nothing. Keys for
            // another company would only exist after a company switch, which
            // reloads the page and empties this in-memory cache anyway.
            window.clientCache?.invalidateQueries({
              predicate: (query) =>
                (query.queryKey as unknown[])[0] === ITEM_QUANTITIES_QUERY_KEY
            });
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "customer",
            filter: `companyId=eq.${companyId}`
          },
          (payload) => {
            switch (payload.eventType) {
              case "INSERT":
                if (
                  "companyId" in payload.new &&
                  payload.new.companyId !== companyId
                )
                  return;
                const { new: inserted } = payload;
                // upsert (not append): the create-on-the-fly flow may have
                // already added this customer synchronously.
                setCustomers((customers) =>
                  upsertIntoListStore(customers, {
                    id: inserted.id,
                    name: inserted.name,
                    website: inserted.website,
                    readableId: inserted.readableId ?? undefined
                  })
                );
                break;
              case "UPDATE":
                const { new: updated } = payload;
                setCustomers((customers) =>
                  customers
                    .map((p) => {
                      if (p.id === updated.id) {
                        return {
                          ...p,
                          name: updated.name,
                          website: updated.website,
                          readableId: updated.readableId ?? undefined
                        };
                      }
                      return p;
                    })
                    .sort((a, b) => a.name.localeCompare(b.name))
                );
                break;
              case "DELETE":
                const { old: deleted } = payload;
                setCustomers((customers) =>
                  customers.filter((p) => p.id !== deleted.id)
                );
                break;
              default:
                break;
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "supplier",
            filter: `companyId=eq.${companyId}`
          },
          (payload) => {
            switch (payload.eventType) {
              case "INSERT":
                if (
                  "companyId" in payload.new &&
                  payload.new.companyId !== companyId
                )
                  return;
                const { new: inserted } = payload;
                // upsert (not append): the create-on-the-fly flow may have
                // already added this supplier synchronously.
                setSuppliers((suppliers) =>
                  upsertIntoListStore(suppliers, {
                    id: inserted.id,
                    name: inserted.name,
                    website: inserted.website,
                    supplierStatus: inserted.supplierStatus,
                    readableId: inserted.readableId ?? undefined
                  })
                );
                break;
              case "UPDATE":
                const { new: updated } = payload;
                setSuppliers((suppliers) =>
                  suppliers
                    .map((p) => {
                      if (p.id === updated.id) {
                        return {
                          ...p,
                          name: updated.name,
                          website: updated.website,
                          supplierStatus: updated.supplierStatus,
                          readableId: updated.readableId ?? undefined
                        };
                      }
                      return p;
                    })
                    .sort((a, b) => a.name.localeCompare(b.name))
                );
                break;
              case "DELETE":
                const { old: deleted } = payload;
                setSuppliers((suppliers) =>
                  suppliers.filter((p) => p.id !== deleted.id)
                );
                break;
              default:
                break;
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "employee",
            filter: `companyId=eq.${companyId}`
          },
          async (payload) => {
            // TODO: there's a cleaner way of doing this, but since customers and suppliers
            // are also in the users table, we can't automatically add/update/delete them
            // from our list of employees. So for now we just refetch.
            const { data } = await carbon
              .from("employees")
              .select("id, name, avatarUrl")
              .eq("companyId", companyId)
              .order("name");
            if (data) {
              // @ts-ignore
              setPeople(data);
            }
          }
        );
    }
  });

  return <>{children}</>;
};

export default RealtimeDataProvider;
