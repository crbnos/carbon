import { useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useCallback, useMemo } from "react";
import { usePermissions, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import type { getAccountsList } from "~/modules/accounting";
import type { getServicesList } from "~/modules/parts";
import type { PurchaseOrderLine } from "~/modules/purchasing";
import { usePurchasedParts } from "~/stores/items";
import { path } from "~/utils/path";

export default function usePurchaseOrderLines() {
  const { id: userId } = useUser();
  const { supabase } = useSupabase();
  const permissions = usePermissions();

  const canEdit = permissions.can("update", "purchasing");
  const canDelete = permissions.can("delete", "purchasing");

  const parts = usePurchasedParts();
  const partOptions = useMemo(
    () =>
      parts.map((p) => ({
        value: p.id,
        label: p.id,
      })),
    [parts]
  );

  const accountsFetcher =
    useFetcher<Awaited<ReturnType<typeof getAccountsList>>>();
  useMount(() => {
    accountsFetcher.load(
      `${path.to.api.accounts}?type=Posting&class=Expense&class=Asset`
    );
  });
  const accountOptions = useMemo(
    () =>
      accountsFetcher.data?.data
        ? accountsFetcher.data?.data.map((a) => ({
            value: a.number,
            label: a.number,
          }))
        : [],
    [accountsFetcher.data]
  );

  const servicesFetcher =
    useFetcher<Awaited<ReturnType<typeof getServicesList>>>();
  useMount(() => {
    servicesFetcher.load(`${path.to.api.services}?type=External`);
  });

  const serviceOptions = useMemo(
    () =>
      servicesFetcher.data?.data
        ? servicesFetcher.data?.data.map((s) => ({
            value: s.id,
            label: s.id,
          }))
        : [],
    [servicesFetcher.data]
  );

  const onCellEdit = useCallback(
    async (id: string, value: unknown, row: PurchaseOrderLine) => {
      if (!supabase) throw new Error("Supabase client not found");
      return await supabase
        .from("purchaseOrderLine")
        .update({
          [id]: value,
          updatedBy: userId,
        })
        .eq("id", row.id!);
    },
    [supabase, userId]
  );

  return {
    accountOptions,
    canDelete,
    canEdit,
    partOptions,
    serviceOptions,
    supabase,
    onCellEdit,
  };
}
