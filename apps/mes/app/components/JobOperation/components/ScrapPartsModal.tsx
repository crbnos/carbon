// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Hidden, ValidatedForm } from "@carbon/form";
import { useAction, useLoaderQuery } from "@carbon/query";
import {
  Badge,
  Button,
  cn,
  IconButton,
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
import { type ReactNode, useState } from "react";
import { LuHand, LuMinus, LuPersonStanding, LuPlus } from "react-icons/lu";
import type { loader } from "~/routes/x+/scrap-parts.$operationId";
import { scrapPartsValidator } from "~/services/models";
import { path } from "~/utils/path";
import { useScrapReasons } from "./ScrapReason";

type Replacement = "Shelf" | "Water Spider";

// The operator's last choices, so the next scrap is shorter. Browser storage
// can be missing or throw: the dialog works without it.
const LAST_REASON = "mes.scrapParts.reason";
const LAST_REPLACEMENT = "mes.scrapParts.replacement";
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

const lineKey = (materialId: string, itemId: string) =>
  `${materialId}:${itemId}`;

/**
 * Opens the Scrap parts dialog for an operation, from any MES view: `open()`
 * from a menu, `open(materialId)` from a part's row to start on that part.
 */
export function useScrapParts(operationId: string | undefined) {
  const [open, setOpen] = useState<{ materialId?: string } | null>(null);
  return {
    open: (materialId?: string) => setOpen({ materialId }),
    modal:
      open && operationId ? (
        <ScrapPartsModal
          operationId={operationId}
          focusMaterialId={open.materialId}
          onClose={() => setOpen(null)}
        />
      ) : null
  };
}

/**
 * Scrap the parts one mistake ruined at an operation (loose parts, or parts
 * inside a kit) and replace them from the shelf. Mounted per open, so each
 * open is one idempotency key.
 */
function ScrapPartsModal({
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
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [pickedReasonId, setPickedReasonId] = useState(() =>
    remembered(LAST_REASON)
  );
  const [replacement, setReplacement] = useState<Replacement>(() =>
    remembered(LAST_REPLACEMENT) === "Water Spider" ? "Water Spider" : "Shelf"
  );

  // The row it was opened from comes first; a row with one part starts at 1.
  const materials = [...(loaded.data?.materials ?? [])].sort(
    (a, b) =>
      Number(b.id === focusMaterialId) - Number(a.id === focusMaterialId)
  );
  const focused = materials.find((m) => m.id === focusMaterialId);
  const startKey =
    focused?.parts.length === 1
      ? lineKey(focused.id, focused.parts[0].itemId)
      : null;
  const countOf = (key: string) => counts[key] ?? (key === startKey ? 1 : 0);
  const setCount = (key: string, value: number) =>
    setCounts((prev) => ({ ...prev, [key]: Math.max(0, value) }));

  const lines = materials.flatMap((m) =>
    m.parts
      .map((p) => ({
        materialId: m.id,
        itemId: p.itemId,
        quantity: countOf(lineKey(m.id, p.itemId))
      }))
      .filter((line) => line.quantity > 0)
  );
  const total = lines.reduce((sum, line) => sum + line.quantity, 0);
  // A remembered reason that no longer exists is dropped.
  const reasonId = reasons.some((r) => r.value === pickedReasonId)
    ? pickedReasonId
    : null;

  const action = useAction<{ success: boolean; message: string }>({
    onSuccess: () => {
      if (reasonId) remember(LAST_REASON, reasonId);
      remember(LAST_REPLACEMENT, replacement);
      toast.success(
        replacement === "Water Spider"
          ? t`Scrapped. The water spider is bringing replacements.`
          : t`Scrapped. Grab replacements from the shelf.`
      );
      onClose();
    },
    onError: (data) => toast.error(data.message)
  });

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="large">
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
              <Trans>
                Count what is ruined. Replacements come from the shelf.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="jobOperationId" value={operationId} />
            <Hidden name="idempotencyKey" value={idempotencyKey} />
            <Hidden name="lines" value={JSON.stringify(lines)} />
            <Hidden name="scrapReasonId" value={reasonId ?? ""} />
            <Hidden name="replacement" value={replacement} />
            <VStack spacing={4}>
              <fieldset className="w-full">
                <legend className="mb-2 text-sm font-medium">
                  <Trans>Parts</Trans>
                </legend>
                {loaded.isLoading ? (
                  <p className="text-muted-foreground">
                    <Trans>Loading parts...</Trans>
                  </p>
                ) : materials.length === 0 ? (
                  <p className="text-muted-foreground">
                    <Trans>
                      Nothing on this operation can be scrapped by quantity.
                      Scrap a serial or batch from Issue.
                    </Trans>
                  </p>
                ) : (
                  <div className="flex max-h-[40vh] flex-col gap-3 overflow-y-auto">
                    {materials.map((material) => (
                      <div key={material.id} className="flex flex-col gap-1.5">
                        {material.isKit && (
                          <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                            <Badge variant="secondary">
                              <Trans>Kit</Trans>
                            </Badge>
                            <span className="truncate">
                              {material.readableId} · {material.name}
                            </span>
                          </div>
                        )}
                        {material.parts.map((part) => {
                          const key = lineKey(material.id, part.itemId);
                          return (
                            <PartCounter
                              key={key}
                              readableId={part.readableId}
                              detail={
                                part.perKit === null
                                  ? part.name
                                  : t`${part.perKit} per kit · ${part.name}`
                              }
                              value={countOf(key)}
                              onChange={(value) => setCount(key, value)}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </fieldset>

              <Choices label={t`Reason`}>
                {reasons.map((reason) => (
                  <Tile
                    key={reason.value}
                    selected={reason.value === reasonId}
                    onClick={() => setPickedReasonId(reason.value)}
                  >
                    {reason.label}
                  </Tile>
                ))}
              </Choices>

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
              isDisabled={action.isPending || total === 0 || !reasonId}
            >
              <Trans>Scrap {total}</Trans>
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

function PartCounter({
  readableId,
  detail,
  value,
  onChange
}: {
  readableId: string;
  detail: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const { t } = useLingui();
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-lg border px-4 py-2",
        value > 0 && "border-primary bg-primary/10"
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{readableId}</span>
        <span className="truncate text-sm text-muted-foreground">{detail}</span>
      </div>
      <IconButton
        aria-label={t`One less ${readableId}`}
        variant="secondary"
        size="lg"
        icon={<LuMinus />}
        isDisabled={value === 0}
        onClick={() => onChange(value - 1)}
      />
      <span
        aria-label={t`${readableId} to scrap`}
        className="w-8 text-center text-lg font-semibold tabular-nums"
      >
        {value}
      </span>
      <IconButton
        aria-label={t`One more ${readableId}`}
        variant="secondary"
        size="lg"
        icon={<LuPlus />}
        onClick={() => onChange(value + 1)}
      />
    </div>
  );
}

function Choices({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="w-full">
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
