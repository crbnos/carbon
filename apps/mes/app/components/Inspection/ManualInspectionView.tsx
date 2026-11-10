// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import type { InspectionParameter, JSONContent } from "@carbon/react";
import {
  Badge,
  Button,
  Checkbox,
  cn,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Textarea,
  useDisclosure,
  useViewport,
  VStack
} from "@carbon/react";
import { formatSpecLabel } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuCheck, LuScan, LuX } from "react-icons/lu";
import { useSearchParams } from "react-router";
import { useQueueTitles } from "~/components/AppSidebar";
import { MesAppBar } from "~/components/MesAppBar";
import { useMesBottomBar } from "~/components/MesBottomBar";
import type {
  InspectionGauge,
  InspectionMeasurement,
  InspectionSample,
  InspectionSamplingPlan,
  InspectionTrackedEntity
} from "~/services/types";
import { OriginInput, readOrigin, useOrigin } from "~/utils/origin";
import { path } from "~/utils/path";
import {
  InspectionLotBody,
  InspectionLotHeader,
  InspectionLotMetaBar
} from "./InspectionLotLayout";
import ScanInspectionSample from "./ScanInspectionSample";
import type { DrawingBalloonRow, InspectionLot } from "./useInspectionLotState";
import { useInspectionLotState } from "./useInspectionLotState";

type ManualInspectionViewProps = {
  inspection: InspectionLot;
  samples: InspectionSample[];
  features: InspectionSamplingPlan[];
  measurements: InspectionMeasurement[];
  gauges: InspectionGauge[];
  recentGaugeIds: string[];
  // The tracked entities the lot covers: the only units a sample may be.
  lotEntities: InspectionTrackedEntity[];
  // A voided receipt closes its lot: the stock it inspects was never received.
  receiptVoided?: boolean;
  workCenterName: string | null;
  balloons: DrawingBalloonRow[];
  documentName: string | null;
  parameters: InspectionParameter[];
  workInstruction: JSONContent | null;
  pdfUrl: string | null;
  model: { modelUploadId: string; modelPath: string | null } | null;
};

/**
 * Shop-floor execution of a receipt or manual inspection: the same matrix,
 * drawing and scanner as a job-operation lot, without the operation around it
 * (no timer, no completions, no scrap or rework). The verdict only moves the
 * lot's tracked entities, so the header has Accept and Reject and nothing
 * else.
 */
export function ManualInspectionView({
  inspection,
  samples,
  features,
  measurements,
  gauges,
  recentGaugeIds,
  lotEntities,
  receiptVoided = false,
  workCenterName,
  balloons,
  documentName,
  parameters,
  workInstruction,
  pdfUrl,
  model
}: ManualInspectionViewProps) {
  const bottomBarRef = useMesBottomBar();
  const { t } = useLingui();
  const { isPhone } = useViewport();
  const titles = useQueueTitles();

  // Back returns to the page the lot was opened from, else the Inspections
  // queue (not Schedule, the default of an operation).
  const [searchParams] = useSearchParams();
  const origin = useOrigin();
  const back = readOrigin(searchParams)
    ? origin
    : { to: path.to.inspections, label: titles.inspections };

  const isSerial = inspection.item?.itemTrackingType === "Serial";

  const isLocked =
    receiptVoided ||
    inspection.status === "Passed" ||
    inspection.status === "Failed" ||
    inspection.status === "Partial" ||
    inspection.status === "Cancelled";

  const lot = useInspectionLotState({
    inspection,
    samples,
    features,
    measurements,
    balloons,
    lotEntities,
    pdfUrl,
    model,
    isLocked
  });
  const {
    liveFeatures,
    hasFeatures,
    effectiveMeasurements,
    passes,
    fails,
    inspected,
    remaining,
    canAccept,
    canReject,
    failedStatistically
  } = lot;

  const rejectDisclosure = useDisclosure();
  const acceptDisclosure = useDisclosure();

  // A manual lot's picked serials are its samples from the start. A serial
  // receipt lot that samples some of its units scans them in; one that
  // inspects them all was prefilled by the loader.
  const isReceipt = inspection.sourceDocument === "Receipt";
  const scannerDisclosure = useDisclosure();
  const canAddSample =
    isReceipt && isSerial && !isLocked && lot.hasSampleableUnit;
  // A fresh serial receipt lot opens the scanner, so the first scan is one
  // tap away.
  const hasAutoOpenedScanRef = useRef(false);
  useEffect(() => {
    if (hasAutoOpenedScanRef.current) return;
    if (canAddSample && samples.length === 0) {
      hasAutoOpenedScanRef.current = true;
      scannerDisclosure.onOpen();
    }
  }, [canAddSample, samples.length, scannerDisclosure]);

  const failedFeatureLabels = useMemo(() => {
    if (!hasFeatures) return [];
    return liveFeatures
      .filter((lotFeature) =>
        [...effectiveMeasurements.values()].some(
          (m) =>
            m.featureId === lotFeature.inspectionFeatureId &&
            m.status === "Failed"
        )
      )
      .map(
        (lotFeature) =>
          `${lotFeature.inspectionFeature!.label} (${formatSpecLabel(lotFeature.inspectionFeature!)})`
      );
  }, [hasFeatures, liveFeatures, effectiveMeasurements]);

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
      {/* ── HEADER ── */}
      <MesAppBar
        title={inspection.inspectionId}
        subtitle={back.label}
        back={{ to: back.to }}
        actions={
          canAddSample ? (
            <IconButton
              aria-label={t`Add Sample`}
              variant="ghost"
              size="lg"
              icon={<LuScan />}
              onClick={scannerDisclosure.onOpen}
            />
          ) : null
        }
      />
      <InspectionLotHeader
        inspection={inspection}
        lot={lot}
        itemLabel={inspection.itemReadableId ?? inspection.item?.readableId}
        detail={workCenterName}
      >
        {canAddSample ? (
          <button
            type="button"
            onClick={scannerDisclosure.onOpen}
            className={cn(
              "flex h-full shrink-0 items-center gap-1 border-l border-border px-2 text-sm font-medium transition-colors hover:bg-accent active:scale-[0.98] md:gap-2 md:px-4",
              samples.length < inspection.sampleSize && "text-primary"
            )}
          >
            <LuScan className="size-4" />
            <span className="hidden lg:inline">
              <Trans>Add Sample</Trans>
            </span>
          </button>
        ) : null}

        <button
          title={t`Reject`}
          aria-label={t`Reject`}
          type="button"
          onClick={rejectDisclosure.onOpen}
          disabled={!canReject}
          className="flex h-full shrink-0 items-center gap-1 border-l border-border px-2 text-sm font-medium text-red-600 transition-colors hover:bg-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400 md:gap-2 md:px-4"
        >
          <LuX className="size-4" />
          <span className="hidden lg:inline">
            <Trans>Reject</Trans>
          </span>
        </button>
        <button
          title={t`Accept`}
          aria-label={t`Accept`}
          type="button"
          onClick={acceptDisclosure.onOpen}
          disabled={!canAccept}
          className="flex h-full shrink-0 items-center gap-1 border-l border-border px-2 text-sm font-medium text-emerald-600 transition-colors hover:bg-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400 md:gap-2 md:px-4"
        >
          <LuCheck className="size-4" />
          <span className="hidden lg:inline">
            <Trans>Accept</Trans>
          </span>
        </button>
      </InspectionLotHeader>

      <InspectionLotBody
        inspection={inspection}
        lot={lot}
        isSerial={isSerial}
        features={features}
        samples={samples}
        measurements={measurements}
        gauges={gauges}
        recentGaugeIds={recentGaugeIds}
        parameters={parameters}
        workInstruction={workInstruction}
        pdfUrl={pdfUrl}
        model={model}
        metaBar={
          <InspectionLotMetaBar
            inspection={inspection}
            lot={lot}
            documentName={documentName}
            badges={
              receiptVoided ? (
                <Badge variant="red" className="shrink-0">
                  <Trans>Receipt voided</Trans>
                </Badge>
              ) : null
            }
          >
            {inspection.notes ? (
              <span className="truncate text-xs text-muted-foreground max-md:max-w-full">
                {inspection.notes}
              </span>
            ) : null}
          </InspectionLotMetaBar>
        }
      />

      {/* Phones: the verdict as labelled 48px buttons in thumb reach. */}
      {isPhone && (
        <div
          ref={bottomBarRef}
          data-mes-bottom-bar
          className="flex shrink-0 gap-2 border-t border-border bg-card px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden [&>button]:min-w-0 [&>button]:flex-1"
        >
          <Button
            size="lg"
            variant="secondary"
            leftIcon={<LuX />}
            isDisabled={!canReject}
            onClick={rejectDisclosure.onOpen}
            className="h-12 text-red-600 dark:text-red-400"
          >
            <span className="truncate">
              <Trans>Reject</Trans>
            </span>
          </Button>
          <Button
            size="lg"
            leftIcon={<LuCheck />}
            isDisabled={!canAccept}
            onClick={acceptDisclosure.onOpen}
            className="h-12"
          >
            <span className="truncate">
              <Trans>Accept</Trans>
            </span>
          </Button>
        </div>
      )}

      {/* ── MODALS ── */}
      <VerdictModal
        open={acceptDisclosure.isOpen}
        decision="Accept"
        inspectionId={inspection.id}
        onClose={acceptDisclosure.onClose}
        description={
          fails > 0
            ? t`The inspection will be marked Passed. Its units are released to Available, except the ${fails} that failed a sample, which stay Rejected.`
            : t`The inspection will be marked Passed and its units released to Available.`
        }
      />

      <VerdictModal
        open={rejectDisclosure.isOpen}
        decision="Reject"
        inspectionId={inspection.id}
        onClose={rejectDisclosure.onClose}
        requireReason={!failedStatistically}
        failedFeatureLabels={failedFeatureLabels}
        description={
          failedStatistically
            ? t`The inspection failed: ${passes} sample(s) passed and ${fails} failed. All ${inspection.lotSize} unit(s) will be Rejected.`
            : t`Nothing has failed yet, so say why the units are rejected. All ${inspection.lotSize} unit(s) will be Rejected.`
        }
      />

      <ScanInspectionSample
        open={scannerDisclosure.isOpen}
        inspectionId={inspection.id}
        isSerial={isSerial}
        remaining={remaining}
        inspected={inspected}
        sampleSize={inspection.sampleSize}
        fails={fails}
        acceptanceNumber={inspection.acceptanceNumber}
        onClose={scannerDisclosure.onClose}
      />
    </div>
  );
}

type VerdictModalProps = {
  decision: "Accept" | "Reject";
  inspectionId: string;
  description: string;
  requireReason?: boolean;
  failedFeatureLabels?: string[];
  onClose: () => void;
};

function VerdictModal({
  open,
  onClose,
  ...props
}: VerdictModalProps & { open: boolean }) {
  return (
    <Modal
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        {/* The reason and the NCR choice start fresh on each open. */}
        <VerdictBody {...props} onClose={onClose} />
      </ModalContent>
    </Modal>
  );
}

function VerdictBody({
  decision,
  inspectionId,
  description,
  requireReason = false,
  failedFeatureLabels = [],
  onClose
}: VerdictModalProps) {
  const { t } = useLingui();
  const [reason, setReason] = useState("");
  // As the ERP's Reject Lot: an NCR for MRB disposition unless turned off.
  const [createNcr, setCreateNcr] = useState(true);
  const fetcher = useAction<{}>({});
  const busy = fetcher.state !== "idle";
  const missingReason = requireReason && reason.trim().length === 0;

  return (
    <fetcher.Form
      method="post"
      action={path.to.inspectionVerdict(inspectionId)}
    >
      <ModalHeader>
        <ModalTitle>
          {decision === "Accept"
            ? t`Accept inspection?`
            : t`Reject inspection?`}
        </ModalTitle>
      </ModalHeader>
      <ModalBody>
        <VStack spacing={3}>
          <p className="text-sm text-muted-foreground">{description}</p>
          {failedFeatureLabels.length > 0 ? (
            <VStack spacing={1}>
              <span className="text-xs font-medium">
                <Trans>Failed characteristics</Trans>
              </span>
              {failedFeatureLabels.map((label) => (
                <span key={label} className="text-xs text-muted-foreground">
                  {label}
                </span>
              ))}
            </VStack>
          ) : null}
          {decision === "Reject" ? (
            <Textarea
              name="reason"
              aria-label={t`Reason`}
              placeholder={
                requireReason ? t`Reason (required)` : t`Reason (optional)`
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          ) : null}
          {decision === "Reject" ? (
            <label className="flex w-full cursor-pointer items-center gap-2">
              <Checkbox
                isChecked={createNcr}
                onCheckedChange={(checked) => setCreateNcr(!!checked)}
              />
              <span className="text-sm font-medium">
                <Trans>Open an NCR for MRB disposition</Trans>
              </span>
              {createNcr ? (
                <input type="hidden" name="createNcr" value="on" />
              ) : null}
            </label>
          ) : null}
        </VStack>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
        <input type="hidden" name="decision" value={decision} />
        <OriginInput />
        <Button
          type="submit"
          variant={decision === "Reject" ? "destructive" : "primary"}
          isLoading={busy}
          isDisabled={busy || missingReason}
        >
          {decision === "Accept" ? (
            <Trans>Accept</Trans>
          ) : (
            <Trans>Reject</Trans>
          )}
        </Button>
      </ModalFooter>
    </fetcher.Form>
  );
}
