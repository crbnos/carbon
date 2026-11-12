// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import {
  LuCirclePlus,
  LuEllipsisVertical,
  LuPencil,
  LuTrash
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { Empty } from "~/components";
import {
  Hidden,
  Item,
  Number as NumberField,
  Select,
  StorageUnit,
  Submit
} from "~/components/Form";
import { useCurrencyFormatter, usePermissions, useUser } from "~/hooks";
import { useQuantityFormatter } from "~/hooks/useQuantityFormatter";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import { projectStockTransferLineValidator } from "../../projects.models";
import type {
  ProjectStockTransfer,
  ProjectStockTransferLine
} from "../../types";
import { StockOwner } from "./StockOwner";

type OnHandRow = {
  storageUnitId: string | null;
  trackedEntityId: string | null;
  readableId: string | null;
  quantity: number;
};

/**
 * The from-owner's on-hand of an item at the transfer's location, per bin
 * and lot: what the line can move (the slots the posting checks).
 */
function useFromStockOnHand(args: {
  itemId: string | null;
  locationId: string;
  fromProjectId: string | null;
}) {
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [rows, setRows] = useState<OnHandRow[] | null>(null);
  const { itemId, locationId, fromProjectId } = args;

  useEffect(() => {
    if (!carbon || !itemId) {
      setRows(null);
      return;
    }
    let cancelled = false;
    setRows(null);
    carbon
      .rpc("get_item_quantities_by_tracking_id", {
        item_id: itemId,
        company_id: company.id,
        location_id: locationId
      })
      .then((result) => {
        if (cancelled) return;
        setRows(
          (result.data ?? [])
            .filter(
              (row) =>
                (row.projectId ?? null) === (fromProjectId ?? null) &&
                Number(row.quantity) > 0
            )
            .map((row) => ({
              storageUnitId: row.storageUnitId ?? null,
              trackedEntityId: row.trackedEntityId ?? null,
              readableId: row.readableId ?? null,
              quantity: Number(row.quantity)
            }))
        );
      });
    return () => {
      cancelled = true;
    };
  }, [carbon, company.id, itemId, locationId, fromProjectId]);

  return rows;
}

type EditingLine = {
  id?: string;
  itemId: string;
  storageUnitId?: string;
  trackedEntityId?: string;
  quantity: number;
};

function LineModal({
  transfer,
  initialValues,
  onClose
}: {
  transfer: ProjectStockTransfer;
  initialValues: EditingLine;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [items] = useItems();
  const formatQuantity = useQuantityFormatter();
  const fetcher = useAction({ onSuccess: onClose });
  const [itemId, setItemId] = useState<string | null>(
    initialValues.itemId || null
  );
  const [storageUnitId, setStorageUnitId] = useState<string | null>(
    initialValues.storageUnitId ?? null
  );
  const [trackedEntityId, setTrackedEntityId] = useState<string | null>(
    initialValues.trackedEntityId ?? null
  );

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

  const onHand = useFromStockOnHand({
    itemId,
    locationId: transfer.locationId,
    fromProjectId: transfer.fromProjectId
  });
  const lotOptions = (onHand ?? [])
    .filter(
      (row) =>
        row.trackedEntityId &&
        (row.storageUnitId ?? null) === (storageUnitId ?? null)
    )
    .map((row) => ({
      value: row.trackedEntityId!,
      label: `${row.readableId ?? row.trackedEntityId} (${formatQuantity(row.quantity)})`
    }));
  const available = (onHand ?? [])
    .filter(
      (row) =>
        (row.storageUnitId ?? null) === (storageUnitId ?? null) &&
        (!isTracked || row.trackedEntityId === trackedEntityId)
    )
    .reduce((sum, row) => sum + row.quantity, 0);
  const owner =
    transfer.fromProject?.identifier ||
    transfer.fromProject?.name ||
    t`unassigned stock`;
  const availableText = onHand
    ? t`${formatQuantity(available)} available in ${owner} here`
    : undefined;

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={projectStockTransferLineValidator}
          method="post"
          action={path.to.projectStockTransferLines(transfer.id)}
          fetcher={fetcher}
          defaultValues={initialValues}
        >
          <ModalHeader>
            <ModalTitle>
              {initialValues.id ? (
                <Trans>Edit Line</Trans>
              ) : (
                <Trans>Add Line</Trans>
              )}
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="id" />
            <Hidden name="intent" value="save" />
            <VStack spacing={4}>
              <Item
                name="itemId"
                label={t`Item`}
                type="Item"
                whitelist={stockedItemIds}
                onChange={(option) => {
                  setItemId(option?.value ?? null);
                  setTrackedEntityId(null);
                }}
              />
              <StorageUnit
                name="storageUnitId"
                label={t`Storage Unit`}
                locationId={transfer.locationId}
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
                  options={lotOptions}
                  onChange={(option) =>
                    setTrackedEntityId(option?.value ?? null)
                  }
                />
              )}
              <NumberField
                name="quantity"
                label={t`Quantity`}
                minValue={0}
                formatOptions={INPUT_FORMAT.quantity}
                step={INPUT_STEP.quantity}
                helperText={availableText}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Save</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

type ProjectStockTransferLinesProps = {
  transfer: ProjectStockTransfer;
  lines: ProjectStockTransferLine[];
};

/**
 * The items the transfer moves, each from a bin (and lot) of the from-owner
 * at the transfer's location. Lines change only while the transfer is
 * Draft; a posted line shows the unit cost it moved at.
 */
export default function ProjectStockTransferLines({
  transfer,
  lines
}: ProjectStockTransferLinesProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const [items] = useItems();
  const formatQuantity = useQuantityFormatter();
  const formatCost = useCurrencyFormatter({ rate: true });
  const deleteFetcher = useFetcher<{}>();
  const [editing, setEditing] = useState<EditingLine | null>(null);

  const isEditable =
    transfer.status === "Draft" && permissions.can("update", "projects");
  const isPosted = transfer.status === "Posted";

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Lines</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              From <StockOwner project={transfer.fromProject} /> to{" "}
              <StockOwner project={transfer.toProject} />
            </Trans>
          </CardDescription>
          <CardAction>
            <Button
              variant="secondary"
              leftIcon={<LuCirclePlus />}
              isDisabled={!isEditable}
              onClick={() => setEditing({ itemId: "", quantity: 1 })}
            >
              <Trans>Add Line</Trans>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <Empty
              title={<Trans>No lines yet</Trans>}
              description={<Trans>Add the items to move.</Trans>}
            />
          ) : (
            <TableBase full>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Item</Trans>
                  </Th>
                  <Th>
                    <Trans>Storage Unit</Trans>
                  </Th>
                  <Th>
                    <Trans>Lot or Serial</Trans>
                  </Th>
                  <Th>
                    <Trans>Quantity</Trans>
                  </Th>
                  {isPosted && (
                    <Th>
                      <Trans>Unit Cost</Trans>
                    </Th>
                  )}
                  <Th className="w-12">
                    <span className="sr-only">
                      <Trans>Actions</Trans>
                    </span>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {lines.map((line) => {
                  const item = items.find((i) => i.id === line.itemId);
                  return (
                    <Tr key={line.id}>
                      <Td>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium">
                            {item?.readableIdWithRevision ?? line.itemId}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {item?.name}
                          </span>
                        </div>
                      </Td>
                      <Td>{line.storageUnit?.name ?? ""}</Td>
                      <Td className="whitespace-nowrap">
                        {line.trackedEntity?.readableId ?? ""}
                      </Td>
                      <Td className="tabular-nums">
                        {formatQuantity(Number(line.quantity))}
                      </Td>
                      {isPosted && (
                        <Td className="tabular-nums">
                          {line.unitCost === null
                            ? ""
                            : formatCost.format(Number(line.unitCost))}
                        </Td>
                      )}
                      <Td>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton
                              aria-label={t`More options`}
                              icon={<LuEllipsisVertical />}
                              variant="ghost"
                              size="sm"
                              isDisabled={!isEditable}
                            />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() =>
                                setEditing({
                                  id: line.id,
                                  itemId: line.itemId,
                                  storageUnitId:
                                    line.storageUnitId ?? undefined,
                                  trackedEntityId:
                                    line.trackedEntityId ?? undefined,
                                  quantity: Number(line.quantity)
                                })
                              }
                            >
                              <DropdownMenuIcon icon={<LuPencil />} />
                              <Trans>Edit Line</Trans>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              destructive
                              onClick={() =>
                                deleteFetcher.submit(
                                  { intent: "delete", id: line.id },
                                  {
                                    method: "post",
                                    action: path.to.projectStockTransferLines(
                                      transfer.id
                                    )
                                  }
                                )
                              }
                            >
                              <DropdownMenuIcon icon={<LuTrash />} />
                              <Trans>Delete Line</Trans>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </TableBase>
          )}
        </CardContent>
      </Card>
      {editing && (
        <LineModal
          transfer={transfer}
          initialValues={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
