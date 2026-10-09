// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
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

/**
 * Issues stock to a project, or returns it. Opened from an element, the
 * charge number is fixed to it; opened from Inventory, the user picks it.
 * A posting refusal shows in the modal, which stays open.
 */
export function IssueMaterialModal({
  projectId,
  element,
  defaultLocationId,
  onClose
}: {
  /** Fixed charge number; leave both out to pick one (Inventory). */
  projectId?: string;
  element?: { id: string; readableId: string; name: string };
  defaultLocationId?: string | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const user = useUser();
  const [items] = useItems();
  const [itemId, setItemId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(
    defaultLocationId ?? user.defaults.locationId ?? null
  );
  const [storageUnitId, setStorageUnitId] = useState<string | null>(null);
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

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={projectIssueValidator}
          method="post"
          action={path.to.projectIssue}
          fetcher={fetcher}
          defaultValues={{
            projectId: projectId ?? "",
            projectElementId: element?.id,
            itemId: "",
            locationId: locationId ?? "",
            storageUnitId: undefined,
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
              {isFixed ? (
                <>
                  <Hidden name="projectId" />
                  <Hidden name="projectElementId" />
                </>
              ) : (
                <ChargeNumber label={t`Charge Number`} />
              )}
              <Select
                name="direction"
                label={t`Direction`}
                options={[
                  { value: "Issue", label: t`Issue to the project` },
                  { value: "Return", label: t`Return to stock` }
                ]}
                onChange={(option) =>
                  setDirection((option?.value as Direction) ?? "Issue")
                }
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
