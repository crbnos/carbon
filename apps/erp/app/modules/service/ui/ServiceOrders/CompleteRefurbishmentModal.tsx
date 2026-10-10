// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  cn,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  useMount
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { LuCircleAlert, LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import { useCurrencyFormatter } from "~/hooks";
import { path } from "~/utils/path";
import type { RefurbishmentCompletionPreview } from "../../service.server";

type PreviewResponse =
  | { preview: RefurbishmentCompletionPreview; error: null }
  | { preview: null; error: string };

type CompleteRefurbishmentModalProps = {
  serviceOrderId: string;
  /** The readable id, for the title. */
  readableId: string;
  onClose: () => void;
};

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="shrink-0 tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * Completes a Refurbishment after a preview of its cost: the work in
 * progress, the unit cost before and after, the sale price cap and the
 * write-down, and what the item's costing method does with the cost. The
 * preview runs the completion's own reads and planner and writes nothing;
 * Complete posts to the status route, which runs `complete-service-order`.
 */
const CompleteRefurbishmentModal = ({
  serviceOrderId,
  readableId,
  onClose
}: CompleteRefurbishmentModalProps) => {
  const { t } = useLingui();
  const previewFetcher = useFetcher<PreviewResponse>();
  const fetcher = useFetcher<{}>();
  const submitted = useRef(false);
  const formatter = useCurrencyFormatter({ rate: true });

  useMount(() => {
    previewFetcher.load(path.to.serviceOrderComplete(serviceOrderId));
  });

  useEffect(() => {
    if (fetcher.state === "idle" && submitted.current) {
      submitted.current = false;
      onClose();
    }
  }, [fetcher.state, onClose]);

  const isLoading = previewFetcher.state !== "idle" || !previewFetcher.data;
  const preview = previewFetcher.data?.preview ?? null;
  const previewError = previewFetcher.data?.error ?? null;
  const isSubmitting = fetcher.state !== "idle";

  const effect = !preview
    ? null
    : preview.abnormalRework
      ? t`Abnormal rework posts this cost to material variance. The serial keeps its cost.`
      : preview.costingMethod === "Standard"
        ? t`Standard posts this cost to material variance. The serial stays at its standard cost.`
        : preview.costingMethod === "Average"
          ? t`Average spreads this cost over every unit of the item.`
          : t`The serial gets its own cost layer and leaves stock at its new unit cost.`;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Complete {readableId}</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              The work's cost is posted as the preview shows, and the serial
              goes back to stock. A completed refurbishment cannot be reopened.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">
              <Trans>Previewing the completion…</Trans>
            </p>
          ) : previewError || !preview ? (
            <Alert variant="destructive">
              <LuCircleAlert />
              <AlertTitle>
                <Trans>This refurbishment cannot be completed</Trans>
              </AlertTitle>
              <AlertDescription>{previewError}</AlertDescription>
            </Alert>
          ) : (
            <div
              className={cn(
                "flex w-full flex-col gap-4",
                isSubmitting && "opacity-60"
              )}
            >
              <dl className="flex flex-col gap-2 rounded-lg border p-3">
                <Row label={<Trans>Work in progress</Trans>}>
                  {formatter.format(preview.wipTotal)}
                </Row>
                <Row
                  label={
                    preview.treatment === "Capitalize" &&
                    preview.costingMethod !== "Average" ? (
                      <Trans>Serial's unit cost</Trans>
                    ) : (
                      <Trans>Item's unit cost</Trans>
                    )
                  }
                >
                  {formatter.format(preview.currentUnitCost)}
                </Row>
                <Row label={<Trans>New unit cost</Trans>}>
                  {formatter.format(preview.newUnitCost)}
                </Row>
                {preview.treatment === "Capitalize" &&
                  preview.costingMethod !== "Average" && (
                    <>
                      <Row label={<Trans>Sale price cap</Trans>}>
                        {preview.cap === null
                          ? "—"
                          : formatter.format(preview.cap)}
                      </Row>
                      <Row label={<Trans>Write-down</Trans>}>
                        {formatter.format(preview.writeDown)}
                      </Row>
                    </>
                  )}
              </dl>
              <p className="text-sm text-muted-foreground">{effect}</p>
              {preview.warnings.length > 0 && (
                <Alert variant="warning">
                  <LuTriangleAlert />
                  <AlertTitle>
                    <Trans>The cost is not capped</Trans>
                  </AlertTitle>
                  <AlertDescription>
                    {preview.warnings.join(". ")}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <fetcher.Form
            method="post"
            action={path.to.serviceOrderStatus(serviceOrderId)}
            onSubmit={() => {
              submitted.current = true;
            }}
          >
            <input type="hidden" name="status" value="Completed" />
            <Button
              type="submit"
              isLoading={isSubmitting}
              isDisabled={isLoading || !preview || isSubmitting}
            >
              <Trans>Complete</Trans>
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default CompleteRefurbishmentModal;
