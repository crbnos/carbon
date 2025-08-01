"use client";

import { useCarbon } from "@carbon/auth";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";
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

  useEffect(() => {
    hydratedFromServer = false;
  }, [companyId]);

  const [, setItems] = useItems();
  const [, setSuppliers] = useSuppliers();
  const [, setCustomers] = useCustomers();
  const [, setPeople] = usePeople();

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

    const [items, suppliers, customers, people] = await Promise.all([
      carbon
        .from("item")
        .select(
          "id, readableIdWithRevision, unitOfMeasureCode, name, type, replenishmentSystem, active, itemTrackingType"
        )
        .eq("companyId", companyId)
        .order("readableId", { ascending: true })
        .order("revision", { ascending: false }),
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
        .select("id, name, email, avatarUrl")
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
    setPeople(
      // @ts-ignore
      people.data?.filter((p) => !p.email?.includes("@carbon.ms")) ?? []
    );

    idb.setItem("items", items.data);
    idb.setItem("suppliers", suppliers.data);
    idb.setItem("customers", customers.data);
    idb.setItem("people", people.data);
  };

  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!companyId) return;
    hydrate();

    if (!channelRef.current && carbon && accessToken) {
      carbon.realtime.setAuth(accessToken);
      channelRef.current = carbon
        .channel("realtime:core")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "item",
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
                          readableIdWithRevision:
                            updated.readableIdWithRevision,
                          name: updated.name,
                          replenishmentSystem: updated.replenishmentSystem,
                          unitOfMeasureCode: updated.unitOfMeasureCode,
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
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "customer",
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
    }

    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useEffect(() => {
    if (carbon && accessToken) carbon.realtime.setAuth(accessToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  return <>{children}</>;
};

export default RealtimeDataProvider;
