import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  BarProgress,
  Button,
  ClientOnly,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";
import {
  LuCircleCheck,
  LuCircleX,
  LuFileText,
  LuScan,
  LuShieldAlert,
  LuTriangleAlert
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { EmployeeAvatar } from "~/components";
import { Confirm } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import type {
  InboundInspectionFeature,
  InboundInspectionMeasurement,
  InboundInspectionRow,
  InboundInspectionSample,
  InspectionTrackedEntity,
  IssueTypeListItem
} from "~/modules/quality/types";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";
import { getReadableIdWithRevision } from "~/utils/string";
import type { DrawingBalloon } from "./InspectionDrawingPane";
import type { MeasurementSaveResult } from "./InspectionMeasurementGrid";
import InspectionMeasurementGrid from "./InspectionMeasurementGrid";
import type { FailedFeatureSummary } from "./RejectLotModal";
import RejectLotModal from "./RejectLotModal";
import ScanInspectionSample from "./ScanInspectionSample";

const InspectionDrawingPane = lazy(() => import("./InspectionDrawingPane"));

export type InboundInspectionViewProps = {
  inspection: InboundInspectionRow;
  receiptReadableId: string | null;
  receiverId: string | null;
  itemName: string;
  itemTrackingType: string | null;
  supplierName: string | null;
  samples: InboundInspectionSample[];
  features: InboundInspectionFeature[];
  measurements: InboundInspectionMeasurement[];
  balloons: {
    id: string;
    inspectionFeatureId: string;
    pageNumber: number;
    xCoordinate: number;
    yCoordinate: number;
  }[];
  documentName: string | null;
  pdfUrl: string | null;
  lotEntities: InspectionTrackedEntity[];
  issueTypes: IssueTypeListItem[];
  currentUserId: string;
  enforceFourEyes: boolean;
};

// Full-screen inbound inspection execution view. Document-driven lots show the
// ballooned drawing beside the features x samples measurement grid; lots with
// no assigned document keep the manual pass/fail sample flow. Reusable as a
// data-prop component (AssemblyView pattern) so MES can consume it later.
const InboundInspectionView = ({
  inspection,
  receiptReadableId,
  receiverId,
  itemName,
  itemTrackingType,
  supplierName,
  samples,
  features,
  measurements,
  balloons,
  documentName,
  pdfUrl,
  lotEntities,
  issueTypes,
  currentUserId,
  enforceFourEyes
}: InboundInspectionViewProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "quality");
  const [items] = useItems();

  const isSerial = itemTrackingType === "Serial";
  const liveFeatures = useMemo(
    () => features.filter((f) => f.inspectionFeature != null),
    [features]
  );
  const hasDocument = pdfUrl != null && liveFeatures.length > 0;

  const scannerDisclosure = useDisclosure();
  const rejectConfirmDisclosure = useDisclosure();
  const acceptConfirmDisclosure = useDisclosure();
  const partialConfirmDisclosure = useDisclosure();
  const documentSwitchDisclosure = useDisclosure();

  const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null);

  // Per-cell saves are quiet (no revalidation), so measurement + derived
  // sample statuses are mirrored locally from the save responses and merged
  // with the loader data for gating.
  const [measurementOverrides, setMeasurementOverrides] = useState<
    Record<string, "Pending" | "Passed" | "Failed">
  >({});
  const [sampleStatusOverrides, setSampleStatusOverrides] = useState<
    Record<string, "Pending" | "Passed" | "Failed">
  >({});
  const [measurementValueOverrides, setMeasurementValueOverrides] = useState<
    Record<string, number | null>
  >({});
  const onMeasurementSaved = useCallback((result: MeasurementSaveResult) => {
    const key = `${result.sampleId}:${result.inspectionFeatureId}`;
    setMeasurementOverrides((prev) => ({
      ...prev,
      [key]: result.measurementStatus
    }));
    setMeasurementValueOverrides((prev) => ({ ...prev, [key]: result.value }));
    setSampleStatusOverrides((prev) => ({
      ...prev,
      [result.sampleId]: result.sampleStatus
    }));
  }, []);

  // Effective measurement statuses: loader data + local overrides (new cells
  // exist only in overrides).
  const effectiveMeasurements = useMemo(() => {
    const byKey = new Map<
      string,
      { featureId: string; status: string; value: number | null }
    >();
    for (const m of measurements) {
      byKey.set(`${m.inboundInspectionSampleId}:${m.inspectionFeatureId}`, {
        featureId: m.inspectionFeatureId,
        status: m.status,
        value: m.value == null ? null : Number(m.value)
      });
    }
    for (const [key, status] of Object.entries(measurementOverrides)) {
      const featureId = key.split(":")[1] ?? "";
      byKey.set(key, {
        featureId,
        status,
        value: measurementValueOverrides[key] ?? null
      });
    }
    return byKey;
  }, [measurements, measurementOverrides, measurementValueOverrides]);

  const featureCounts = useMemo(() => {
    const counts = new Map<string, { recorded: number; failed: number }>();
    for (const feature of liveFeatures) {
      counts.set(feature.inspectionFeatureId, { recorded: 0, failed: 0 });
    }
    for (const measurement of effectiveMeasurements.values()) {
      const entry = counts.get(measurement.featureId);
      if (!entry) continue;
      if (measurement.status !== "Pending") entry.recorded += 1;
      if (measurement.status === "Failed") entry.failed += 1;
    }
    return counts;
  }, [liveFeatures, effectiveMeasurements]);

  // Effective sample statuses: loader samples + derived-status overrides +
  // anonymous samples created during this session (only in overrides).
  const sampleStatuses = useMemo(() => {
    const statuses = new Map<string, string>();
    for (const sample of samples) {
      statuses.set(sample.id, sample.status);
    }
    for (const [sampleId, status] of Object.entries(sampleStatusOverrides)) {
      statuses.set(sampleId, status);
    }
    return statuses;
  }, [samples, sampleStatusOverrides]);

  const passes = [...sampleStatuses.values()].filter(
    (s) => s === "Passed"
  ).length;
  const fails = [...sampleStatuses.values()].filter(
    (s) => s === "Failed"
  ).length;
  const inspected = passes + fails;

  const sampledIds = useMemo(
    () => new Set(samples.map((s) => s.trackedEntityId)),
    [samples]
  );
  const remaining = lotEntities.filter((e) => !sampledIds.has(e.id));

  // Item display id from the live items store (snapshot may be stale).
  const item = items.find((i) => i.id === inspection.itemId);
  const [storeReadableId, storeRevision] = (() => {
    const combined = (item as any)?.readableIdWithRevision as
      | string
      | undefined;
    if (!combined) return [undefined, undefined] as const;
    const dot = combined.lastIndexOf(".");
    if (dot < 0) return [combined, undefined] as const;
    return [combined.slice(0, dot), combined.slice(dot + 1)] as const;
  })();
  const displayReadableId =
    storeReadableId != null
      ? getReadableIdWithRevision(storeReadableId, storeRevision)
      : (inspection.itemReadableId ?? "");
  const displayItemName = item?.name ?? itemName;

  const showFourEyesWarning =
    enforceFourEyes && !!receiverId && receiverId === currentUserId;

  const lotClosed =
    inspection.dispositionedAt != null &&
    (inspection.status === "Passed" || inspection.status === "Failed");

  const maxSampleSize = hasDocument
    ? Math.max(1, ...liveFeatures.map((f) => f.sampleSize))
    : inspection.sampleSize;

  // Gating. Document-driven lots gate per characteristic (mirrors the
  // server-side disposition guards); fallback lots keep the lot-level rules.
  let canAccept: boolean;
  let canReject: boolean;
  let canPartial: boolean;
  if (hasDocument) {
    const allFeaturesSatisfied = liveFeatures.every((feature) => {
      const counts = featureCounts.get(feature.inspectionFeatureId) ?? {
        recorded: 0,
        failed: 0
      };
      return (
        counts.recorded >= feature.sampleSize &&
        counts.failed <= feature.acceptanceNumber
      );
    });
    const anyFeatureRejectable = liveFeatures.some((feature) => {
      const counts = featureCounts.get(feature.inspectionFeatureId);
      return counts != null && counts.failed >= feature.rejectionNumber;
    });
    const anyRecorded = [...effectiveMeasurements.values()].some(
      (m) => m.status !== "Pending"
    );
    canAccept = !lotClosed && allFeaturesSatisfied;
    canReject = !lotClosed && (anyFeatureRejectable || fails > 0);
    canPartial = !lotClosed && anyRecorded;
  } else {
    canAccept =
      !lotClosed &&
      inspected >= inspection.sampleSize &&
      fails <= inspection.acceptanceNumber;
    canReject = !lotClosed && fails > inspection.acceptanceNumber;
    canPartial = !lotClosed && inspected > 0;
  }

  const failedFeatureSummary = useMemo<FailedFeatureSummary[]>(() => {
    if (!hasDocument) return [];
    return liveFeatures
      .map((lotFeature) => {
        const feature = lotFeature.inspectionFeature!;
        const failedValues: string[] = [];
        for (const [key, m] of effectiveMeasurements.entries()) {
          if (m.featureId !== feature.id || m.status !== "Failed") continue;
          failedValues.push(m.value == null ? "F" : String(m.value));
          void key;
        }
        if (failedValues.length === 0) return null;
        const spec = [
          feature.nominalValue,
          feature.tolerancePlus != null || feature.toleranceMinus != null
            ? `+${feature.tolerancePlus ?? "0"}/−${feature.toleranceMinus ?? "0"}`
            : null,
          feature.unit
        ]
          .filter(Boolean)
          .join(" ");
        return { label: feature.label, spec, failedValues };
      })
      .filter(Boolean) as FailedFeatureSummary[];
  }, [hasDocument, liveFeatures, effectiveMeasurements]);

  const failedTrackedEntityIds = samples
    .filter((s) => (sampleStatuses.get(s.id) ?? s.status) === "Failed")
    .map((s) => s.trackedEntityId)
    .filter(Boolean) as string[];

  const newIssueHref = `/x/issue/new?itemId=${encodeURIComponent(inspection.itemId)}&trackedEntityIds=${encodeURIComponent(failedTrackedEntityIds.join(","))}&sourceInspectionId=${encodeURIComponent(inspection.id)}`;

  const drawingBalloons = useMemo<DrawingBalloon[]>(() => {
    const labelByFeatureId = new Map(
      liveFeatures.map((f) => [
        f.inspectionFeatureId,
        f.inspectionFeature!.label
      ])
    );
    return balloons
      .filter((b) => labelByFeatureId.has(b.inspectionFeatureId))
      .map((b) => ({
        id: b.id,
        inspectionFeatureId: b.inspectionFeatureId,
        pageNumber: b.pageNumber,
        xCoordinate: b.xCoordinate,
        yCoordinate: b.yCoordinate,
        label: labelByFeatureId.get(b.inspectionFeatureId) ?? ""
      }));
  }, [balloons, liveFeatures]);

  const hasMeasurements = effectiveMeasurements.size > 0;

  const statusBadgeVariant =
    inspection.status === "Passed"
      ? ("green" as const)
      : inspection.status === "Failed"
        ? ("red" as const)
        : ("secondary" as const);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0 border-b border-border bg-card px-4 py-3">
        <HStack className="w-full items-start justify-between">
          <VStack spacing={0}>
            <HStack spacing={2} className="items-center">
              <h1 className="text-base font-semibold">
                {inspection.inboundInspectionId}
              </h1>
              <Badge variant={statusBadgeVariant}>{inspection.status}</Badge>
            </HStack>
            <span className="text-sm text-muted-foreground">
              {displayReadableId} · {displayItemName}
            </span>
          </VStack>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm md:grid-cols-4">
            <Kv
              label={t`Receipt`}
              value={receiptReadableId ?? ""}
              sub={supplierName ?? undefined}
            />
            <Kv
              label={t`Plan`}
              value={
                inspection.samplingPlanType === "AQL"
                  ? `AQL ${inspection.aql ?? ""} · Lvl ${inspection.inspectionLevel ?? ""} · ${inspection.severity ?? ""}`
                  : inspection.samplingPlanType
              }
              sub={
                inspection.samplingStandard === "ANSI_Z1_4"
                  ? "ANSI/ASQ Z1.4"
                  : "ISO 2859-1"
              }
            />
            <Kv
              label={t`Sample`}
              value={`${inspected} / ${inspection.sampleSize}`}
              sub={`Ac ${inspection.acceptanceNumber} · Re ${inspection.rejectionNumber}${inspection.codeLetter ? ` · ${inspection.codeLetter}` : ""}`}
            />
            <Kv
              label={t`Document`}
              value={documentName ?? t`None`}
              sub={
                canUpdate && !lotClosed && !hasMeasurements
                  ? undefined
                  : undefined
              }
              action={
                canUpdate && !lotClosed && !hasMeasurements ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1 text-xs"
                    leftIcon={<LuFileText />}
                    onClick={documentSwitchDisclosure.onOpen}
                  >
                    <Trans>Change</Trans>
                  </Button>
                ) : undefined
              }
            />
          </div>
        </HStack>
        {showFourEyesWarning && (
          <Alert variant="warning" className="mt-3">
            <LuTriangleAlert className="size-4" />
            <AlertTitle>
              <Trans>You received this lot</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans>
                Company policy asks for a different person to inspect inbound
                items than the one who received them.
              </Trans>
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* ── Body ── */}
      {hasDocument ? (
        <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize={45} minSize={25}>
            <ClientOnly
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Spinner />
                </div>
              }
            >
              {() => (
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center">
                      <Spinner />
                    </div>
                  }
                >
                  <InspectionDrawingPane
                    pdfUrl={pdfUrl!}
                    balloons={drawingBalloons}
                    activeFeatureId={activeFeatureId}
                    onBalloonClick={setActiveFeatureId}
                  />
                </Suspense>
              )}
            </ClientOnly>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={55} minSize={30}>
            <div className="flex h-full min-h-0 flex-col overflow-auto p-2">
              <InspectionMeasurementGrid
                inspectionId={inspection.id}
                isReadOnly={!canUpdate || lotClosed}
                isSerial={isSerial}
                features={features}
                samples={samples}
                measurements={measurements}
                maxSampleSize={maxSampleSize}
                activeFeatureId={activeFeatureId}
                onActiveFeatureChange={setActiveFeatureId}
                onAddSample={scannerDisclosure.onOpen}
                onMeasurementSaved={onMeasurementSaved}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <VStack spacing={4} className="mx-auto w-full max-w-4xl">
            <BarProgress
              label={t`Progress`}
              value={`${inspected} / ${inspection.sampleSize} · ${fails} ${fails === 1 ? "failure" : "failures"} · Ac ${inspection.acceptanceNumber}`}
              progress={inspected}
              max={Math.max(1, inspection.sampleSize)}
              activeClassName={
                fails > inspection.acceptanceNumber
                  ? "bg-red-500"
                  : "bg-emerald-500"
              }
            />

            {!lotClosed && canUpdate && (
              <Button
                leftIcon={<LuScan />}
                onClick={scannerDisclosure.onOpen}
                className="self-start"
              >
                <Trans>Inspect Next Item</Trans>
              </Button>
            )}

            <div className="w-full overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">
                      <Trans>Entity</Trans>
                    </th>
                    <th className="px-3 py-2 text-left font-medium">
                      <Trans>Result</Trans>
                    </th>
                    <th className="px-3 py-2 text-left font-medium">
                      <Trans>Inspector</Trans>
                    </th>
                    <th className="px-3 py-2 text-left font-medium">
                      <Trans>Notes</Trans>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {samples.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-6 text-center text-muted-foreground"
                      >
                        <Trans>No samples inspected yet.</Trans>
                      </td>
                    </tr>
                  )}
                  {samples.map((s, idx) => {
                    const readable = s.trackedEntity?.readableId ?? null;
                    return (
                      <tr key={s.id} className="border-t">
                        <td className="px-3 py-2">
                          <div className="flex flex-col">
                            <span className="font-mono text-sm">
                              {readable ??
                                s.trackedEntityId ??
                                t`Sample ${idx + 1}`}
                            </span>
                            {readable && (
                              <span className="text-xs text-muted-foreground">
                                {s.trackedEntityId}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {s.status === "Passed" ? (
                            <Badge variant="green">
                              <LuCircleCheck className="mr-1 size-3" /> Passed
                            </Badge>
                          ) : s.status === "Failed" ? (
                            <Badge variant="red">
                              <LuCircleX className="mr-1 size-3" /> Failed
                            </Badge>
                          ) : (
                            <Badge variant="secondary">{s.status}</Badge>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {s.inspectedBy ? (
                            <EmployeeAvatar employeeId={s.inspectedBy} />
                          ) : (
                            ""
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {s.notes ?? ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </VStack>
        </div>
      )}

      {/* ── Footer ── */}
      <div className="shrink-0 border-t border-border bg-card px-4 py-3">
        <HStack spacing={2} className="w-full justify-between">
          <Button
            variant="secondary"
            leftIcon={<LuShieldAlert />}
            asChild
            isDisabled={failedTrackedEntityIds.length === 0}
          >
            <a href={newIssueHref} target="_blank" rel="noreferrer">
              <Trans>Create Issue from Inspection</Trans>
            </a>
          </Button>
          <HStack spacing={2}>
            <Button
              variant="secondary"
              onClick={partialConfirmDisclosure.onOpen}
              isDisabled={!canUpdate || !canPartial}
            >
              <Trans>Partial</Trans>
            </Button>
            <Button
              variant="destructive"
              onClick={rejectConfirmDisclosure.onOpen}
              isDisabled={!canUpdate || !canReject}
            >
              <Trans>Reject Lot</Trans>
            </Button>
            <Button
              onClick={acceptConfirmDisclosure.onOpen}
              isDisabled={!canUpdate || !canAccept}
            >
              <Trans>Accept Lot</Trans>
            </Button>
          </HStack>
        </HStack>
      </div>

      {scannerDisclosure.isOpen && (
        <ScanInspectionSample
          inspectionId={inspection.id}
          isSerial={isSerial}
          remaining={remaining}
          inspected={inspected}
          sampleSize={inspection.sampleSize}
          fails={fails}
          acceptanceNumber={inspection.acceptanceNumber}
          onClose={scannerDisclosure.onClose}
          mode={hasDocument ? "identify" : "record"}
        />
      )}

      {acceptConfirmDisclosure.isOpen && (
        <Confirm
          action={path.to.inboundInspectionAccept(inspection.id)}
          title={t`Accept lot?`}
          text={
            isSerial
              ? t`${lotEntities.length - inspected} un-sampled entities will be released to Available. Sampled passes stay Available and sampled failures stay Rejected.`
              : t`The lot will be marked Passed. ${fails} sampled failure(s) are recorded for your records.`
          }
          confirmText={t`Accept Lot`}
          onCancel={acceptConfirmDisclosure.onClose}
          onSubmit={acceptConfirmDisclosure.onClose}
        />
      )}

      {partialConfirmDisclosure.isOpen && (
        <Confirm
          action={path.to.inboundInspectionPartial(inspection.id)}
          title={t`Mark lot as partial?`}
          text={
            isSerial
              ? t`Un-sampled entities will remain On Hold so you can keep inspecting and disposition later. Sampled outcomes are preserved.`
              : t`The lot stays open so you can keep inspecting and disposition later. Sampled outcomes are preserved.`
          }
          confirmText={t`Mark Partial`}
          onCancel={partialConfirmDisclosure.onClose}
          onSubmit={partialConfirmDisclosure.onClose}
        />
      )}

      {rejectConfirmDisclosure.isOpen && (
        <RejectLotModal
          action={path.to.inboundInspectionReject(inspection.id)}
          issueTypes={issueTypes}
          summary={
            isSerial
              ? t`Statistical acceptance failed, so the entire lot is considered non-conforming (ISO 9001:2015 §8.7). All ${lotEntities.length} entities — ${passes} sampled pass(es), ${fails} failure(s), and ${Math.max(0, lotEntities.length - inspected)} un-inspected — will be marked Rejected.`
              : t`Statistical acceptance failed, so the entire lot of ${inspection.lotSize} is considered non-conforming (ISO 9001:2015 §8.7) — ${passes} sampled pass(es) and ${fails} failure(s).`
          }
          failedFeatureSummary={failedFeatureSummary}
          onCancel={rejectConfirmDisclosure.onClose}
          onSubmit={rejectConfirmDisclosure.onClose}
        />
      )}

      {documentSwitchDisclosure.isOpen && (
        <DocumentSwitchModal
          inspectionId={inspection.id}
          itemId={inspection.itemId}
          currentDocumentId={inspection.inspectionDocumentId ?? null}
          onClose={documentSwitchDisclosure.onClose}
        />
      )}
    </div>
  );
};

// Swap the assigned inspection document on an open, unmeasured lot. Options
// are the item's documents (same source as the Form/InspectionDocument
// combobox's api route).
function DocumentSwitchModal({
  inspectionId,
  itemId,
  currentDocumentId,
  onClose
}: {
  inspectionId: string;
  itemId: string;
  currentDocumentId: string | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();
  const optionsFetcher = useFetcher<{
    data:
      | {
          id: string;
          fileName: string | null;
          drawingNumber: string | null;
          version: number;
        }[]
      | null;
  }>();
  const [documentId, setDocumentId] = useState(currentDocumentId ?? "none");

  useEffect(() => {
    if (optionsFetcher.state === "idle" && optionsFetcher.data == null) {
      optionsFetcher.load(path.to.api.inspectionDocuments(itemId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const options = optionsFetcher.data?.data ?? [];

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
            <Trans>Change Inspection Document</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={2}>
            <p className="text-sm text-muted-foreground">
              <Trans>
                The lot's per-characteristic sampling plan will be re-resolved
                from the selected document.
              </Trans>
            </p>
            <Select value={documentId} onValueChange={setDocumentId}>
              <SelectTrigger>
                <SelectValue placeholder={t`Select a document`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t`None`}</SelectItem>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {(option.drawingNumber ?? option.fileName ?? option.id) +
                      ` v${option.version}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <fetcher.Form
            method="post"
            action={path.to.inboundInspectionDocument(inspectionId)}
            onSubmit={onClose}
          >
            <input
              type="hidden"
              name="inspectionDocumentId"
              value={documentId === "none" ? "" : documentId}
            />
            <Button type="submit" isLoading={fetcher.state !== "idle"}>
              <Trans>Save</Trans>
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function Kv({
  label,
  value,
  sub,
  action
}: {
  label: string;
  value: string;
  sub?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0">
      <HStack spacing={1} className="items-center">
        <span className="text-xs text-muted-foreground">{label}</span>
        {action}
      </HStack>
      <span className="truncate text-sm font-medium">{value || "—"}</span>
      {sub && (
        <span className="truncate text-xs text-muted-foreground">{sub}</span>
      )}
    </div>
  );
}

export default InboundInspectionView;
