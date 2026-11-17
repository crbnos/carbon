// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Hidden, NumberControlled, ValidatedForm } from "@carbon/form";
import { useAction, useLoaderQuery } from "@carbon/query";
import {
  Button,
  cn,
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
import { LuHand, LuPersonStanding } from "react-icons/lu";
import type { loader } from "~/routes/x+/material+/$materialId.scrap-part";
import { scrapJobPartValidator } from "~/services/models";
import type { JobMaterial } from "~/services/types";
import { path } from "~/utils/path";
import { useScrapReasons } from "./ScrapReason";

type Replacement = "Shelf" | "Water Spider";

// The operator's last choices, so the next scrap is one tap shorter. Browser
// storage can be missing or throw: the dialog works without it.
const LAST_REASON = "mes.scrapPart.reason";
const LAST_REPLACEMENT = "mes.scrapPart.replacement";
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

/**
 * Scrap parts of a material, or parts inside a kit, and replace them from the
 * shelf: pick the part, the quantity, the reason and who fetches the
 * replacement. Mount it per open, so each open is one idempotency key.
 */
export function ScrapPartModal({
  material,
  operationId,
  onClose
}: {
  material: JobMaterial;
  operationId: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const parts = useLoaderQuery<typeof loader>(path.to.scrapPart(material.id!));
  const reasons = useScrapReasons();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [pickedItemId, setPickedItemId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [pickedReasonId, setPickedReasonId] = useState(() =>
    remembered(LAST_REASON)
  );
  const [replacement, setReplacement] = useState<Replacement>(() =>
    remembered(LAST_REPLACEMENT) === "Water Spider" ? "Water Spider" : "Shelf"
  );

  const partList = parts.data?.parts ?? [];
  // One part needs no pick; a remembered reason that no longer exists is dropped.
  const itemId =
    pickedItemId ?? (partList.length === 1 ? partList[0].itemId : null);
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
          action={path.to.scrapPart(material.id!)}
          method="post"
          validator={scrapJobPartValidator}
          fetcher={action}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Scrap parts</Trans>
            </ModalTitle>
            <ModalDescription>
              {material.description ?? material.itemReadableId}
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="jobOperationId" value={operationId} />
            <Hidden name="idempotencyKey" value={idempotencyKey} />
            <Hidden name="itemId" value={itemId ?? ""} />
            <Hidden name="scrapReasonId" value={reasonId ?? ""} />
            <Hidden name="replacement" value={replacement} />
            <VStack spacing={4}>
              <Section label={t`Part`}>
                {parts.isLoading ? (
                  <p className="text-muted-foreground">
                    <Trans>Loading parts...</Trans>
                  </p>
                ) : partList.length === 0 ? (
                  <p className="text-muted-foreground">
                    <Trans>
                      Nothing here can be scrapped by quantity. Scrap a serial
                      or batch from Issue.
                    </Trans>
                  </p>
                ) : (
                  partList.map((part) => (
                    <Tile
                      key={part.itemId}
                      selected={part.itemId === itemId}
                      onClick={() => setPickedItemId(part.itemId)}
                    >
                      <span className="max-w-full truncate font-medium">
                        {part.readableId}
                      </span>
                      <span className="max-w-full truncate text-sm text-muted-foreground">
                        {part.perKit === null
                          ? part.name
                          : t`${part.perKit} per kit · ${part.name}`}
                      </span>
                    </Tile>
                  ))
                )}
              </Section>

              <NumberControlled
                name="quantity"
                label={t`Quantity`}
                value={quantity}
                onChange={setQuantity}
                minValue={1}
                size="lg"
              />

              <Section label={t`Reason`}>
                {reasons.map((reason) => (
                  <Tile
                    key={reason.value}
                    selected={reason.value === reasonId}
                    onClick={() => setPickedReasonId(reason.value)}
                  >
                    <span className="font-medium">{reason.label}</span>
                  </Tile>
                ))}
              </Section>

              <Section label={t`Replacement`}>
                <Tile
                  selected={replacement === "Shelf"}
                  onClick={() => setReplacement("Shelf")}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <LuHand /> <Trans>I'll grab it from the shelf</Trans>
                  </span>
                </Tile>
                <Tile
                  selected={replacement === "Water Spider"}
                  onClick={() => setReplacement("Water Spider")}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <LuPersonStanding /> <Trans>Ask the water spider</Trans>
                  </span>
                </Tile>
              </Section>
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
              isDisabled={action.isPending || !itemId || !reasonId}
            >
              <Trans>Scrap {quantity}</Trans>
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
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
        "flex min-h-14 w-full min-w-0 flex-col items-start justify-center gap-0.5 rounded-lg border px-4 py-2 text-left",
        selected
          ? "border-primary bg-primary/10 ring-2 ring-primary"
          : "hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}
