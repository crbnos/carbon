"use client";

import { useCarbon } from "@carbon/auth";
import idb from "localforage";
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
    company: { id: companyId },
  } = useUser();

  const [, setItems] = useItems();
  const [, setSuppliers] = useSuppliers();
  const [, setCustomers] = useCustomers();
  const [, setPeople] = usePeople();

  const hydrate = async () => {
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

    if (!carbon || !accessToken) return;

    const [items, suppliers, customers, people] = await Promise.all([
      carbon
        .from("item")
        .select("id, readableId, name, type, replenishmentSystem, active")
        .eq("companyId", companyId)
        .order("readableId"),
      carbon
        .from("supplier")
        .select("id, name")
        .eq("companyId", companyId)
        .order("name"),
      carbon
        .from("customer")
        .select("id, name")
        .eq("companyId", companyId)
        .order("name"),
      carbon
        .from("employees")
        .select("id, name, avatarUrl")
        .eq("companyId", companyId)
        .order("name"),
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

    // @ts-ignore
    setItems(items.data ?? []);
    setSuppliers(suppliers.data ?? []);
    setCustomers(customers.data ?? []);
    // @ts-ignore
    setPeople(people.data ?? []);
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
                    readableId: inserted.readableId,
                    description: inserted.description,
                    replenishmentSystem: inserted.replenishmentSystem,
                    type: inserted.type,
                    active: inserted.active,
                  },
                ].sort((a, b) => a.readableId.localeCompare(b.readableId))
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
                        name: updated.name,
                        replenishmentSystem: updated.replenishmentSystem,
                        type: updated.type,
                        active: updated.active,
                      };
                    }
                    return i;
                  })
                  .sort((a, b) => a.readableId.localeCompare(b.readableId))
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
          table: "customer",
        },
        (payload) => {
          if ("companyId" in payload.new && payload.new.companyId !== companyId)
            return;
          switch (payload.eventType) {
            case "INSERT":
              const { new: inserted } = payload;
              setCustomers((customers) =>
                [
                  ...customers,
                  {
                    id: inserted.id,
                    name: inserted.name,
                  },
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
        },
        (payload) => {
          if ("companyId" in payload.new && payload.new.companyId !== companyId)
            return;
          switch (payload.eventType) {
            case "INSERT":
              const { new: inserted } = payload;

              setSuppliers((suppliers) =>
                [
                  ...suppliers,
                  {
                    id: inserted.id,
                    name: inserted.name,
                  },
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
        },
        async (payload) => {
          if ("companyId" in payload.new && payload.new.companyId !== companyId)
            return;
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
