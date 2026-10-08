// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import { useCarbon } from "@carbon/auth";
import { Combobox, Hidden, Number, Submit, ValidatedForm } from "@carbon/form";
import {
  Button,
  Loading,
  NavRailItem,
  toast,
  useMount,
  useRouteData,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { LuGitBranchPlus, LuGitPullRequestCreateArrow } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { action as endShiftAction } from "~/routes/x+/end-shift";
import { inventoryAdjustmentValidator } from "~/services/inventory.service";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import { ToolSurface, useToolSurface } from "./MoreSheet";

export function AdjustInventory({ add }: { add: boolean }) {
  const { t } = useLingui();
  const surface = useToolSurface(
    add ? "add-inventory" : "remove-inventory",
    add ? t`Add Inventory` : t`Remove Inventory`
  );
  const fetcher = useFetcher<typeof endShiftAction>();
  const [items] = useItems();
  const [loading, setLoading] = useState(false);

  const [storageUnits, setStorageUnits] = useState<
    { value: string; label: string }[]
  >([]);
  const [selectedStorageUnit, setSelectedStorageUnit] = useState<string | null>(
    null
  );
  const { carbon } = useCarbon();

  const routeData = useRouteData<{
    location: string;
  }>(path.to.authenticatedRoot);

  const onItemChange = (value: { value: string; label: ReactNode } | null) => {
    if (!value || !carbon) return;
    carbon
      .from("pickMethod")
      .select("defaultStorageUnitId")
      .eq("itemId", value.value)
      .eq("locationId", routeData?.location ?? "")
      .maybeSingle()
      .then((pickMethod) => {
        setSelectedStorageUnit(pickMethod?.data?.defaultStorageUnitId ?? null);
      });
  };

  async function fetchStorageUnitsByLocationId() {
    if (!carbon) {
      toast.error(t`Failed to fetch storageUnits`);
      return;
    }
    const storageUnits = await carbon
      .from("storageUnit")
      .select("id, name")
      .eq("locationId", routeData?.location ?? "");

    setStorageUnits(
      storageUnits.data?.map((storageUnit) => ({
        value: storageUnit.id,
        label: storageUnit.name
      })) ?? []
    );
    setLoading(false);
  }

  useMount(() => {
    setLoading(true);
    fetchStorageUnitsByLocationId();
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (fetcher.data?.success === true) {
      surface.done();
      toast.success(fetcher.data?.message ?? t`Inventory adjustment completed`);
    }

    if (fetcher.data?.success === false) {
      toast.error(
        fetcher.data?.message ?? t`Failed to complete inventory adjustment`
      );
    }
  }, [fetcher.data?.success]);

  const itemOptions = useMemo(() => {
    return items
      .filter((i) => !["Batch", "Serial"].includes(i.itemTrackingType))
      .map((item) => ({
        label: item.readableIdWithRevision,
        helper: item.name,
        value: item.id
      }));
  }, [items]);

  const title = add ? (
    <Trans>Add Inventory</Trans>
  ) : (
    <Trans>Remove Inventory</Trans>
  );
  const description = add ? (
    <Trans>Manually add items to inventory</Trans>
  ) : (
    <Trans>Manually remove items from inventory</Trans>
  );
  const fields = (
    <>
      <Hidden
        name="entryType"
        value={add ? "Positive Adjmt." : "Negative Adjmt."}
      />
      <Hidden name="locationId" value={routeData?.location ?? ""} />
      <VStack spacing={4}>
        <Loading isLoading={loading}>
          <Combobox
            label={t`Item`}
            name="itemId"
            onChange={onItemChange}
            options={itemOptions}
            itemHeight={44}
          />
          <Number label={t`Quantity`} name="quantity" />
          <Combobox
            label={t`Storage Unit`}
            name="storageUnitId"
            options={storageUnits}
            value={selectedStorageUnit ?? ""}
            onChange={(value) => setSelectedStorageUnit(value?.value ?? null)}
          />
        </Loading>
      </VStack>
    </>
  );
  const form = (children: ReactNode) => (
    <ValidatedForm
      method="post"
      action={path.to.inventoryAdjustment}
      validator={inventoryAdjustmentValidator}
      defaultValues={{
        itemId: "",
        quantity: 1,
        entryType: add ? "Positive Adjmt." : "Negative Adjmt."
      }}
      fetcher={fetcher}
    >
      {children}
    </ValidatedForm>
  );

  return (
    <>
      <NavRailItem
        icon={add ? <LuGitPullRequestCreateArrow /> : <LuGitBranchPlus />}
        label={surface.title}
        onClick={surface.open}
      />
      <ToolSurface
        surface={surface}
        description={description}
        body={fields}
        wrap={form}
        footer={
          <>
            <Button type="button" onClick={surface.close} variant="secondary">
              <Trans>Cancel</Trans>
            </Button>
            <Submit>{title}</Submit>
          </>
        }
      />
    </>
  );
}
