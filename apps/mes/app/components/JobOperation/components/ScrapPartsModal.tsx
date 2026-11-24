// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ScrappableGroup } from "@carbon/database/scrappable-parts";
import { Hidden, ValidatedForm } from "@carbon/form";
import { useAction, useLoaderQuery } from "@carbon/query";
import {
  Badge,
  Button,
  cn,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { type ReactNode, useState } from "react";
import {
  LuCheck,
  LuHand,
  LuMinus,
  LuPersonStanding,
  LuPlus
} from "react-icons/lu";
import ItemThumbnail from "~/components/ItemThumbnail";
import type { loader } from "~/routes/x+/scrap-parts.$operationId";
import { scrapPartsValidator } from "~/services/models";
import { path } from "~/utils/path";
import { useScrapReasons } from "./ScrapReason";

type Replacement = "Shelf" | "Water Spider";

// The operator's last reason, so the next scrap is shorter. Browser storage
// can be missing or throw: the dialog works without it.
const LAST_REASON = "mes.scrapParts.reason";
function remembered(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function remember(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

// Above this many reasons the list gets a search box.
const SEARCHABLE_REASONS = 6;

// A serial or batch is counted under its own key, apart from the part's.
const entityKey = (trackedEntityId: string) => `#${trackedEntityId}`;

/**
 * Opens the Scrap parts dialog for an operation, from any MES view: `open()`
 * from a menu, `open(materialId)` from a part's row to start on that part.
 */
export function useScrapParts(operationId: string) {
  const [state, setState] = useState<{ open: boolean; materialId?: string }>({
    open: false
  });
  const close = () => setState((prev) => ({ ...prev, open: false }));
  return {
    open: (materialId?: string) => setState({ open: true, materialId }),
    // Stays mounted so the dialog animates closed.
    modal: (
      <Modal
        open={state.open}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <ModalContent size="large">
          <ScrapPartsForm
            operationId={operationId}
            focusMaterialId={state.materialId}
            onClose={close}
          />
        </ModalContent>
      </Modal>
    )
  };
}

/**
 * Scrap the parts one mistake ruined at an operation (loose parts, or parts
 * inside a kit) and replace them from the shelf. The dialog mounts its content
 * per open, so each open loads afresh and is one idempotency key.
 */
function ScrapPartsForm({
  operationId,
  focusMaterialId,
  onClose
}: {
  operationId: string;
  focusMaterialId?: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const loaded = useLoaderQuery<typeof loader>(path.to.scrapParts(operationId));
  const reasons = useScrapReasons();
  // nanoid, not crypto.randomUUID: a station on plain HTTP has no secure
  // context.
  const [idempotencyKey] = useState(() => nanoid());
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [pickedReasonId, setPickedReasonId] = useState(() =>
    remembered(LAST_REASON)
  );
  const [reasonQuery, setReasonQuery] = useState("");
  // Never preselected: the operator says who fetches the replacement.
  const [replacement, setReplacement] = useState<Replacement | null>(null);

  const isFocused = (part: ScrappableGroup) =>
    !!focusMaterialId &&
    (part.materialIds.includes(focusMaterialId) ||
      part.tracked.some((e) => e.materialId === focusMaterialId));
  // The part it was opened from comes first; counted by hand, it starts at 1.
  const parts = [...(loaded.data?.parts ?? [])].sort(
    (a, b) => Number(isFocused(b)) - Number(isFocused(a))
  );
  const startKey =
    parts[0] && isFocused(parts[0]) && parts[0].tracked.length === 0
      ? parts[0].key
      : null;
  const countOf = (key: string) => counts[key] ?? (key === startKey ? 1 : 0);
  const setCount = (key: string, value: number) =>
    setCounts((prev) => ({ ...prev, [key]: Math.max(0, value) }));

  // Untracked parts by count; tracked ones by the serial or batch used.
  const lines = parts.flatMap((part) => [
    ...(part.materialIds.length > 0 && countOf(part.key) > 0
      ? [
          {
            materialId:
              focusMaterialId && part.materialIds.includes(focusMaterialId)
                ? focusMaterialId
                : part.materialIds[0],
            itemId: part.itemId,
            quantity: countOf(part.key)
          }
        ]
      : []),
    ...part.tracked
      .map((e) => ({
        materialId: e.materialId,
        trackedEntityId: e.trackedEntityId,
        quantity: countOf(entityKey(e.trackedEntityId))
      }))
      .filter((line) => line.quantity > 0)
  ]);
  const anyTracked = lines.some((line) => "trackedEntityId" in line);
  const total = lines.reduce((sum, line) => sum + line.quantity, 0);
  // A remembered reason that no longer exists is dropped.
  const reasonId = reasons.some((r) => r.value === pickedReasonId)
    ? pickedReasonId
    : null;
  const query = reasonQuery.trim().toLowerCase();
  const shownReasons = query
    ? reasons.filter(
        (r) => r.value === reasonId || r.label.toLowerCase().includes(query)
      )
    : reasons;

  const action = useAction<{ success: boolean; message: string }>({
    onSuccess: () => {
      if (reasonId) remember(LAST_REASON, reasonId);
      toast.success(
        [
          replacement === "Water Spider"
            ? t`Scrapped. The water spider is bringing replacements.`
            : t`Scrapped. Grab replacements from the shelf.`,
          anyTracked ? t`Scan the replacement serials and batches in.` : ""
        ]
          .filter(Boolean)
          .join(" ")
      );
      onClose();
    },
    onError: (data) => toast.error(data.message)
  });

  return (
    <ValidatedForm
      action={path.to.scrapParts(operationId)}
      method="post"
      validator={scrapPartsValidator}
      fetcher={action}
    >
      <ModalHeader>
        <ModalTitle>
          <Trans>Scrap parts</Trans>
        </ModalTitle>
        <ModalDescription>
          <Trans>Count what is ruined. Replacements come from the shelf.</Trans>
        </ModalDescription>
      </ModalHeader>
      <ModalBody>
        <Hidden name="jobOperationId" value={operationId} />
        <Hidden name="idempotencyKey" value={idempotencyKey} />
        <Hidden name="lines" value={JSON.stringify(lines)} />
        <Hidden name="scrapReasonId" value={reasonId ?? ""} />
        <Hidden name="replacement" value={replacement ?? ""} />
        <VStack spacing={4}>
          <Choices label={t`Replacement`}>
            <Tile
              selected={replacement === "Shelf"}
              onClick={() => setReplacement("Shelf")}
            >
              <LuHand /> <Trans>I'll grab it from the shelf</Trans>
            </Tile>
            <Tile
              selected={replacement === "Water Spider"}
              onClick={() => setReplacement("Water Spider")}
            >
              <LuPersonStanding /> <Trans>Ask the water spider</Trans>
            </Tile>
          </Choices>

          <fieldset className="w-full min-w-0">
            <legend className="mb-2 text-sm font-medium">
              <Trans>Parts</Trans>
            </legend>
            {loaded.isLoading ? (
              <p className="text-muted-foreground">
                <Trans>Loading parts...</Trans>
              </p>
            ) : parts.length === 0 ? (
              <p className="text-muted-foreground">
                <Trans>
                  Nothing on this operation can be scrapped yet. Serials and
                  batches show once they are issued.
                </Trans>
              </p>
            ) : (
              <div className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto">
                {parts.map((part) => (
                  <PartRow
                    key={part.key}
                    part={part}
                    countOf={countOf}
                    setCount={setCount}
                  />
                ))}
              </div>
            )}
          </fieldset>

          <fieldset className="w-full min-w-0">
            <legend className="mb-2 text-sm font-medium">
              <Trans>Reason</Trans>
            </legend>
            {reasons.length > SEARCHABLE_REASONS && (
              <Input
                type="search"
                size="lg"
                className="mb-2"
                aria-label={t`Search reasons`}
                placeholder={t`Search reasons`}
                value={reasonQuery}
                onChange={(e) => setReasonQuery(e.target.value)}
              />
            )}
            <div className="grid max-h-[30vh] grid-cols-1 gap-2 overflow-y-auto p-0.5 sm:grid-cols-2">
              {shownReasons.map((reason) => (
                <Tile
                  key={reason.value}
                  selected={reason.value === reasonId}
                  onClick={() => setPickedReasonId(reason.value)}
                >
                  {reason.label}
                </Tile>
              ))}
            </div>
          </fieldset>
        </VStack>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" size="lg" onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
        <Button
          type="submit"
          variant="destructive"
          size="lg"
          isLoading={action.isPending}
          isDisabled={
            action.isPending || total === 0 || !reasonId || !replacement
          }
        >
          <Trans>Scrap {total}</Trans>
        </Button>
      </ModalFooter>
    </ValidatedForm>
  );
}

/** One part: its picture, how many the operation has, and what to scrap. */
function PartRow({
  part,
  countOf,
  setCount
}: {
  part: ScrappableGroup;
  countOf: (key: string) => number;
  setCount: (key: string, value: number) => void;
}) {
  const { t } = useLingui();
  const serials = part.tracked.filter((e) => e.trackingType === "Serial");
  const batches = part.tracked.filter((e) => e.trackingType === "Batch");
  const counted = part.materialIds.length > 0;
  const selected =
    countOf(part.key) > 0 ||
    part.tracked.some((e) => countOf(entityKey(e.trackedEntityId)) > 0);
  const { quantity } = part;
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-2",
        selected && "border-primary bg-primary/10"
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <ItemThumbnail thumbnailPath={part.thumbnailPath} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{part.readableId}</span>
          <span className="truncate text-sm text-muted-foreground">
            {part.name}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-sm tabular-nums text-muted-foreground">
            {counted ? (
              <Trans>{quantity} in this operation</Trans>
            ) : (
              <Trans>{quantity} used in this operation</Trans>
            )}
            {part.kit && (
              <Badge variant="secondary" className="min-h-5 px-2 text-xs">
                <Trans>Kit</Trans> {part.kit.readableId}
              </Badge>
            )}
          </span>
        </div>
        {counted && (
          <Stepper
            label={part.readableId}
            value={countOf(part.key)}
            max={quantity > 0 ? quantity : undefined}
            onChange={(value) => setCount(part.key, value)}
          />
        )}
      </div>
      {serials.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {serials.map((serial) => {
            const key = entityKey(serial.trackedEntityId);
            const picked = countOf(key) > 0;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={picked}
                onClick={() => setCount(key, picked ? 0 : 1)}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm font-medium",
                  picked
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                )}
              >
                {picked && <LuCheck />}
                {serial.kitReadableId
                  ? t`${serial.readableId} in kit ${serial.kitReadableId}`
                  : serial.readableId}
              </button>
            );
          })}
        </div>
      )}
      {batches.map((batch) => {
        const key = entityKey(batch.trackedEntityId);
        const { readableId, quantity: used, kitReadableId } = batch;
        return (
          <div key={key} className="flex min-w-0 items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-sm">
              {kitReadableId ? (
                <Trans>
                  Batch {readableId} · {used} used · in kit {kitReadableId}
                </Trans>
              ) : (
                <Trans>
                  Batch {readableId} · {used} used
                </Trans>
              )}
            </span>
            <Stepper
              label={`${part.readableId} ${readableId}`}
              value={countOf(key)}
              max={used}
              onChange={(value) => setCount(key, value)}
            />
          </div>
        );
      })}
    </div>
  );
}

function Stepper({
  label,
  value,
  max,
  onChange
}: {
  /** Names the buttons: two batches of one part need their numbers. */
  label: string;
  value: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const { t } = useLingui();
  return (
    <div className="flex shrink-0 items-center gap-2">
      <IconButton
        aria-label={t`One less ${label}`}
        variant="secondary"
        size="lg"
        icon={<LuMinus />}
        isDisabled={value === 0}
        onClick={() => onChange(value - 1)}
      />
      <span
        aria-label={t`${label} to scrap`}
        className="w-8 text-center text-lg font-semibold tabular-nums"
      >
        {value}
      </span>
      <IconButton
        aria-label={t`One more ${label}`}
        variant="secondary"
        size="lg"
        icon={<LuPlus />}
        isDisabled={max !== undefined && value >= max}
        onClick={() => onChange(value + 1)}
      />
    </div>
  );
}

function Choices({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="w-full min-w-0">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Tile({
  selected,
  onClick,
  children
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex min-h-14 w-full min-w-0 items-center gap-2 rounded-lg border px-4 py-2 text-left font-medium",
        selected
          ? "border-primary bg-primary/10 ring-2 ring-primary"
          : "hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}
