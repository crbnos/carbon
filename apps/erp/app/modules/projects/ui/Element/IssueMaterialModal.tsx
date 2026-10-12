// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { useControlField, ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import {
  ChargeNumber,
  Hidden,
  Item,
  Location,
  Number as NumberField,
  Select,
  StorageUnit,
  Submit
} from "~/components/Form";
import { useUser } from "~/hooks";
import { getMethodMaterialsByMakeMethod } from "~/modules/items/items.service";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { projectIssueDirections } from "../../projects.models";
import { projectIssueValidator } from "../../projects.models";

type Direction = (typeof projectIssueDirections)[number];

type TrackedOption = { value: string; label: string };

/**
 * The tracked entities a user can pick: for an Issue, the serials or batches
 * on hand in the chosen storage unit; for a Return, the item's Consumed ones.
 */
function useTrackedEntityOptions(args: {
  itemId: string | null;
  isTracked: boolean;
  locationId: string | null;
  storageUnitId: string | null;
  direction: Direction;
}) {
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [options, setOptions] = useState<TrackedOption[]>([]);
  const { itemId, isTracked, locationId, storageUnitId, direction } = args;

  useEffect(() => {
    if (!carbon || !itemId || !isTracked) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      if (direction === "Issue") {
        if (!locationId) {
          setOptions([]);
          return;
        }
        const result = await carbon.rpc("get_item_quantities_by_tracking_id", {
          item_id: itemId,
          company_id: company.id,
          location_id: locationId
        });
        if (cancelled) return;
        setOptions(
          (result.data ?? [])
            .filter(
              (row) =>
                row.trackedEntityId &&
                Number(row.quantity) > 0 &&
                (!storageUnitId || row.storageUnitId === storageUnitId)
            )
            .map((row) => ({
              value: row.trackedEntityId,
              label: `${row.readableId ?? row.trackedEntityId} (${row.quantity})`
            }))
        );
        return;
      }
      const result = await carbon
        .from("trackedEntity")
        .select("id, readableId, quantity")
        .eq("companyId", company.id)
        .eq("itemId", itemId)
        .eq("status", "Consumed")
        .order("createdAt", { ascending: false })
        .limit(100);
      if (cancelled) return;
      setOptions(
        (result.data ?? []).map((row) => ({
          value: row.id,
          label: row.readableId ?? row.id
        }))
      );
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [
    carbon,
    company.id,
    itemId,
    isTracked,
    locationId,
    storageUnitId,
    direction
  ]);

  return options;
}

/** The methodMaterial types an issue can stand in for: picked and bought. */
const ISSUABLE_METHOD_TYPES = ["Pull from Inventory", "Purchase to Order"];

/**
 * The item ids of the linked part's bill of materials that an issue can
 * stand in for, in BOM order. Reads the active make method, then its
 * materials in one call.
 */
function useBomMaterialIds(itemId: string | null | undefined) {
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [itemIds, setItemIds] = useState<string[]>([]);

  useEffect(() => {
    if (!carbon || !itemId) {
      setItemIds([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const makeMethod = await carbon
        .from("activeMakeMethods")
        .select("id")
        .eq("itemId", itemId)
        .eq("companyId", company.id)
        .maybeSingle();
      if (cancelled || !makeMethod.data?.id) {
        if (!cancelled) setItemIds([]);
        return;
      }
      const materials = await getMethodMaterialsByMakeMethod(
        carbon,
        makeMethod.data.id
      );
      if (cancelled) return;
      setItemIds([
        ...new Set(
          (materials.data ?? [])
            .filter((material) =>
              ISSUABLE_METHOD_TYPES.includes(material.methodType)
            )
            .map((material) => material.itemId)
        )
      ]);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [carbon, company.id, itemId]);

  return itemIds;
}

/** One-click picks from the linked part's bill of materials. */
function BomMaterialPicks({
  itemIds,
  onPick
}: {
  itemIds: string[];
  onPick: (itemId: string) => void;
}) {
  const [items] = useItems();
  const [, setItemId] = useControlField<string>("itemId");
  const rows = itemIds
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (rows.length === 0) return null;
  return (
    <div className="flex w-full flex-col gap-2">
      <span className="text-xs text-muted-foreground">
        <Trans>From the part's bill of materials</Trans>
      </span>
      <div className="flex flex-wrap gap-1">
        {rows.map((item) => (
          <Button
            key={item.id}
            variant="secondary"
            size="sm"
            onClick={() => {
              setItemId(item.id);
              onPick(item.id);
            }}
          >
            <span className="font-mono">{item.readableIdWithRevision}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Issues stock to a project, or returns it. Opened from an element, the
 * charge number is fixed to it; opened from Inventory, the user picks it.
 * A posting refusal shows in the modal, which stays open.
 */
export function IssueMaterialModal({
  projectId,
  element,
  defaultLocationId,
  defaultStorageUnitId,
  action = path.to.projectIssue,
  hiddenFields,
  variant = "project",
  onClose
}: {
  /** Fixed charge number; leave both out to pick one (Inventory). */
  projectId?: string;
  element?: {
    id: string;
    readableId: string;
    name: string;
    /** The linked part: its BOM materials are offered first. */
    itemId?: string | null;
  };
  defaultLocationId?: string | null;
  /** The storage unit to issue from first, such as the technician's van. */
  defaultStorageUnitId?: string | null;
  /** The route that posts the issue (a service order's charge route). */
  action?: string;
  /** Extra values the action reads, such as `intent`. */
  hiddenFields?: Record<string, string>;
  /** A service order speaks of the order, never of a project. */
  variant?: "project" | "service";
  onClose: () => void;
}) {
  const { t } = useLingui();
  const user = useUser();
  const [items] = useItems();
  const [itemId, setItemId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(
    defaultLocationId ?? user.defaults.locationId ?? null
  );
  const [storageUnitId, setStorageUnitId] = useState<string | null>(
    defaultStorageUnitId ?? null
  );
  const [direction, setDirection] = useState<Direction>("Issue");

  const fetcher = useAction<{
    success?: boolean;
    error?: { message: string } | null;
  }>({ onSuccess: () => onClose() });
  const errorMessage =
    fetcher.state === "idle" ? fetcher.data?.error?.message : undefined;

  // Only stocked items can be issued: Non-Inventory items have no stock.
  const stockedItemIds = useMemo(
    () =>
      items
        .filter(
          (item) => item.active && item.itemTrackingType !== "Non-Inventory"
        )
        .map((item) => item.id),
    [items]
  );
  const item = items.find((i) => i.id === itemId);
  const isTracked =
    item?.itemTrackingType === "Serial" || item?.itemTrackingType === "Batch";
  const trackedOptions = useTrackedEntityOptions({
    itemId,
    isTracked,
    locationId,
    storageUnitId,
    direction
  });

  const isFixed = Boolean(projectId);
  const bomItemIds = useBomMaterialIds(element?.itemId);
  const stockedBomItemIds = useMemo(
    () => bomItemIds.filter((id) => stockedItemIds.includes(id)),
    [bomItemIds, stockedItemIds]
  );

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={projectIssueValidator}
          method="post"
          action={action}
          fetcher={fetcher}
          defaultValues={{
            projectId: projectId ?? "",
            projectElementId: element?.id,
            itemId: "",
            locationId: locationId ?? "",
            storageUnitId: defaultStorageUnitId ?? undefined,
            trackedEntityId: undefined,
            quantity: 1,
            direction: "Issue"
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Issue Material</Trans>
            </ModalTitle>
            {element && (
              <ModalDescription>
                <span className="font-mono">{element.readableId}</span>{" "}
                {element.name}
              </ModalDescription>
            )}
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              {errorMessage && (
                <Alert variant="destructive">
                  <LuTriangleAlert />
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}
              {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
                <Hidden key={name} name={name} value={value} />
              ))}
              {isFixed ? (
                <>
                  <Hidden name="projectId" />
                  <Hidden name="projectElementId" />
                </>
              ) : (
                <ChargeNumber label={t`Charge Number`} termId="charge-number" />
              )}
              <Select
                name="direction"
                label={t`Direction`}
                options={[
                  {
                    value: "Issue",
                    label:
                      variant === "service"
                        ? t`Issue to the service order`
                        : t`Issue to the project`
                  },
                  { value: "Return", label: t`Return to stock` }
                ]}
                onChange={(option) =>
                  setDirection((option?.value as Direction) ?? "Issue")
                }
              />
              <BomMaterialPicks
                itemIds={stockedBomItemIds}
                onPick={setItemId}
              />
              <Item
                name="itemId"
                label={t`Item`}
                type="Item"
                whitelist={stockedItemIds}
                onChange={(option) => setItemId(option?.value ?? null)}
              />
              <Location
                name="locationId"
                label={t`Location`}
                onChange={(location) => setLocationId(location?.value ?? null)}
              />
              <StorageUnit
                name="storageUnitId"
                label={t`Storage Unit`}
                locationId={locationId}
                itemId={itemId ?? undefined}
                isOptional
                allowCreate={false}
                onChange={(unit) => setStorageUnitId(unit?.id ?? null)}
              />
              {isTracked && (
                <Select
                  name="trackedEntityId"
                  label={
                    item?.itemTrackingType === "Serial"
                      ? t`Serial Number`
                      : t`Batch Number`
                  }
                  options={trackedOptions}
                />
              )}
              <NumberField
                name="quantity"
                label={t`Quantity`}
                minValue={0}
                formatOptions={INPUT_FORMAT.quantity}
                step={INPUT_STEP.quantity}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              {direction === "Issue" ? (
                <Trans>Issue</Trans>
              ) : (
                <Trans>Return</Trans>
              )}
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
