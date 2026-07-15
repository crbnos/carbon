import {
  Hidden,
  Input,
  Number as NumberInput,
  Select,
  Submit,
  ValidatedForm
} from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuArrowRightLeft,
  LuEllipsisVertical,
  LuSplit,
  LuTriangleAlert
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { z } from "zod";
import { usePermissions } from "~/hooks";
import TrackedEntityStatus from "~/modules/inventory/ui/Traceability/TrackedEntityStatus";
import type { action as assignAction } from "~/routes/x+/issue+/item+/assign-entities";
import type { action as splitAction } from "~/routes/x+/issue+/item+/split";
import type { action } from "~/routes/x+/issue+/item+/update";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import {
  assignIssueItemEntitiesValidator,
  disposition,
  splitIssueItemValidator
} from "../../quality.models";
import type { IssueAssociationNode } from "../../types";
import { DispositionStatus } from "./DispositionStatus";

type AssociatedItemsListProps = {
  associatedItems: IssueAssociationNode["children"];
  isDisabled?: boolean;
};

type EntityLink = {
  id: string;
  quantity: number;
  trackedEntityId: string;
  trackedEntity: {
    id: string;
    readableId: string | null;
    status: string;
    quantity: number;
    attributes: Record<string, string> | null;
  } | null;
};

function EntityLabel({ link }: { link: EntityLink }) {
  const readableId = link.trackedEntity?.readableId;
  const idSlice = link.trackedEntityId.slice(-8);
  if (readableId) {
    return (
      <span className="font-mono truncate">
        {readableId}
        <span className="text-muted-foreground"> / {idSlice}</span>
      </span>
    );
  }
  return <span className="font-mono truncate">{idSlice}</span>;
}

type SplitTarget = {
  id: string;
  itemId: string;
  maxQuantity: number;
  itemReadableId: string;
  links: EntityLink[];
};

type MoveTarget = {
  sourceRowId: string;
  links: EntityLink[];
  siblings: { id: string; disposition: string; itemReadableId: string }[];
};

export function AssociatedItemsList({
  associatedItems,
  isDisabled = false
}: AssociatedItemsListProps) {
  const [items] = useItems();
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<typeof action>();
  const splitFetcher = useFetcher<typeof splitAction>();
  const assignFetcher = useFetcher<typeof assignAction>();
  const [splitTarget, setSplitTarget] = useState<SplitTarget | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [dragOverRowId, setDragOverRowId] = useState<string | null>(null);

  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  useEffect(() => {
    if (
      splitFetcher.data &&
      "error" in splitFetcher.data &&
      splitFetcher.data?.error
    ) {
      toast.error(splitFetcher.data.error.message);
    }
    if (splitFetcher.state === "idle" && (splitFetcher.data as any)?.success) {
      setSplitTarget(null);
    }
  }, [splitFetcher.data, splitFetcher.state]);

  useEffect(() => {
    if (
      assignFetcher.data &&
      "error" in assignFetcher.data &&
      assignFetcher.data?.error
    ) {
      toast.error(assignFetcher.data.error.message);
    }
    if (
      assignFetcher.state === "idle" &&
      (assignFetcher.data as any)?.success
    ) {
      setMoveTarget(null);
    }
  }, [assignFetcher.data, assignFetcher.state]);

  const onUpdateDisposition = useCallback(
    (nonConformanceItemId: string, dispositionValue: string | null) => {
      const formData = new FormData();
      formData.append("id", nonConformanceItemId);
      formData.append("field", "disposition");
      formData.append("value", dispositionValue ?? "");

      fetcher.submit(formData, {
        method: "post",
        action: path.to.updateIssueItem
      });
    },
    [fetcher]
  );

  const onMoveEntity = useCallback(
    (
      sourceRowId: string,
      targetRowId: string,
      assignment: { trackedEntityId: string; quantity: number }
    ) => {
      const formData = new FormData();
      formData.append("nonConformanceItemId", sourceRowId);
      formData.append("targetItemId", targetRowId);
      formData.append("entityAssignments", JSON.stringify([assignment]));

      assignFetcher.submit(formData, {
        method: "post",
        action: path.to.assignIssueItemEntities
      });
    },
    [assignFetcher]
  );

  const rows = useMemo(() => {
    if (!associatedItems) return [];
    return associatedItems.map((child) => {
      const row = child as any;
      const links: EntityLink[] = Array.isArray(row.links) ? row.links : [];
      const quantity = Number(row.quantity ?? 0);
      const linkedSum = links.reduce(
        (acc, l) => acc + Number(l.quantity ?? 0),
        0
      );
      return {
        child,
        row,
        links,
        quantity,
        linkedSum,
        disposition: row.disposition as string | null | undefined,
        pending:
          !row.disposition || row.disposition === "Pending" ? true : false,
        sumMismatch: Math.abs(linkedSum - quantity) > 1e-6
      };
    });
  }, [associatedItems]);

  if (!associatedItems || associatedItems.length === 0) {
    return null;
  }

  // Disposition only applies to rows that route physical tracked entities.
  // Hide the entire card when nothing here is dispositionable (e.g. an NCR
  // from a non-tracked job-operation part), matching the closure validator's
  // skip-on-no-links rule.
  const dispositionableRows = rows.filter((r) => r.links.length > 0);
  if (dispositionableRows.length === 0) {
    return null;
  }

  const canEdit = permissions.can("update", "quality") && !isDisabled;
  const blockingRows = dispositionableRows.filter(
    (r) => r.pending || r.sumMismatch
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {dispositionableRows.length > 1 ? t`Dispositions` : t`Disposition`}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {blockingRows.length > 0 && (
          <Alert variant="warning" className="mb-4">
            <LuTriangleAlert className="size-4" />
            <AlertTitle>
              <Trans>Closure blocked</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans>
                Resolve these before completing the NCR: every row must have a
                non-Pending disposition, and its linked entity quantities must
                match the row quantity.
              </Trans>
            </AlertDescription>
          </Alert>
        )}
        <ul className="flex flex-col divide-y divide-border">
          {dispositionableRows.map((r) => {
            const item = items.find((i) => i.id === r.child.documentId);
            if (!item) return null;

            const sameItemSiblings = dispositionableRows.filter(
              (s) =>
                s.child.id !== r.child.id &&
                s.child.documentId === r.child.documentId
            );
            const siblings = dispositionableRows
              .filter((s) => s.child.id !== r.child.id)
              .map((s) => ({
                id: s.child.id as string,
                disposition: (s.disposition ?? "Pending") as string,
                itemReadableId: item.readableIdWithRevision
              }));
            // Split breaks a portion of the row onto a new disposition row.
            // A single batch lot is subdivided server-side (a new tracked
            // entity is created for the split-off quantity), so any row with
            // quantity > 1 is splittable, even when it's one indivisible lot.
            const canSplit = r.quantity > 1;
            const hasRowActions = canSplit || siblings.length > 0;
            const isDropTarget =
              canEdit &&
              sameItemSiblings.length > 0 &&
              dragOverRowId === r.child.id;

            return (
              <li
                key={r.child.id}
                className={`py-4 first:pt-0 last:pb-0 transition-colors rounded-md ${
                  isDropTarget ? "bg-accent/40 ring-2 ring-accent" : ""
                }`}
                data-blocked={r.pending || r.sumMismatch ? "true" : undefined}
                onDragOver={(e) => {
                  if (!canEdit) return;
                  const marker =
                    `application/x-issue-item:${item.id}`.toLowerCase();
                  const matches = Array.from(e.dataTransfer.types).some(
                    (t) => t.toLowerCase() === marker
                  );
                  if (!matches) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverRowId(r.child.id);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  setDragOverRowId((id) => (id === r.child.id ? null : id));
                }}
                onDrop={(e) => {
                  if (!canEdit) return;
                  setDragOverRowId(null);
                  const payload = e.dataTransfer.getData("application/json");
                  if (!payload) return;
                  try {
                    const data = JSON.parse(payload) as {
                      sourceRowId: string;
                      itemId: string;
                      trackedEntityId: string;
                      quantity: number;
                    };
                    if (data.itemId !== item.id) return;
                    if (data.sourceRowId === r.child.id) return;
                    e.preventDefault();
                    onMoveEntity(data.sourceRowId, r.child.id, {
                      trackedEntityId: data.trackedEntityId,
                      quantity: data.quantity
                    });
                  } catch {
                    // ignore malformed drag payload
                  }
                }}
              >
                <div className="flex items-start w-full gap-4">
                  <div className="flex flex-col min-w-0 flex-1">
                    <h3 className="font-semibold truncate">
                      {item.readableIdWithRevision}
                    </h3>
                    <p className="text-xs text-muted-foreground truncate">
                      {item.name}
                    </p>
                  </div>
                  <div className="w-20 shrink-0 flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      <Trans>Quantity</Trans>
                    </span>
                    <span className="h-8 flex items-center text-sm tabular-nums">
                      {r.quantity}
                    </span>
                  </div>
                  <ValidatedForm
                    defaultValues={{
                      disposition: r.disposition ?? "Pending"
                    }}
                    validator={z.object({
                      disposition: z.string()
                    })}
                    className="w-[150px] shrink-0 items-center"
                  >
                    <Select
                      options={disposition.map((d) => ({
                        value: d,
                        label: <DispositionStatus disposition={d} />
                      }))}
                      isReadOnly={!canEdit}
                      label={t`Status`}
                      name="disposition"
                      inline={(value) => {
                        return (
                          <div className="h-8 flex items-center min-w-0 max-w-full">
                            <DispositionStatus disposition={value} />
                          </div>
                        );
                      }}
                      onChange={(value) => {
                        if (value) {
                          onUpdateDisposition(r.child.id, value.value);
                        }
                      }}
                    />
                  </ValidatedForm>
                  <div className="w-10 shrink-0 flex items-start justify-end">
                    {canEdit && r.links.length > 0 && hasRowActions && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            size="md"
                            variant="secondary"
                            aria-label={t`More actions`}
                            icon={<LuEllipsisVertical />}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canSplit && (
                            <DropdownMenuItem
                              onClick={() =>
                                setSplitTarget({
                                  id: r.child.id as string,
                                  itemId: item.id,
                                  maxQuantity: r.quantity,
                                  itemReadableId: item.readableIdWithRevision,
                                  links: r.links
                                })
                              }
                            >
                              <LuSplit className="mr-2 size-4" />
                              <Trans>Split line</Trans>
                            </DropdownMenuItem>
                          )}
                          {siblings.length > 0 && (
                            <DropdownMenuItem
                              onClick={() =>
                                setMoveTarget({
                                  sourceRowId: r.child.id as string,
                                  links: r.links,
                                  siblings
                                })
                              }
                            >
                              <LuArrowRightLeft className="mr-2 size-4" />
                              <Trans>Move entities…</Trans>
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>

                {r.links.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-1.5 pl-0.5">
                    {r.links.map((link) => {
                      const draggable = canEdit && sameItemSiblings.length > 0;
                      return (
                        <li
                          key={link.id}
                          draggable={draggable}
                          onDragStart={(e) => {
                            if (!draggable) return;
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData(
                              "application/json",
                              JSON.stringify({
                                sourceRowId: r.child.id,
                                itemId: item.id,
                                trackedEntityId: link.trackedEntityId,
                                quantity: Number(link.quantity)
                              })
                            );
                            e.dataTransfer.setData(
                              `application/x-issue-item:${item.id}`,
                              "1"
                            );
                          }}
                          className={`inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 py-1 pl-2.5 pr-1.5 text-xs ${
                            draggable
                              ? "cursor-grab active:cursor-grabbing hover:bg-muted/70"
                              : ""
                          }`}
                        >
                          <EntityLabel link={link} />
                          <TrackedEntityStatus
                            status={link.trackedEntity?.status as any}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}

                {r.sumMismatch && (
                  <p className="mt-2 text-xs text-warning-foreground">
                    <Trans>
                      Linked entity quantity ({r.linkedSum}) does not match row
                      quantity ({r.quantity}).
                    </Trans>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>

      {splitTarget && (
        <SplitLineModal
          target={splitTarget}
          fetcher={splitFetcher}
          onClose={() => setSplitTarget(null)}
        />
      )}

      {moveTarget && (
        <MoveEntitiesModal
          target={moveTarget}
          fetcher={assignFetcher}
          onClose={() => setMoveTarget(null)}
        />
      )}
    </Card>
  );
}

function SplitLineModal({
  target,
  fetcher,
  onClose
}: {
  target: SplitTarget;
  fetcher: ReturnType<typeof useFetcher<typeof splitAction>>;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const isSubmitting = fetcher.state !== "idle";
  const hasMultipleEntities = target.links.length > 1;

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [splitQty, setSplitQty] = useState(1);

  const selectedAssignments = target.links
    .filter((l) => selected[l.trackedEntityId])
    .map((l) => ({
      trackedEntityId: l.trackedEntityId,
      quantity: Number(l.quantity)
    }));

  const selectedSum = selectedAssignments.reduce(
    (acc, a) => acc + a.quantity,
    0
  );
  // The split-off portion must leave something on the original row, so it has
  // to be a whole positive quantity strictly less than the current quantity.
  const splitQtyValid =
    Number.isFinite(splitQty) && splitQty >= 1 && splitQty < target.maxQuantity;
  const canSubmit = hasMultipleEntities
    ? selectedAssignments.length > 0 &&
      selectedSum > 0 &&
      selectedSum < target.maxQuantity
    : splitQtyValid;

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Split line</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Move some of the quantity into a new disposition row so MRB can
              decide each portion separately (e.g. scrap some, rework some).
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ValidatedForm
          fetcher={fetcher}
          method="post"
          action={path.to.splitIssueItem}
          validator={splitIssueItemValidator}
          defaultValues={{
            id: target.id,
            itemId: target.itemId,
            splitQuantity: hasMultipleEntities ? undefined : 1
          }}
        >
          <ModalBody>
            <Hidden name="id" />
            <Hidden name="itemId" />
            <input
              type="hidden"
              name="entityAssignments"
              value={
                hasMultipleEntities ? JSON.stringify(selectedAssignments) : ""
              }
            />
            <div className="flex flex-col gap-4 w-full">
              <Input
                name="currentQuantity"
                label={t`Current quantity`}
                isReadOnly
                value={String(target.maxQuantity)}
              />
              {hasMultipleEntities ? (
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">
                    <Trans>Entities to split off</Trans>
                  </label>
                  <ul className="flex flex-col divide-y divide-border border border-border rounded-md max-h-64 overflow-y-auto">
                    {target.links.map((link) => (
                      <li
                        key={link.id}
                        className="flex items-center gap-2 text-sm px-3 py-2"
                      >
                        <Checkbox
                          checked={!!selected[link.trackedEntityId]}
                          onCheckedChange={(checked) =>
                            setSelected((prev) => ({
                              ...prev,
                              [link.trackedEntityId]: checked === true
                            }))
                          }
                        />
                        <div className="text-xs flex-1 min-w-0">
                          <EntityLabel link={link} />
                        </div>
                        <TrackedEntityStatus
                          status={link.trackedEntity?.status as any}
                        />
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    <Trans>
                      Selected: {selectedSum} / remaining after split:{" "}
                      {target.maxQuantity - selectedSum}
                    </Trans>
                  </p>
                </div>
              ) : (
                <NumberInput
                  name="splitQuantity"
                  label={t`Split off quantity`}
                  minValue={1}
                  maxValue={target.maxQuantity - 1}
                  onChange={setSplitQty}
                  helperText={t`Remaining after split stays on the original row.`}
                />
              )}
              {!hasMultipleEntities && !splitQtyValid && (
                <p className="text-xs text-destructive-foreground">
                  <Trans>
                    Enter a quantity between 1 and {target.maxQuantity - 1}.
                  </Trans>
                </p>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <HStack spacing={2}>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Submit
                isDisabled={isSubmitting || !canSubmit}
                isLoading={isSubmitting}
              >
                <Trans>Split</Trans>
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

function MoveEntitiesModal({
  target,
  fetcher,
  onClose
}: {
  target: MoveTarget;
  fetcher: ReturnType<typeof useFetcher<typeof assignAction>>;
  onClose: () => void;
}) {
  const isSubmitting = fetcher.state !== "idle";
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [targetItemId, setTargetItemId] = useState<string>(
    target.siblings[0]?.id ?? ""
  );

  const selectedAssignments = target.links
    .filter((l) => selected[l.trackedEntityId])
    .map((l) => ({
      trackedEntityId: l.trackedEntityId,
      quantity: Number(l.quantity)
    }));

  const canSubmit = selectedAssignments.length > 0 && targetItemId !== "";

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Move entities</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Reassign specific tracked entities from this row to another
              disposition row.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ValidatedForm
          fetcher={fetcher}
          method="post"
          action={path.to.assignIssueItemEntities}
          validator={assignIssueItemEntitiesValidator}
          defaultValues={{
            nonConformanceItemId: target.sourceRowId,
            targetItemId
          }}
        >
          <ModalBody>
            <div className="flex flex-col gap-4 w-full">
              <Hidden name="nonConformanceItemId" />
              <input type="hidden" name="targetItemId" value={targetItemId} />
              <input
                type="hidden"
                name="entityAssignments"
                value={JSON.stringify(selectedAssignments)}
              />
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">
                  <Trans>Target disposition row</Trans>
                </label>
                <select
                  className="border border-border rounded-md px-3 py-2 text-sm bg-background"
                  value={targetItemId}
                  onChange={(e) => setTargetItemId(e.target.value)}
                >
                  {target.siblings.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.disposition}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">
                  <Trans>Entities to move</Trans>
                </label>
                <ul className="flex flex-col divide-y divide-border border border-border rounded-md max-h-64 overflow-y-auto">
                  {target.links.map((link) => (
                    <li
                      key={link.id}
                      className="flex items-center gap-2 text-sm px-3 py-2"
                    >
                      <Checkbox
                        checked={!!selected[link.trackedEntityId]}
                        onCheckedChange={(checked) =>
                          setSelected((prev) => ({
                            ...prev,
                            [link.trackedEntityId]: checked === true
                          }))
                        }
                      />
                      <div className="text-xs flex-1 min-w-0">
                        <EntityLabel link={link} />
                      </div>
                      <TrackedEntityStatus
                        status={link.trackedEntity?.status as any}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <HStack spacing={2}>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Submit
                isDisabled={isSubmitting || !canSubmit}
                isLoading={isSubmitting}
              >
                <Trans>Move</Trans>
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
