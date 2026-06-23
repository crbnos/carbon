import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  BarProgress,
  Button,
  Checkbox,
  HStack,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LuCircleCheck,
  LuCircleX,
  LuScan,
  LuShieldAlert,
  LuTriangleAlert
} from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { EmployeeAvatar } from "~/components";
import { Confirm } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import type {
  InboundInspectionRow,
  InboundInspectionSample,
  InspectionTrackedEntity,
  IssueTypeListItem
} from "~/modules/quality/types";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";
import { getReadableIdWithRevision } from "~/utils/string";
import ScanInspectionSample from "./ScanInspectionSample";

export type InboundInspectionLotViewProps = {
  inspection: InboundInspectionRow;
  receiptReadableId: string | null;
  receiverId: string | null;
  itemName: string;
  itemTrackingType: string | null;
  supplierName: string | null;
  samples: InboundInspectionSample[];
  lotEntities: InspectionTrackedEntity[];
  issueTypes: IssueTypeListItem[];
  currentUserId: string;
  enforceFourEyes: boolean;
  open?: boolean;
};

export default function InboundInspectionLotView({
  inspection,
  receiptReadableId,
  receiverId,
  itemName,
  itemTrackingType,
  supplierName,
  samples,
  lotEntities,
  issueTypes,
  currentUserId,
  enforceFourEyes,
  open = true
}: InboundInspectionLotViewProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "quality");
  const [items] = useItems();

  // Serial parts are inspected by scanning a discrete tracked entity. Batch /
  // inventory / non-inventory parts record pass/fail for each sampled item
  // without a tracked entity.
  const isSerial = itemTrackingType === "Serial";

  const scannerDisclosure = useDisclosure();
  const rejectConfirmDisclosure = useDisclosure();
  const acceptConfirmDisclosure = useDisclosure();
  const partialConfirmDisclosure = useDisclosure();

  // Look up the item in the live items store so we show the current
  // readable id (and revision) even if the snapshot stored on the
  // inspection row is stale.
  const item = items.find((i) => i.id === inspection.itemId);
  // The store exposes `readableIdWithRevision` pre-computed; split it so we
  // can run it through getReadableIdWithRevision for consistent formatting.
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

  const passes = samples.filter((s) => s.status === "Passed").length;
  const fails = samples.filter((s) => s.status === "Failed").length;
  const inspected = passes + fails;

  const sampledIds = useMemo(
    () => new Set(samples.map((s) => s.trackedEntityId)),
    [samples]
  );
  const remaining = lotEntities.filter((e) => !sampledIds.has(e.id));

  const showFourEyesWarning =
    enforceFourEyes && !!receiverId && receiverId === currentUserId;

  // The lot is "closed" only after the inspector has pressed Accept or Reject
  // (setting dispositionedAt + a terminal status). Partial is explicitly not
  // closed — the inspector can keep scanning and disposition again later.
  const lotClosed =
    inspection.dispositionedAt != null &&
    (inspection.status === "Passed" || inspection.status === "Failed");

  const canAccept =
    !lotClosed &&
    inspected >= inspection.sampleSize &&
    fails <= inspection.acceptanceNumber;
  const canReject = !lotClosed && fails > inspection.acceptanceNumber;
  const canPartial = !lotClosed && inspected > 0;

  const failedTrackedEntityIds = samples
    .filter((s) => s.status === "Failed")
    .map((s) => s.trackedEntityId);

  const newIssueHref = `/x/issue/new?itemId=${encodeURIComponent(inspection.itemId)}&trackedEntityIds=${encodeURIComponent(failedTrackedEntityIds.join(","))}&sourceInspectionId=${encodeURIComponent(inspection.id)}`;

  const acceptUrl = `${path.to.inboundInspection(inspection.id)}/accept`;
  const rejectUrl = `${path.to.inboundInspection(inspection.id)}/reject`;
  const partialUrl = `${path.to.inboundInspection(inspection.id)}/partial`;

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open={open}
        onOpenChange={(next) => {
          if (!next) navigate(-1);
        }}
      >
        <ModalDrawerContent size="full">
          <ModalDrawerHeader>
            <ModalDrawerTitle>
              <Trans>Inspect</Trans> {displayReadableId || displayItemName}
            </ModalDrawerTitle>
          </ModalDrawerHeader>
          <ModalDrawerBody>
            <VStack spacing={4} className="w-full">
              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full text-sm">
                <Kv
                  label={t`Item`}
                  value={displayReadableId}
                  sub={displayItemName}
                />
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
              </div>

              {showFourEyesWarning && (
                <Alert variant="warning">
                  <LuTriangleAlert className="size-4" />
                  <AlertTitle>
                    <Trans>You received this lot</Trans>
                  </AlertTitle>
                  <AlertDescription>
                    <Trans>
                      Company policy asks for a different person to inspect
                      inbound items than the one who received them.
                    </Trans>
                  </AlertDescription>
                </Alert>
              )}

              {/* Progress */}
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

              {/* Scan button */}
              {!lotClosed && canUpdate && (
                <Button
                  leftIcon={<LuScan />}
                  onClick={scannerDisclosure.onOpen}
                  className="self-start"
                >
                  <Trans>Inspect Next Item</Trans>
                </Button>
              )}

              {/* Samples */}
              <div className="w-full border rounded-md overflow-hidden">
                <table className="text-sm w-full">
                  <thead className="bg-muted text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">
                        <Trans>Entity</Trans>
                      </th>
                      <th className="text-left px-3 py-2 font-medium">
                        <Trans>Result</Trans>
                      </th>
                      <th className="text-left px-3 py-2 font-medium">
                        <Trans>Inspector</Trans>
                      </th>
                      <th className="text-left px-3 py-2 font-medium">
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
                                <LuCircleCheck className="size-3 mr-1" /> Passed
                              </Badge>
                            ) : s.status === "Failed" ? (
                              <Badge variant="red">
                                <LuCircleX className="size-3 mr-1" /> Failed
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
          </ModalDrawerBody>
          <ModalDrawerFooter>
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
          </ModalDrawerFooter>
        </ModalDrawerContent>
      </ModalDrawer>

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
        />
      )}

      {acceptConfirmDisclosure.isOpen && (
        <Confirm
          action={acceptUrl}
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
          action={partialUrl}
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
          action={rejectUrl}
          issueTypes={issueTypes}
          summary={
            isSerial
              ? t`Statistical acceptance failed, so the entire lot is considered non-conforming (ISO 9001:2015 §8.7). All ${lotEntities.length} entities — ${passes} sampled pass(es), ${fails} failure(s), and ${Math.max(0, lotEntities.length - inspected)} un-inspected — will be marked Rejected.`
              : t`Statistical acceptance failed, so the entire lot of ${inspection.lotSize} is considered non-conforming (ISO 9001:2015 §8.7) — ${passes} sampled pass(es) and ${fails} failure(s).`
          }
          onCancel={rejectConfirmDisclosure.onClose}
          onSubmit={rejectConfirmDisclosure.onClose}
        />
      )}
    </ModalDrawerProvider>
  );
}

function RejectLotModal({
  action,
  issueTypes,
  summary,
  onCancel,
  onSubmit
}: {
  action: string;
  issueTypes: IssueTypeListItem[];
  summary: string;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();
  const submitted = useRef(false);
  const [createNcr, setCreateNcr] = useState(true);
  const [issueTypeId, setIssueTypeId] = useState<string>(
    issueTypes[0]?.id ?? ""
  );

  useEffect(() => {
    if (fetcher.state === "idle" && submitted.current) {
      onSubmit();
      submitted.current = false;
    }
  }, [fetcher.state, onSubmit]);

  const hasIssueTypes = issueTypes.length > 0;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Reject Lot</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4}>
            <p className="text-sm text-muted-foreground">{summary}</p>
            <label className="flex items-center gap-2 w-full cursor-pointer">
              <Checkbox
                isChecked={createNcr}
                onCheckedChange={(checked) => setCreateNcr(!!checked)}
              />
              <span className="text-sm font-medium">
                <Trans>Open an NCR for MRB disposition</Trans>
              </span>
            </label>
            {createNcr &&
              (hasIssueTypes ? (
                <div className="flex flex-col gap-2 w-full">
                  <Label htmlFor="nonConformanceTypeId">
                    <Trans>Issue Type</Trans>
                  </Label>
                  <Select value={issueTypeId} onValueChange={setIssueTypeId}>
                    <SelectTrigger id="nonConformanceTypeId">
                      <SelectValue placeholder={t`Select an issue type`} />
                    </SelectTrigger>
                    <SelectContent>
                      {issueTypes.map((type) => (
                        <SelectItem key={type.id} value={type.id}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <Alert variant="warning">
                  <LuTriangleAlert className="size-4" />
                  <AlertTitle>
                    <Trans>No issue types configured</Trans>
                  </AlertTitle>
                  <AlertDescription>
                    <Trans>
                      The lot will still be rejected, but an NCR cannot be
                      created until at least one Issue Type is configured.
                    </Trans>
                  </AlertDescription>
                </Alert>
              ))}
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>
            <Trans>Cancel</Trans>
          </Button>
          <fetcher.Form
            method="post"
            action={action}
            onSubmit={() => (submitted.current = true)}
          >
            <input
              type="hidden"
              name="createNcr"
              value={createNcr ? "true" : "false"}
            />
            <input
              type="hidden"
              name="nonConformanceTypeId"
              value={createNcr ? issueTypeId : ""}
            />
            <Button
              variant="destructive"
              type="submit"
              isLoading={fetcher.state !== "idle"}
              isDisabled={
                fetcher.state !== "idle" ||
                (createNcr && hasIssueTypes && !issueTypeId)
              }
            >
              <Trans>Reject Lot</Trans>
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
  sub
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium truncate">{value || "—"}</span>
      {sub && (
        <span className="text-xs text-muted-foreground truncate">{sub}</span>
      )}
    </div>
  );
}
