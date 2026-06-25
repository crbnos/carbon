"use client";

import { useCarbon } from "@carbon/auth";
import { type Database, fetchAllFromTable } from "@carbon/database";
import { useInterval, useRealtimeChannel } from "@carbon/react";
import { useEffect } from "react";
import { useUser } from "~/hooks";
import { useCustomers, useItems, usePeople, useSuppliers } from "~/stores";
import type { Item } from "~/stores/items";
import type { ListItem } from "~/types";

let hydratedFromIdb = false;
let hydratedFromServer = false;

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

  const fetchQuantities = async () => {
    if (!carbon || !companyId) return;

    const { data, error } = await fetchAllFromTable<{
      itemId: string;
      locationId: string;
      quantityOnHand: number;
    }>(
      carbon,
      // @ts-ignore -- itemStockQuantities is a materialized view
      "itemStockQuantities",
      "itemId, locationId, quantityOnHand",
      (query) => query.eq("companyId", companyId)
    );

    if (error || !data) return;

    const totalMap = new Map<string, number>();
    const locationMap = new Map<string, Record<string, number>>();

    for (const row of data) {
      if (!row.itemId) continue;
      const qty = Number(row.quantityOnHand) || 0;
      const locId = row.locationId || "";

      totalMap.set(row.itemId, (totalMap.get(row.itemId) ?? 0) + qty);

      if (!locationMap.has(row.itemId)) locationMap.set(row.itemId, {});
      if (locId) locationMap.get(row.itemId)![locId] = qty;
    }

    setItems((currentItems) =>
      currentItems.map((item) => ({
        ...item,
        quantityOnHand: totalMap.get(item.id) ?? 0,
        quantityByLocation: locationMap.get(item.id) ?? {}
      }))
    );
  };

  const hydrate = async () => {
    const idb = (await import("localforage")).default;
    if (!hydratedFromIdb) {
      hydratedFromIdb = true;

      idb.getItem("customers").then((data) => {
        if (data && !hydratedFromServer) setCustomers(data as ListItem[], true);
      });
      idb.getItem("items").then((data) => {
        if (data && !hydratedFromServer) setItems(data as Item[], true);
      });
      idb.getItem("suppliers").then((data) => {
        if (data && !hydratedFromServer) setSuppliers(data as ListItem[], true);
      });
      idb.getItem("people").then((data) => {
        // @ts-ignore
        if (data && !hydratedFromServer) setPeople(data, true);
      });
    }

    if (!carbon || !accessToken || hydratedFromServer) return;

    const [items, suppliers, customers, people, supersessions] =
      await Promise.all([
        fetchAllFromTable<{
          id: string;
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
          "id, readableIdWithRevision, unitOfMeasureCode, name, type, replenishmentSystem, active, itemTrackingType",
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
        }>(carbon, "employees", "id, name, email, avatarUrl", (query) =>
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
      idb.setItem("items", itemsWithLifecycle),
      idb.setItem("suppliers", suppliers.data),
      idb.setItem("customers", customers.data),
      idb.setItem("people", people.data)
    ]);

    fetchQuantities();
  };

  // Re-run when auth becomes ready: `hydrate()` bails if `carbon` / `accessToken` are missing,
  // and with only `[companyId]` that first run could be the only attempt — leaving `items` empty
  // (e.g. New Job item combobox shows no options).
  // biome-ignore lint/correctness/useExhaustiveDependencies: hydrate closes over setters + idb
  useEffect(() => {
    if (!companyId) return;
    hydrate().catch((err) => console.error("hydrate failed:", err));
  }, [companyId, carbon, accessToken]);

  useInterval(fetchQuantities, companyId ? 10 * 60 * 1000 : null);

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
            table: "item"
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
            table: "customer"
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
                setCustomers((customers) =>
                  [
                    ...customers,
                    {
                      id: inserted.id,
                      name: inserted.name,
                      website: inserted.website,
                      readableId: inserted.readableId ?? undefined
                    }
                  ].sort((a, b) => a.name.localeCompare(b.name))
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
            table: "supplier"
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

                setSuppliers((suppliers) =>
                  [
                    ...suppliers,
                    {
                      id: inserted.id,
                      name: inserted.name,
                      website: inserted.website,
                      supplierStatus: inserted.supplierStatus,
                      readableId: inserted.readableId ?? undefined
                    }
                  ].sort((a, b) => a.name.localeCompare(b.name))
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
            table: "employee"
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
