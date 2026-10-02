// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardAttribute,
  CardAttributeLabel,
  CardAttributes,
  CardAttributeValue,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  IconButton,
  MenuIcon,
  MenuItem,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Status,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  TruncatedTooltipText,
  VStack
} from "@carbon/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import type { CellContext, ColumnDef } from "@tanstack/react-table";
import type { ComponentProps, MouseEvent, ReactNode } from "react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  LuArrowRight,
  LuBookMarked,
  LuChevronRight,
  LuCircleCheck,
  LuHistory,
  LuInfo,
  LuLink,
  LuRefreshCw,
  LuStar,
  LuTriangleAlert
} from "react-icons/lu";
import { Link, useFetcher, useRevalidator } from "react-router";
import type { z } from "zod";
import {
  Boolean,
  Hidden,
  Select,
  Submit,
  TextArea,
  TextAreaControlled
} from "~/components/Form";
import Hyperlink from "~/components/Hyperlink";
import Table from "~/components/Table";
import IndeterminateCheckbox from "~/components/Table/components/IndeterminateCheckbox";
import { usePermissions, useUrlParams } from "~/hooks";
import {
  type ChangeNotice,
  type ChangeNoticeImpactCandidate,
  type ChangeNoticeImpactCoverage,
  type ChangeNoticeImpactDecisionBulkFormTarget,
  type ChangeNoticeImpactDecisionBulkWriteData,
  type ChangeNoticeImpactDecisionStatus,
  type ChangeNoticeImpactNoActionReasonCode,
  type ChangeNoticeImpactWorkspaceReadModel,
  changeNoticeImpactDecisionBulkFormValidator,
  changeNoticeImpactDecisionFormValidator,
  changeNoticeImpactDecisionStatuses,
  changeNoticeStageFlow
} from "~/modules/items";
import JobStatus from "~/modules/production/ui/Jobs/JobStatus";
import PurchasingStatus from "~/modules/purchasing/ui/PurchaseOrder/PurchasingStatus";
import { path } from "~/utils/path";
import type { ChangeNoticeActionTask } from "../../types";
import {
  ChangeNoticeImpactFilterBar,
  filterChangeNoticeImpactCandidates,
  getImpactDecisionFilterValue,
  getImpactFilteredEmptyState,
  getImpactFilterValues,
  hasImpactDisplayFilters,
  hasIncompleteImpactTaskFilter
} from "./ChangeNoticeImpactFilters";
import { ChangeNoticeImpactHistory } from "./ChangeNoticeImpactHistory";
import { SnapshotFacts } from "./ChangeNoticeImpactSnapshotFacts";
import { ChangeNoticeImpactTasks } from "./ChangeNoticeImpactTasks";

const CURRENT_EXPOSURE = "Current operational exposure";
const HISTORICAL_REFERENCE = "Historical reference";
const NO_LONGER_IN_SCOPE = "No longer in current scope";

type WorkspaceProps = {
  id: string;
  changeNotice: ChangeNotice | null;
  data: ChangeNoticeImpactWorkspaceReadModel;
  actions: ChangeNoticeActionTask[];
};

type Candidate = ChangeNoticeImpactWorkspaceReadModel["candidates"][number];

type Group = {
  key: string;
  label: string;
  parent: Candidate["parent"];
  candidates: Candidate[];
};

export type ChangeNoticeImpactDecisionMode = "assess" | "reassess" | "resolve";

type ImpactResolutionBlock = "taskCoverage" | "nonTerminalTask" | null;

export type ChangeNoticeImpactDecisionControls = {
  assess: boolean;
  reassess: boolean;
  resolve: boolean;
  resolveBlock: ImpactResolutionBlock;
};

type ImpactBulkDecisionStatus = ChangeNoticeImpactDecisionStatus;
type ImpactBulkFetcherData =
  | { success: true; data: ChangeNoticeImpactDecisionBulkWriteData }
  | { success: false; error?: { message: string }; conflict?: boolean };

type ImpactRefreshFetcherData = { success: true } | { success: false };

const impactSelectionSeparator = "\u0000";

type ImpactRefreshSubmit = (
  target: null,
  options: { method: "post"; action: string }
) => void;

export function refreshChangeNoticeImpactWorkspace({
  canUpdate,
  id,
  submit,
  revalidate
}: {
  canUpdate: boolean;
  id: string;
  submit: ImpactRefreshSubmit;
  revalidate: () => void;
}) {
  if (!canUpdate) {
    revalidate();
    return;
  }

  submit(null, {
    method: "post",
    action: path.to.changeNoticeImpact(id)
  });
}

export function getChangeNoticeImpactSelectionKey(
  targetType: Candidate["targetType"],
  targetId: string
) {
  return `${targetType}${impactSelectionSeparator}${targetId}`;
}

export function canViewChangeNoticeImpactHistory(
  candidate: Candidate
): boolean {
  return (
    candidate.decision !== null && candidate.sourceAvailability !== "Restricted"
  );
}

export function getChangeNoticeImpactDecisionStatusOptions(
  decision: Candidate["decision"]
): ChangeNoticeImpactDecisionStatus[] {
  // Resolved is a same-state reassessment option. New and open decisions use
  // the dedicated Resolve action for closure so it cannot bypass task gates.
  return decision?.status === "Resolved"
    ? [...changeNoticeImpactDecisionStatuses]
    : ["No action required", "Action required"];
}

export function getChangeNoticeImpactRationaleDefault({
  persistedStatus,
  selectedStatus,
  persistedRationale
}: {
  persistedStatus: ChangeNoticeImpactDecisionStatus | null;
  selectedStatus: ChangeNoticeImpactDecisionStatus;
  persistedRationale: string | null | undefined;
}): string {
  return persistedStatus === selectedStatus ? (persistedRationale ?? "") : "";
}

export function getChangeNoticeImpactDecisionControls({
  candidate,
  coverageStatus,
  taskCoverageStatus,
  changeNoticeStatus,
  canUpdate
}: {
  candidate: Candidate;
  coverageStatus: ChangeNoticeImpactCoverage["status"];
  taskCoverageStatus: ChangeNoticeImpactWorkspaceReadModel["taskCoverage"]["status"];
  changeNoticeStatus: ChangeNotice["status"] | null | undefined;
  canUpdate: boolean;
}): ChangeNoticeImpactDecisionControls {
  const decision = candidate.decision;
  const isCurrentAssessable =
    candidate.exposureClassification === CURRENT_EXPOSURE &&
    candidate.sourceAvailability === "Present" &&
    candidate.currentSnapshot !== null;
  const lifecycleAllowsNewWork =
    changeNoticeStatus !== undefined &&
    changeNoticeStatus !== null &&
    (changeNoticeStageFlow as readonly string[]).includes(changeNoticeStatus);
  const coverageComplete = coverageStatus === "complete";
  const canReassess =
    canUpdate &&
    decision !== null &&
    isCurrentAssessable &&
    coverageComplete &&
    lifecycleAllowsNewWork &&
    candidate.freshness !== "Unknown";
  const canAssess =
    canUpdate &&
    decision === null &&
    isCurrentAssessable &&
    coverageComplete &&
    lifecycleAllowsNewWork;

  const canResolveExisting =
    canUpdate &&
    decision?.status === "Action required" &&
    candidate.sourceAvailability !== "Restricted" &&
    (lifecycleAllowsNewWork || changeNoticeStatus === "Cancelled");
  const canResolveFirst =
    canUpdate &&
    decision === null &&
    isCurrentAssessable &&
    coverageComplete &&
    lifecycleAllowsNewWork;
  const canShowResolve = canResolveExisting || canResolveFirst;
  const hasNonTerminalTask = candidate.taskLinks.some(
    (task) => task.status !== "Completed" && task.status !== "Skipped"
  );

  return {
    assess: canAssess,
    reassess: canReassess,
    resolve: canShowResolve,
    resolveBlock: canResolveExisting
      ? taskCoverageStatus !== "complete"
        ? "taskCoverage"
        : hasNonTerminalTask
          ? "nonTerminalTask"
          : null
      : null
  };
}

export function canSelectChangeNoticeImpactCandidate({
  candidate,
  coverageStatus,
  taskCoverageStatus,
  changeNoticeStatus,
  canUpdate
}: {
  candidate: Candidate;
  coverageStatus: ChangeNoticeImpactCoverage["status"];
  taskCoverageStatus: ChangeNoticeImpactWorkspaceReadModel["taskCoverage"]["status"];
  changeNoticeStatus: ChangeNotice["status"] | null | undefined;
  canUpdate: boolean;
}) {
  if (
    !canUpdate ||
    coverageStatus !== "complete" ||
    candidate.exposureClassification !== CURRENT_EXPOSURE ||
    candidate.sourceAvailability !== "Present" ||
    candidate.currentSnapshot === null ||
    candidate.previewFingerprint === null ||
    (candidate.decision !== null && candidate.freshness === "Unknown")
  ) {
    return false;
  }

  const controls = getChangeNoticeImpactDecisionControls({
    candidate,
    coverageStatus,
    taskCoverageStatus,
    changeNoticeStatus,
    canUpdate
  });
  return (
    controls.assess ||
    controls.reassess ||
    (controls.resolve && controls.resolveBlock === null)
  );
}

export function getChangeNoticeImpactBulkDecisionStatusOptions({
  candidates,
  coverage,
  taskCoverageStatus,
  changeNoticeStatus
}: {
  candidates: Candidate[];
  coverage: ChangeNoticeImpactWorkspaceReadModel["coverage"];
  taskCoverageStatus: ChangeNoticeImpactWorkspaceReadModel["taskCoverage"]["status"];
  changeNoticeStatus: ChangeNotice["status"] | null | undefined;
}): ImpactBulkDecisionStatus[] {
  if (candidates.length === 0) return [];

  const controls = candidates.map((candidate) =>
    getChangeNoticeImpactDecisionControls({
      candidate,
      coverageStatus: coverage[candidate.targetType].status,
      taskCoverageStatus,
      changeNoticeStatus,
      canUpdate: true
    })
  );
  const canApplyConclusion = controls.every(
    (control) => control.assess || control.reassess
  );
  const options: ImpactBulkDecisionStatus[] = canApplyConclusion
    ? ["No action required", "Action required"]
    : [];
  if (
    controls.every(
      (control) => control.resolve && control.resolveBlock === null
    )
  ) {
    options.push("Resolved");
  }
  return options;
}

export function getChangeNoticeImpactBulkNoActionReasonOptions(
  candidates: Candidate[]
): ChangeNoticeImpactNoActionReasonCode[] {
  if (
    candidates.length > 0 &&
    candidates.every(
      (candidate) => candidate.targetType === "purchaseOrderLine"
    )
  ) {
    return ["Not affected after review", "No purchasing intervention remains"];
  }
  return ["Not affected after review"];
}

function domainLabel(targetType: Candidate["targetType"]): ReactNode {
  switch (targetType) {
    case "purchaseOrderLine":
      return <Trans>Purchase Order Line</Trans>;
    case "job":
      return <Trans>Producing Job</Trans>;
    case "jobMaterial":
      return <Trans>Job Material</Trans>;
  }
}

function ParentStatus({
  parent
}: {
  parent: NonNullable<Candidate["parent"]>;
}) {
  if (parent.type === "purchaseOrder") {
    return (
      <PurchasingStatus
        status={
          parent.status as ComponentProps<typeof PurchasingStatus>["status"]
        }
      />
    );
  }

  return (
    <JobStatus
      status={parent.status as ComponentProps<typeof JobStatus>["status"]}
    />
  );
}

function decisionLabel(
  status: "Unassessed" | ChangeNoticeImpactDecisionStatus
): string | JSX.Element {
  switch (status) {
    case "Unassessed":
      return <Trans>Unassessed</Trans>;
    case "No action required":
      return <Trans>No action required</Trans>;
    case "Action required":
      return <Trans>Action required</Trans>;
    case "Resolved":
      return <Trans>Resolved</Trans>;
    default:
      return status;
  }
}

function exposureLabel(
  classification: ChangeNoticeImpactCandidate["exposureClassification"]
) {
  switch (classification) {
    case CURRENT_EXPOSURE:
      return <Trans>Current operational exposure</Trans>;
    case HISTORICAL_REFERENCE:
      return <Trans>Historical reference</Trans>;
    case NO_LONGER_IN_SCOPE:
      return <Trans>No longer in current scope</Trans>;
    default:
      return null;
  }
}

function noActionReasonLabel(
  reason: ChangeNoticeImpactNoActionReasonCode
): string | JSX.Element {
  switch (reason) {
    case "Outside effectivity":
      return <Trans>Outside effectivity</Trans>;
    case "Not affected after review":
      return <Trans>Not affected after review</Trans>;
    case "No purchasing intervention remains":
      return <Trans>No purchasing intervention remains</Trans>;
  }
}

function stateBadge(
  candidate: Candidate,
  coverageStatus: ChangeNoticeImpactCoverage["status"]
) {
  const status = getImpactDecisionFilterValue(candidate, coverageStatus);
  if (!status) return null;

  return (
    <Status
      disableTooltip
      color={
        status === "Action required"
          ? "orange"
          : status === "Resolved"
            ? "green"
            : "gray"
      }
      className="whitespace-nowrap"
    >
      {decisionLabel(status)}
    </Status>
  );
}

export function conditionBadges(candidate: Candidate) {
  const badges: ReactNode[] = [];
  if (candidate.exposureClassification !== CURRENT_EXPOSURE) {
    const label = exposureLabel(candidate.exposureClassification);
    if (label) {
      badges.push(
        <Badge key="exposure" variant="outline" className="whitespace-nowrap">
          {label}
        </Badge>
      );
    }
  }
  if (candidate.sourceAvailability !== "Present") {
    badges.push(
      <Badge
        key="availability"
        variant="outline"
        className="whitespace-nowrap border-amber-500/50 text-amber-700 dark:text-amber-300"
      >
        {candidate.sourceAvailability === "Source deleted" ? (
          <Trans>Source deleted</Trans>
        ) : candidate.sourceAvailability === "Restricted" ? (
          <Trans>Restricted</Trans>
        ) : (
          <Trans>Unavailable</Trans>
        )}
      </Badge>
    );
  }
  badges.push(...freshnessBadges(candidate));
  return badges;
}

// Freshness is meaningful only when it is not plain `Current`; unchanged rows
// keep a quiet cell so the scan row stays readable.
function freshnessBadges(candidate: Candidate) {
  if (candidate.freshness === "Changed since assessment") {
    return [
      <Badge
        key="freshness"
        variant="outline"
        className="whitespace-nowrap border-orange-500/50 text-orange-700 dark:text-orange-300"
      >
        <Trans>Changed since assessment</Trans>
      </Badge>
    ];
  }
  if (candidate.freshness === "Unknown") {
    return [
      <Badge
        key="freshness"
        variant="outline"
        className="whitespace-nowrap border-amber-500/50 text-amber-700 dark:text-amber-300"
      >
        <Trans>Freshness unavailable</Trans>
      </Badge>
    ];
  }
  return [];
}

function sourceHref(candidate: Candidate) {
  if (!candidate.parent || candidate.sourceAvailability !== "Present")
    return null;
  return candidate.targetType === "purchaseOrderLine"
    ? path.to.purchaseOrderLine(candidate.parent.id, candidate.targetId)
    : candidate.targetType === "job"
      ? path.to.job(candidate.parent.id)
      : path.to.jobMaterials(candidate.parent.id);
}

function provenanceLabel(label: string | null): ReactNode {
  return label ?? <Trans>Affected item</Trans>;
}

function Provenance({ candidate }: { candidate: Candidate }) {
  if (candidate.provenance.length === 0) return null;
  return (
    <details className="group rounded-lg border border-border/70 px-3 py-2 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1 font-medium [&::-webkit-details-marker]:hidden">
        <LuChevronRight className="size-3 transition-transform group-open:rotate-90" />
        <Trans>Provenance</Trans>
      </summary>
      <div className="mt-2 space-y-2 pl-4">
        {candidate.currentProvenance.length > 0 && (
          <div>
            <div className="text-muted-foreground">
              <Trans>Current Cause</Trans>
            </div>
            {candidate.currentProvenance.map((cause) => (
              <div key={`${cause.affectedItemId}-current`}>
                {provenanceLabel(cause.affectedItemLabel)}
              </div>
            ))}
          </div>
        )}
        {candidate.historicalProvenance.length > 0 && (
          <div>
            <div className="text-muted-foreground">
              <Trans>Historical Causes</Trans>
            </div>
            {candidate.historicalProvenance.map((cause, index) => (
              <div
                key={`${cause.affectedItemId}-${cause.affectedItemSourceId}-${index}`}
              >
                <span>{provenanceLabel(cause.affectedItemLabel)}</span>
                {cause.endedReason && (
                  <span className="text-muted-foreground">
                    {` — ${cause.endedReason}`}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function DecisionSummary({ candidate }: { candidate: Candidate }) {
  const decision = candidate.decision;
  if (!decision) return null;

  return (
    <div className="space-y-1 text-xs">
      {decision.noActionReasonCode && (
        <div>
          <span className="text-muted-foreground">
            <Trans>No-Action Reason</Trans>:
          </span>{" "}
          {noActionReasonLabel(decision.noActionReasonCode)}
        </div>
      )}
      {decision.rationale && (
        <div>
          <span className="text-muted-foreground">
            <Trans>Rationale</Trans>:
          </span>{" "}
          {decision.rationale}
        </div>
      )}
      {decision.resolutionNote && (
        <div>
          <span className="text-muted-foreground">
            <Trans>Resolution Note</Trans>:
          </span>{" "}
          {decision.resolutionNote}
        </div>
      )}
    </div>
  );
}

function AssessmentSnapshot({ candidate }: { candidate: Candidate }) {
  const snapshot = candidate.decision?.persistedSnapshot;
  if (!snapshot) return null;

  return (
    <details className="group rounded-lg border border-border/70 px-3 py-2 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1 font-medium [&::-webkit-details-marker]:hidden">
        <LuChevronRight className="size-3 transition-transform group-open:rotate-90" />
        {candidate.freshness === "Changed since assessment" ? (
          <Trans>Assessment Snapshot · Changed</Trans>
        ) : (
          <Trans>Assessment Snapshot</Trans>
        )}
      </summary>
      <div className="mt-2">
        <SnapshotFacts
          candidate={candidate}
          snapshot={snapshot}
          emptyMessage={
            <Trans>Stored assessment snapshot is unavailable.</Trans>
          }
        />
      </div>
    </details>
  );
}

type ImpactDecisionFetcherData =
  | { success: true; data: unknown }
  | { success: false; error?: { message: string }; conflict?: boolean };

type ImpactDecisionModalProps = {
  changeNoticeId: string;
  candidate: Candidate;
  mode: ChangeNoticeImpactDecisionMode;
  coverageStatus: ChangeNoticeImpactCoverage["status"];
  taskCoverageStatus: ChangeNoticeImpactWorkspaceReadModel["taskCoverage"]["status"];
  changeNoticeStatus: ChangeNotice["status"] | null | undefined;
  onClose: () => void;
  onSuccess: () => void;
  onConflict: (message: string) => void;
};

function ImpactDecisionModal({
  changeNoticeId,
  candidate,
  mode,
  coverageStatus,
  taskCoverageStatus,
  changeNoticeStatus,
  onClose,
  onSuccess,
  onConflict
}: ImpactDecisionModalProps) {
  const { t } = useLingui();
  const fetcher = useFetcher<ImpactDecisionFetcherData>();
  const decision = candidate.decision;
  const initialStatus: ChangeNoticeImpactDecisionStatus =
    mode === "resolve" ? "Resolved" : (decision?.status ?? "Action required");
  const [decisionStatus, setDecisionStatus] =
    useState<ChangeNoticeImpactDecisionStatus>(initialStatus);
  const initialNoActionReason: ChangeNoticeImpactNoActionReasonCode =
    decision?.noActionReasonCode ?? "Not affected after review";
  const [noActionReason, setNoActionReason] =
    useState<ChangeNoticeImpactNoActionReasonCode>(initialNoActionReason);
  const [rationale, setRationale] = useState(() =>
    getChangeNoticeImpactRationaleDefault({
      persistedStatus: decision?.status ?? null,
      selectedStatus: initialStatus,
      persistedRationale: decision?.rationale
    })
  );
  const isSubmitting = fetcher.state !== "idle";
  const resolutionControls = getChangeNoticeImpactDecisionControls({
    candidate,
    coverageStatus,
    taskCoverageStatus,
    changeNoticeStatus,
    canUpdate: true
  });
  const resolveBlocked =
    mode === "resolve" && resolutionControls.resolveBlock !== null;
  const formDefaults = useMemo<
    z.infer<typeof changeNoticeImpactDecisionFormValidator>
  >(
    () => ({
      changeNoticeId,
      targetType: candidate.targetType,
      targetId: candidate.targetId,
      decisionStatus: initialStatus,
      noActionReasonCode: initialNoActionReason,
      rationale: decision?.rationale ?? undefined,
      resolutionNote: decision?.resolutionNote ?? undefined,
      expectedRevision: decision?.revision,
      confirmNoPurchasingInterventionRemains: false
    }),
    [
      candidate.targetId,
      candidate.targetType,
      changeNoticeId,
      decision?.rationale,
      decision?.resolutionNote,
      decision?.revision,
      initialNoActionReason,
      initialStatus
    ]
  );

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.success) {
      onSuccess();
    } else if (fetcher.data.conflict) {
      onConflict(
        fetcher.data.error?.message ??
          "The Impact assessment changed while you were editing."
      );
    }
  }, [fetcher.data, fetcher.state, onConflict, onSuccess]);

  const statusOptions = useMemo(
    () =>
      mode === "resolve"
        ? []
        : getChangeNoticeImpactDecisionStatusOptions(decision),
    [decision, mode]
  );
  const isConclusionChange =
    decision !== null && decisionStatus !== decision.status;

  const reasonOptions = useMemo(
    () => [
      {
        value: "Not affected after review" as const,
        label: noActionReasonLabel("Not affected after review")
      },
      ...(candidate.targetType === "purchaseOrderLine"
        ? [
            {
              value: "No purchasing intervention remains" as const,
              label: noActionReasonLabel("No purchasing intervention remains")
            }
          ]
        : [])
    ],
    [candidate.targetType]
  );

  const failedResponse =
    fetcher.data && !fetcher.data.success ? fetcher.data : null;
  const isPurchasingConfirmation =
    decisionStatus === "No action required" &&
    noActionReason === "No purchasing intervention remains";

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          key={`${candidate.targetType}-${candidate.targetId}-${mode}-${decision?.revision ?? "new"}`}
          validator={changeNoticeImpactDecisionFormValidator}
          method="post"
          action={path.to.changeNoticeImpactDecision(changeNoticeId)}
          defaultValues={formDefaults}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              {mode === "resolve" ? (
                <Trans>Resolve Operational Impact</Trans>
              ) : decision ? (
                <Trans>Reassess Operational Impact</Trans>
              ) : (
                <Trans>Assess Operational Impact</Trans>
              )}
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <Hidden name="changeNoticeId" value={changeNoticeId} />
              <Hidden name="targetType" value={candidate.targetType} />
              <Hidden name="targetId" value={candidate.targetId} />
              {decision && (
                <Hidden name="expectedRevision" value={decision.revision} />
              )}

              <div className="w-full space-y-2 rounded-lg bg-muted/40 p-3 text-xs">
                <TargetIdentity candidate={candidate} />
                <div className="text-muted-foreground">
                  {candidate.parent?.readableId ?? (
                    <Trans>Source record unavailable</Trans>
                  )}
                </div>
                <SnapshotFacts candidate={candidate} />
                {candidate.freshness === "Changed since assessment" && (
                  <p className="text-orange-700 dark:text-orange-300">
                    <Trans>
                      Current source facts changed since the stored assessment.
                      Saving will capture a fresh assessment snapshot.
                    </Trans>
                  </p>
                )}
                <DecisionSummary candidate={candidate} />
              </div>

              {mode === "resolve" ? (
                <Hidden name="decisionStatus" value="Resolved" />
              ) : (
                <Select
                  name="decisionStatus"
                  label={t`Conclusion`}
                  options={statusOptions.map((status) => ({
                    value: status,
                    label: decisionLabel(status)
                  }))}
                  isRequired
                  onChange={(option) => {
                    if (option?.value) {
                      const nextStatus =
                        option.value as ChangeNoticeImpactDecisionStatus;
                      setDecisionStatus(nextStatus);
                      setRationale(
                        getChangeNoticeImpactRationaleDefault({
                          persistedStatus: decision?.status ?? null,
                          selectedStatus: nextStatus,
                          persistedRationale: decision?.rationale
                        })
                      );
                    }
                  }}
                />
              )}

              {decisionStatus === "No action required" && (
                <Select
                  name="noActionReasonCode"
                  label={t`No-Action Reason`}
                  options={reasonOptions}
                  isRequired
                  onChange={(option) => {
                    if (option?.value) {
                      setNoActionReason(
                        option.value as ChangeNoticeImpactNoActionReasonCode
                      );
                    }
                  }}
                />
              )}

              {isPurchasingConfirmation && (
                <Boolean
                  name="confirmNoPurchasingInterventionRemains"
                  label={t`Confirm No Purchasing Intervention Remains`}
                  description={t`Supplier return, replacement, credit, and communication interventions have been reviewed.`}
                />
              )}

              {isConclusionChange &&
                decisionStatus === "No action required" && (
                  <p className="w-full text-xs text-muted-foreground">
                    <Trans>
                      Use No action required only if the earlier conclusion was
                      incorrect and intervention was never required. If
                      intervention occurred and closed the consequence, use
                      Resolve.
                    </Trans>
                  </p>
                )}
              {decisionStatus === "Action required" && (
                <TextAreaControlled
                  name="rationale"
                  label={
                    isConclusionChange
                      ? t`New Follow-Up Rationale`
                      : t`Follow-Up Rationale`
                  }
                  value={rationale}
                  onChange={setRationale}
                  isRequired
                />
              )}
              {decisionStatus === "No action required" && (
                <TextAreaControlled
                  name="rationale"
                  label={
                    isConclusionChange
                      ? t`Correction Rationale`
                      : t`Review Rationale`
                  }
                  value={rationale}
                  onChange={setRationale}
                  isRequired
                />
              )}
              {decisionStatus === "Resolved" && (
                <TextArea
                  name="resolutionNote"
                  label={t`Closure Evidence`}
                  isRequired
                />
              )}

              {resolveBlocked && (
                <div
                  role="alert"
                  className="w-full rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
                >
                  {resolutionControls.resolveBlock === "taskCoverage" ? (
                    <Trans>
                      Resolution is unavailable until linked task coverage is
                      complete.
                    </Trans>
                  ) : (
                    <Trans>Linked tasks must be Completed or Skipped.</Trans>
                  )}
                </div>
              )}
              {failedResponse?.error?.message && (
                <div
                  role="alert"
                  className="w-full rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                >
                  {failedResponse.error.message}
                </div>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                isDisabled={isSubmitting}
              >
                <Trans>Cancel</Trans>
              </Button>
              <Submit isDisabled={resolveBlocked} isLoading={isSubmitting}>
                {mode === "resolve" ? (
                  <Trans>Resolve</Trans>
                ) : mode === "assess" ? (
                  <Trans>Save Assessment</Trans>
                ) : (
                  <Trans>Save Reassessment</Trans>
                )}
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

type ImpactBulkDecisionModalProps = {
  changeNoticeId: string;
  candidates: Candidate[];
  coverage: ChangeNoticeImpactWorkspaceReadModel["coverage"];
  taskCoverageStatus: ChangeNoticeImpactWorkspaceReadModel["taskCoverage"]["status"];
  changeNoticeStatus: ChangeNotice["status"] | null | undefined;
  onClose: () => void;
  onSuccess: (data: ChangeNoticeImpactDecisionBulkWriteData) => void;
  onConflict: (message: string) => void;
};

function ImpactBulkDecisionModal({
  changeNoticeId,
  candidates,
  coverage,
  taskCoverageStatus,
  changeNoticeStatus,
  onClose,
  onSuccess,
  onConflict
}: ImpactBulkDecisionModalProps) {
  const { t } = useLingui();
  const fetcher = useFetcher<ImpactBulkFetcherData>();
  const statusOptions = getChangeNoticeImpactBulkDecisionStatusOptions({
    candidates,
    coverage,
    taskCoverageStatus,
    changeNoticeStatus
  });
  const reasonOptions =
    getChangeNoticeImpactBulkNoActionReasonOptions(candidates);
  const [decisionStatus, setDecisionStatus] =
    useState<ImpactBulkDecisionStatus>(statusOptions[0] ?? "Action required");
  const [noActionReason, setNoActionReason] =
    useState<ChangeNoticeImpactNoActionReasonCode>(
      reasonOptions[0] ?? "Not affected after review"
    );
  const [rationale, setRationale] = useState("");
  const isSubmitting = fetcher.state !== "idle";
  const isPurchasingConfirmation =
    decisionStatus === "No action required" &&
    noActionReason === "No purchasing intervention remains";
  const formTargets: ChangeNoticeImpactDecisionBulkFormTarget[] =
    candidates.map((candidate) => ({
      targetType: candidate.targetType,
      targetId: candidate.targetId,
      ...(candidate.decision
        ? { expectedRevision: candidate.decision.revision }
        : {}),
      expectedSnapshotFingerprint: candidate.previewFingerprint ?? ""
    }));
  const formDefaults = useMemo<
    z.infer<typeof changeNoticeImpactDecisionBulkFormValidator>
  >(
    () => ({
      changeNoticeId,
      targets: formTargets,
      decisionStatus,
      noActionReasonCode: noActionReason,
      rationale,
      resolutionNote: undefined,
      confirmNoPurchasingInterventionRemains: false
    }),
    [changeNoticeId, decisionStatus, formTargets, noActionReason, rationale]
  );

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.success) {
      onSuccess(fetcher.data.data);
    } else if (fetcher.data.conflict) {
      onConflict(
        fetcher.data.error?.message ??
          "The selected Impact targets changed while you were reviewing them."
      );
    }
  }, [fetcher.data, fetcher.state, onConflict, onSuccess]);

  const failedResponse =
    fetcher.data && !fetcher.data.success ? fetcher.data : null;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="xlarge">
        <ValidatedForm
          key={candidates
            .map(
              (candidate) =>
                `${candidate.targetType}-${candidate.targetId}-${candidate.decision?.revision ?? "new"}`
            )
            .join("|")}
          validator={changeNoticeImpactDecisionBulkFormValidator}
          method="post"
          action={path.to.changeNoticeImpactBulk(changeNoticeId)}
          defaultValues={formDefaults}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Review Bulk Impact Assessment</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <Hidden name="changeNoticeId" value={changeNoticeId} />
              <Hidden name="targets" value={JSON.stringify(formTargets)} />

              <div className="w-full space-y-2 rounded-lg bg-muted/40 p-3 text-xs">
                <div className="font-medium">
                  <Plural
                    value={candidates.length}
                    one="# selected target"
                    other="# selected targets"
                  />
                </div>
                <p className="text-muted-foreground">
                  <Trans>
                    All selected targets are rechecked. Any conflict rejects the
                    whole batch.
                  </Trans>
                </p>
              </div>

              <div className="w-full min-w-0 overflow-x-auto rounded-lg border border-border">
                <TableBase full className="text-xs">
                  <Thead>
                    <Tr>
                      <Th scope="col" className="px-3">
                        <Trans>Target</Trans>
                      </Th>
                      <Th scope="col" className="px-3">
                        <Trans>Current Conclusion</Trans>
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {candidates.map((candidate) => (
                      <Fragment
                        key={`${candidate.targetType}-${candidate.targetId}`}
                      >
                        <Tr>
                          <Td className="px-3 py-2">
                            <TargetIdentity candidate={candidate} />
                            <div className="text-muted-foreground">
                              {candidate.parent?.readableId ?? (
                                <Trans>Source record unavailable</Trans>
                              )}
                            </div>
                          </Td>
                          <Td className="px-3 py-2">
                            <div className="flex flex-wrap gap-2">
                              {stateBadge(
                                candidate,
                                coverage[candidate.targetType].status
                              )}
                              {conditionBadges(candidate)}
                            </div>
                          </Td>
                        </Tr>
                        <Tr>
                          <Td colSpan={2} className="px-3 pb-3">
                            <SnapshotFacts candidate={candidate} />
                          </Td>
                        </Tr>
                      </Fragment>
                    ))}
                  </Tbody>
                </TableBase>
              </div>

              <Select
                name="decisionStatus"
                label={t`Conclusion for Every Selected Target`}
                options={statusOptions.map((status) => ({
                  value: status,
                  label: decisionLabel(status)
                }))}
                isRequired
                onChange={(option) => {
                  if (!option?.value) return;
                  const nextStatus = option.value as ImpactBulkDecisionStatus;
                  setDecisionStatus(nextStatus);
                  setRationale("");
                }}
              />

              {decisionStatus === "No action required" && (
                <Select
                  name="noActionReasonCode"
                  label={t`No-Action Reason for Every Selected Target`}
                  options={reasonOptions.map((reason) => ({
                    value: reason,
                    label: noActionReasonLabel(reason)
                  }))}
                  isRequired
                  onChange={(option) => {
                    if (option?.value) {
                      setNoActionReason(
                        option.value as ChangeNoticeImpactNoActionReasonCode
                      );
                    }
                  }}
                />
              )}

              {isPurchasingConfirmation && (
                <Boolean
                  name="confirmNoPurchasingInterventionRemains"
                  label={t`Confirm No Purchasing Intervention Remains for Every Selected Target`}
                  description={t`Supplier return, replacement, credit, and communication interventions have been reviewed.`}
                />
              )}

              {decisionStatus === "Resolved" ? (
                <TextArea
                  name="resolutionNote"
                  label={t`Closure Evidence for Every Selected Target`}
                  isRequired
                />
              ) : (
                <TextAreaControlled
                  name="rationale"
                  label={
                    decisionStatus === "No action required"
                      ? t`Review Rationale for Every Selected Target`
                      : t`Follow-Up Rationale for Every Selected Target`
                  }
                  value={rationale}
                  onChange={setRationale}
                  isRequired
                />
              )}

              {failedResponse?.error?.message && (
                <div
                  role="alert"
                  className="w-full rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                >
                  {failedResponse.error.message}
                </div>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                isDisabled={isSubmitting}
              >
                <Trans>Cancel</Trans>
              </Button>
              <Submit isLoading={isSubmitting}>
                <Trans>Apply to {candidates.length}</Trans>
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

function DecisionControls({
  candidate,
  coverageStatus,
  taskCoverageStatus,
  changeNoticeStatus,
  canUpdate,
  onOpen
}: {
  candidate: Candidate;
  coverageStatus: ChangeNoticeImpactCoverage["status"];
  taskCoverageStatus: ChangeNoticeImpactWorkspaceReadModel["taskCoverage"]["status"];
  changeNoticeStatus: ChangeNotice["status"] | null | undefined;
  canUpdate: boolean;
  onOpen: (mode: ChangeNoticeImpactDecisionMode) => void;
}) {
  const controls = getChangeNoticeImpactDecisionControls({
    candidate,
    coverageStatus,
    taskCoverageStatus,
    changeNoticeStatus,
    canUpdate
  });
  if (!controls.assess && !controls.reassess && !controls.resolve) return null;
  // One primary per surface: the same next step the Next Action column shows,
  // so an Unassessed row leads with Assess rather than the Resolve exception.
  const primaryMode =
    candidate.decision?.status === "Action required"
      ? "resolve"
      : controls.assess
        ? "assess"
        : controls.reassess
          ? "reassess"
          : null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
      {controls.assess && (
        <Button
          type="button"
          size="sm"
          variant={primaryMode === "assess" ? "primary" : "secondary"}
          onClick={() => onOpen("assess")}
        >
          <Trans>Assess</Trans>
        </Button>
      )}
      {controls.reassess && (
        <Button
          type="button"
          size="sm"
          variant={primaryMode === "reassess" ? "primary" : "secondary"}
          onClick={() => onOpen("reassess")}
        >
          <Trans>Reassess</Trans>
        </Button>
      )}
      {controls.resolve && (
        <Button
          type="button"
          size="sm"
          variant={primaryMode === "resolve" ? "primary" : "secondary"}
          isDisabled={controls.resolveBlock !== null}
          onClick={() => onOpen("resolve")}
        >
          <Trans>Resolve</Trans>
        </Button>
      )}
      {controls.resolveBlock && (
        <span className="text-xs text-muted-foreground">
          <ResolutionBlockReason block={controls.resolveBlock} />
        </span>
      )}
    </div>
  );
}

type ImpactTableProps = {
  changeNoticeId: string;
  candidates: Candidate[];
  actions: ChangeNoticeActionTask[];
  coverage: ChangeNoticeImpactWorkspaceReadModel["coverage"];
  taskCoverageStatus: ChangeNoticeImpactWorkspaceReadModel["taskCoverage"]["status"];
  changeNoticeStatus: ChangeNotice["status"] | null | undefined;
  canUpdate: boolean;
  onRefresh: () => void;
  onOpenDecision: (
    candidate: Candidate,
    mode: ChangeNoticeImpactDecisionMode
  ) => void;
  onOpenHistory: (candidate: Candidate) => void;
  selectionEnabled: boolean;
  selectedKeys: ReadonlySet<string>;
  onToggleSelection: (candidate: Candidate, selected: boolean) => void;
  emptyMessage?: ReactNode;
};

function TargetIdentity({ candidate }: { candidate: Candidate }) {
  const label = candidate.item?.readableIdWithRevision ??
    candidate.item?.readableId ?? <Trans>Item details unavailable</Trans>;
  return (
    <div className="min-w-0">
      <TruncatedTooltipText tooltip={label} className="truncate font-medium">
        {label}
      </TruncatedTooltipText>
      <div className="text-xs text-muted-foreground">
        {domainLabel(candidate.targetType)}
      </div>
    </div>
  );
}

function SourceIdentity({ candidate }: { candidate: Candidate }) {
  const href = sourceHref(candidate);
  if (!candidate.parent)
    return (
      <span className="text-xs text-muted-foreground">
        <Trans>Source record unavailable</Trans>
      </span>
    );
  return (
    <div className="min-w-0 space-y-1">
      {href ? (
        <Hyperlink
          to={href}
          onClick={(event: MouseEvent<HTMLElement>) => event.stopPropagation()}
          className="whitespace-nowrap"
        >
          {candidate.parent.readableId}
        </Hyperlink>
      ) : (
        <span className="whitespace-nowrap">{candidate.parent.readableId}</span>
      )}
      <div className="text-xs">
        <ParentStatus parent={candidate.parent} />
      </div>
      {candidate.parent.type === "purchaseOrder" &&
        candidate.parent.supplierName && (
          <TruncatedTooltipText
            tooltip={candidate.parent.supplierName}
            className="truncate text-xs text-muted-foreground"
          >
            {candidate.parent.supplierName}
          </TruncatedTooltipText>
        )}
    </div>
  );
}

function ResolutionBlockReason({
  block
}: {
  block: Exclude<ImpactResolutionBlock, null>;
}) {
  return block === "taskCoverage" ? (
    <Trans>
      Resolution is unavailable until linked task coverage is complete.
    </Trans>
  ) : (
    <Trans>Linked tasks must be Completed or Skipped.</Trans>
  );
}

function NextDecisionAction({
  candidate,
  controls,
  onOpen
}: {
  candidate: Candidate;
  controls: ChangeNoticeImpactDecisionControls;
  onOpen: (mode: ChangeNoticeImpactDecisionMode) => void;
}) {
  const mode =
    candidate.decision?.status === "Action required"
      ? controls.resolve
        ? "resolve"
        : null
      : controls.assess
        ? "assess"
        : controls.reassess
          ? "reassess"
          : null;
  if (!mode) return null;
  const blocked = mode === "resolve" && controls.resolveBlock !== null;
  const button = (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      isDisabled={blocked}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(mode);
      }}
    >
      {mode === "assess" ? (
        <Trans>Assess</Trans>
      ) : mode === "reassess" ? (
        <Trans>Reassess</Trans>
      ) : (
        <Trans>Resolve</Trans>
      )}
    </Button>
  );
  if (!blocked || !controls.resolveBlock) return button;
  // The button is disabled and cannot take focus, so the wrapper carries it. The
  // reason is rendered as hidden text (not `aria-label`, which a plain div does
  // not support) so keyboard and screen-reader users get it without hovering.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          className="w-fit rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="sr-only">
            <ResolutionBlockReason block={controls.resolveBlock} />
          </span>
          {button}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <ResolutionBlockReason block={controls.resolveBlock} />
      </TooltipContent>
    </Tooltip>
  );
}

function ImpactDetails({
  candidate,
  changeNoticeId,
  actions,
  coverageStatus,
  taskCoverageStatus,
  changeNoticeStatus,
  canUpdate,
  onRefresh,
  onOpenDecision,
  onOpenHistory
}: {
  candidate: Candidate;
  changeNoticeId: string;
  actions: ChangeNoticeActionTask[];
  coverageStatus: ChangeNoticeImpactCoverage["status"];
  taskCoverageStatus: ChangeNoticeImpactWorkspaceReadModel["taskCoverage"]["status"];
  changeNoticeStatus: ChangeNotice["status"] | null | undefined;
  canUpdate: boolean;
  onRefresh: () => void;
  onOpenDecision: (
    candidate: Candidate,
    mode: ChangeNoticeImpactDecisionMode
  ) => void;
  onOpenHistory: (candidate: Candidate) => void;
}) {
  return (
    <div className="@container w-[calc(100cqw-2px)] max-w-full space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {stateBadge(candidate, coverageStatus)}
          {conditionBadges(candidate)}
        </div>
        {canViewChangeNoticeImpactHistory(candidate) && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            leftIcon={<LuHistory />}
            onClick={() => onOpenHistory(candidate)}
          >
            <Trans>History</Trans>
          </Button>
        )}
      </div>
      <SnapshotFacts candidate={candidate} />
      {candidate.unavailableReason && (
        <p className="text-xs text-muted-foreground">
          {candidate.unavailableReason}
        </p>
      )}
      <DecisionSummary candidate={candidate} />
      <AssessmentSnapshot candidate={candidate} />
      <Provenance candidate={candidate} />
      <ChangeNoticeImpactTasks
        changeNoticeId={changeNoticeId}
        changeNoticeStatus={changeNoticeStatus}
        candidate={candidate}
        actions={actions}
        canUpdate={canUpdate}
        taskCoverageStatus={taskCoverageStatus}
        onRefresh={onRefresh}
      />
      <DecisionControls
        candidate={candidate}
        coverageStatus={coverageStatus}
        taskCoverageStatus={taskCoverageStatus}
        changeNoticeStatus={changeNoticeStatus}
        canUpdate={canUpdate}
        onOpen={(mode) => onOpenDecision(candidate, mode)}
      />
    </div>
  );
}

function ImpactTable({
  changeNoticeId,
  candidates,
  actions,
  coverage,
  taskCoverageStatus,
  changeNoticeStatus,
  canUpdate,
  onRefresh,
  onOpenDecision,
  onOpenHistory,
  selectionEnabled,
  selectedKeys,
  onToggleSelection,
  emptyMessage
}: ImpactTableProps) {
  const { t } = useLingui();
  // Keep rows from the same source document adjacent (the previous grouped layout
  // order) without nesting a table per document.
  const orderedCandidates = useMemo(
    () => groupCandidates(candidates).flatMap((group) => group.candidates),
    [candidates]
  );
  const controlsFor = useCallback(
    (candidate: Candidate) =>
      getChangeNoticeImpactDecisionControls({
        candidate,
        coverageStatus: coverage[candidate.targetType].status,
        taskCoverageStatus,
        changeNoticeStatus,
        canUpdate
      }),
    [coverage, taskCoverageStatus, changeNoticeStatus, canUpdate]
  );
  // Local selection deliberately retains the existing all-data reconciliation and
  // stale blockers. Native Table select-all/range selection has no eligibility gate.
  const columns = useMemo<ColumnDef<Candidate>[]>(
    () => [
      ...(selectionEnabled
        ? [
            {
              id: "Select",
              header: () => (
                <span className="sr-only">
                  <Trans>Select Row</Trans>
                </span>
              ),
              size: 40,
              cell: ({ row }: CellContext<Candidate, unknown>) => {
                const candidate = row.original;
                const eligible = canSelectChangeNoticeImpactCandidate({
                  candidate,
                  coverageStatus: coverage[candidate.targetType].status,
                  taskCoverageStatus,
                  changeNoticeStatus,
                  canUpdate
                });
                const selected = selectedKeys.has(
                  getChangeNoticeImpactSelectionKey(
                    candidate.targetType,
                    candidate.targetId
                  )
                );
                if (!eligible && !selected) return null;
                const item =
                  candidate.item?.readableIdWithRevision ??
                  candidate.item?.readableId ??
                  t`Item details unavailable`;
                const source =
                  candidate.parent?.readableId ?? t`Source record unavailable`;
                const domain =
                  candidate.targetType === "purchaseOrderLine"
                    ? t`Purchase Order Line`
                    : candidate.targetType === "job"
                      ? t`Producing Job`
                      : t`Job Material`;
                return (
                  <IndeterminateCheckbox
                    checked={selected}
                    indeterminate={false}
                    disabled={!eligible}
                    aria-label={t`Select ${domain} ${item} from ${source}`}
                    onClick={(event: MouseEvent<HTMLButtonElement>) =>
                      event.stopPropagation()
                    }
                    onChange={(checked) =>
                      onToggleSelection(candidate, checked)
                    }
                  />
                );
              }
            }
          ]
        : []),
      {
        id: "Target",
        header: t`Target`,
        size: 190,
        cell: ({ row }) => <TargetIdentity candidate={row.original} />,
        meta: { icon: <LuBookMarked /> }
      },
      {
        id: "Source",
        header: t`Source`,
        size: 150,
        cell: ({ row }) => <SourceIdentity candidate={row.original} />,
        meta: { icon: <LuLink /> }
      },
      ...(selectionEnabled
        ? [
            {
              id: "Decision",
              header: t`Decision`,
              size: 175,
              cell: ({ row }: CellContext<Candidate, unknown>) => (
                <div className="flex flex-wrap items-center gap-1">
                  {stateBadge(
                    row.original,
                    coverage[row.original.targetType].status
                  )}
                  {freshnessBadges(row.original)}
                </div>
              ),
              meta: { icon: <LuStar /> }
            }
          ]
        : [
            {
              id: "Reason",
              header: t`Reason`,
              size: 230,
              cell: ({ row }: CellContext<Candidate, unknown>) => (
                <div className="space-y-1 text-xs text-muted-foreground">
                  {row.original.sourceAvailability === "Source deleted" ? (
                    <Trans>Source deleted</Trans>
                  ) : (
                    (exposureLabel(row.original.exposureClassification) ?? (
                      <Trans>Unavailable</Trans>
                    ))
                  )}
                  {row.original.unavailableReason && (
                    <TruncatedTooltipText
                      tooltip={row.original.unavailableReason}
                      className="truncate"
                    >
                      {row.original.unavailableReason}
                    </TruncatedTooltipText>
                  )}
                </div>
              ),
              meta: { icon: <LuInfo /> }
            }
          ]),
      {
        id: "NextAction",
        header: t`Next Action`,
        size: 120,
        cell: ({ row }) => (
          <NextDecisionAction
            candidate={row.original}
            controls={controlsFor(row.original)}
            onOpen={(mode) => onOpenDecision(row.original, mode)}
          />
        ),
        meta: { icon: <LuArrowRight /> }
      }
    ],
    [
      selectionEnabled,
      coverage,
      taskCoverageStatus,
      changeNoticeStatus,
      canUpdate,
      selectedKeys,
      onToggleSelection,
      controlsFor,
      onOpenDecision,
      t
    ]
  );
  const renderContextMenu = useCallback(
    (candidate: Candidate) => {
      const controls = controlsFor(candidate);
      const href = sourceHref(candidate);
      return (
        <>
          {controls.assess && (
            <MenuItem onClick={() => onOpenDecision(candidate, "assess")}>
              <MenuIcon icon={<LuCircleCheck />} />
              <Trans>Assess</Trans>
            </MenuItem>
          )}
          {controls.reassess && (
            <MenuItem onClick={() => onOpenDecision(candidate, "reassess")}>
              <MenuIcon icon={<LuRefreshCw />} />
              <Trans>Reassess</Trans>
            </MenuItem>
          )}
          {controls.resolve && (
            <MenuItem
              disabled={controls.resolveBlock !== null}
              onClick={() => onOpenDecision(candidate, "resolve")}
            >
              <MenuIcon icon={<LuCircleCheck />} />
              <Trans>Resolve</Trans>
            </MenuItem>
          )}
          {canViewChangeNoticeImpactHistory(candidate) && (
            <MenuItem onClick={() => onOpenHistory(candidate)}>
              <MenuIcon icon={<LuHistory />} />
              <Trans>History</Trans>
            </MenuItem>
          )}
          {href && (
            <MenuItem asChild>
              <Link to={href}>
                <MenuIcon icon={<LuLink />} />
                <Trans>Open Source</Trans>
              </Link>
            </MenuItem>
          )}
        </>
      );
    },
    [controlsFor, onOpenDecision, onOpenHistory]
  );
  // Expansion is index-keyed inside Table; reset it only when visible row order
  // changes, never on a checkbox change or an ordinary same-row revalidation.
  const rowOrderKey = JSON.stringify(
    orderedCandidates.map((candidate) =>
      getChangeNoticeImpactSelectionKey(
        candidate.targetType,
        candidate.targetId
      )
    )
  );
  return (
    // The shared Table hardcodes `h-full` + `contain: strict`, which collapses
    // this natural-height list. The class overrides keep the page as the only
    // scroll owner while the table still scrolls sideways in a narrow pane.
    <div className="@container w-full min-w-0 overflow-hidden [&>div]:h-auto [&_[id=table-container]]:h-auto [&_[id=table-container]]:![contain:layout_style]">
      <Table<Candidate>
        key={rowOrderKey}
        compact
        columns={columns}
        data={orderedCandidates}
        getRowId={(candidate) =>
          getChangeNoticeImpactSelectionKey(
            candidate.targetType,
            candidate.targetId
          )
        }
        withSearch={false}
        withSimpleSorting={false}
        sort={null}
        withPagination={false}
        withCsvExport={false}
        withColumnOrdering={false}
        withSidebarTrigger={false}
        withSavedView={false}
        withSelectableRows={false}
        emptyState={
          <p className="p-6 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        }
        renderContextMenu={renderContextMenu}
        renderExpandedRow={(candidate) => (
          <ImpactDetails
            candidate={candidate}
            changeNoticeId={changeNoticeId}
            actions={actions}
            coverageStatus={coverage[candidate.targetType].status}
            taskCoverageStatus={taskCoverageStatus}
            changeNoticeStatus={changeNoticeStatus}
            canUpdate={canUpdate}
            onRefresh={onRefresh}
            onOpenDecision={onOpenDecision}
            onOpenHistory={onOpenHistory}
          />
        )}
      />
    </div>
  );
}

export function groupCandidates(candidates: Candidate[]): Group[] {
  const groups = new Map<string, Group>();
  for (const candidate of candidates) {
    const documentType =
      candidate.targetType === "purchaseOrderLine" ? "purchaseOrder" : "job";
    const key = candidate.parent
      ? `${documentType}-${candidate.parent.id}`
      : `missing-${candidate.targetType}-${candidate.targetId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.candidates.push(candidate);
      continue;
    }
    groups.set(key, {
      key,
      label: candidate.parent?.readableId ?? "",
      parent: candidate.parent,
      candidates: [candidate]
    });
  }
  return [...groups.values()].sort((left, right) =>
    left.label.localeCompare(right.label)
  );
}

function coverageDomains(data: ChangeNoticeImpactWorkspaceReadModel) {
  return [
    {
      key: "purchaseOrderLine",
      label: <Trans>PO Lines</Trans>,
      coverage: data.coverage.purchaseOrderLine
    },
    { key: "job", label: <Trans>Jobs</Trans>, coverage: data.coverage.job },
    {
      key: "jobMaterial",
      label: <Trans>Materials</Trans>,
      coverage: data.coverage.jobMaterial
    }
  ];
}

function CoverageNotice({
  data
}: {
  data: ChangeNoticeImpactWorkspaceReadModel;
}) {
  const incompleteDomains = coverageDomains(data).filter(
    ({ coverage }) => coverage.status !== "complete"
  );
  if (incompleteDomains.length === 0) return null;
  return (
    <Alert variant="warning">
      <LuTriangleAlert />
      <AlertTitle>
        <Trans>Source coverage needs attention</Trans>
      </AlertTitle>
      <AlertDescription className="space-y-1">
        <p>
          <Trans>
            Incomplete domains have unavailable counts, not zero exposure.
          </Trans>
        </p>
        <ul className="space-y-1">
          {incompleteDomains.map(({ key, label, coverage }) => (
            <li key={key}>
              <span className="font-medium">{label}</span>:{" "}
              {coverage.status === "restricted" ? (
                <Trans>Restricted</Trans>
              ) : coverage.status === "partial" ? (
                <Trans>Partial</Trans>
              ) : (
                <Trans>Failed</Trans>
              )}
              {coverage.status !== "restricted" && coverage.errorMessage && (
                <span className="ml-1">{coverage.errorMessage}</span>
              )}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function CoverageCount({ value }: { value: number | null }) {
  const formatter = useNumberFormatter();
  return value === null ? <Trans>Unavailable</Trans> : formatter.format(value);
}

function CoverageSummary({
  data
}: {
  data: ChangeNoticeImpactWorkspaceReadModel;
}) {
  const domains = coverageDomains(data);
  const counts = domains.map(({ coverage }) => coverage.unassessedCount);
  const toAssess = counts.every((count) => count !== null)
    ? counts.reduce<number>((sum, count) => sum + (count ?? 0), 0)
    : null;
  return (
    <CardAttributes className="grid grid-cols-2 gap-x-6 gap-y-3 @lg:grid-cols-5">
      {domains.map(({ key, label, coverage }) => (
        <CardAttribute
          key={key}
          className="flex-col items-start gap-1 md:items-start"
        >
          <CardAttributeLabel>{label}</CardAttributeLabel>
          <CardAttributeValue className="text-sm font-medium tabular-nums">
            <CoverageCount value={coverage.currentExposureCount} />
          </CardAttributeValue>
        </CardAttribute>
      ))}
      <CardAttribute className="flex-col items-start gap-1 md:items-start">
        <CardAttributeLabel>
          <Trans>To Assess</Trans>
        </CardAttributeLabel>
        <CardAttributeValue className="text-sm font-medium tabular-nums">
          <CoverageCount value={toAssess} />
        </CardAttributeValue>
      </CardAttribute>
      <CardAttribute className="flex-col items-start gap-1 md:items-start">
        <CardAttributeLabel>
          <Trans>Source Coverage</Trans>
        </CardAttributeLabel>
        <CardAttributeValue className="text-sm font-medium">
          {domains.every(({ coverage }) => coverage.status === "complete") ? (
            // Incomplete coverage is explained by the alert above; only the
            // quiet healthy state needs a marker here.
            <Trans>Complete</Trans>
          ) : (
            <span className="text-muted-foreground">
              <Trans>Unavailable</Trans>
            </span>
          )}
        </CardAttributeValue>
      </CardAttribute>
    </CardAttributes>
  );
}

function isCurrent(candidate: Candidate) {
  return (
    candidate.sourceAvailability !== "Unavailable" &&
    candidate.exposureClassification === CURRENT_EXPOSURE
  );
}

function isHistorical(candidate: Candidate) {
  return (
    candidate.sourceAvailability !== "Unavailable" &&
    (candidate.exposureClassification === HISTORICAL_REFERENCE ||
      candidate.exposureClassification === NO_LONGER_IN_SCOPE ||
      candidate.sourceAvailability === "Source deleted")
  );
}

function isUnavailable(candidate: Candidate) {
  return (
    candidate.sourceAvailability === "Unavailable" ||
    (candidate.exposureClassification === null && !isHistorical(candidate))
  );
}

export default function ChangeNoticeImpactWorkspace({
  id,
  changeNotice,
  data,
  actions
}: WorkspaceProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const revalidator = useRevalidator();
  const [params] = useUrlParams();
  const [decisionTarget, setDecisionTarget] = useState<{
    candidate: Candidate;
    mode: ChangeNoticeImpactDecisionMode;
  } | null>(null);
  const [historyTarget, setHistoryTarget] = useState<Candidate | null>(null);
  const [decisionConflictMessage, setDecisionConflictMessage] = useState<
    string | null
  >(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkSuccess, setBulkSuccess] =
    useState<ChangeNoticeImpactDecisionBulkWriteData | null>(null);
  const refreshFetcher = useFetcher<ImpactRefreshFetcherData>();
  const canUpdate = permissions.can("update", "parts") ?? false;
  const isRefreshing =
    refreshFetcher.state !== "idle" || revalidator.state !== "idle";
  const handleRefresh = useCallback(() => {
    // A mutation fetcher gives React Router its normal post-action
    // revalidation. Read-only viewers keep the old GET-only refresh path.
    refreshChangeNoticeImpactWorkspace({
      canUpdate,
      id,
      submit: refreshFetcher.submit,
      revalidate: revalidator.revalidate
    });
  }, [canUpdate, id, revalidator, refreshFetcher]);
  const search = params.get("search") ?? "";
  const filters = getImpactFilterValues(params.getAll("filter"));
  const coverageHasWarning = [
    data.coverage.purchaseOrderLine,
    data.coverage.job,
    data.coverage.jobMaterial
  ].some((coverage) => coverage.status !== "complete");
  const hasDisplayFilters = hasImpactDisplayFilters(search, filters);
  const filteredCandidates = filterChangeNoticeImpactCandidates({
    candidates: data.candidates,
    search,
    filters,
    coverage: data.coverage,
    taskCoverageStatus: data.taskCoverage.status
  });
  const filteredEmptyState = getImpactFilteredEmptyState({
    candidateCount: filteredCandidates.length,
    hasDisplayFilters,
    coverageHasWarning:
      coverageHasWarning ||
      hasIncompleteImpactTaskFilter(filters, data.taskCoverage.status)
  });
  const currentCandidates = filteredCandidates.filter(isCurrent);
  const historicalCandidates = filteredCandidates.filter(isHistorical);
  const unavailableCandidates = filteredCandidates.filter(isUnavailable);
  const taskCoverageHasWarning = data.taskCoverage.status !== "complete";
  const status = changeNotice?.status ?? data.changeNoticeStatus;
  const selectedCandidates = useMemo(() => {
    const byKey = new Map(
      data.candidates.map((candidate) => [
        getChangeNoticeImpactSelectionKey(
          candidate.targetType,
          candidate.targetId
        ),
        candidate
      ])
    );
    return [...selectedKeys].flatMap((key) => {
      const candidate = byKey.get(key);
      return candidate ? [candidate] : [];
    });
  }, [data.candidates, selectedKeys]);
  const hasMissingSelectedCandidates =
    selectedCandidates.length !== selectedKeys.size;
  const hasIneligibleSelectedCandidates = selectedCandidates.some(
    (candidate) =>
      !canSelectChangeNoticeImpactCandidate({
        candidate,
        coverageStatus: data.coverage[candidate.targetType].status,
        taskCoverageStatus: data.taskCoverage.status,
        changeNoticeStatus: status,
        canUpdate
      })
  );
  const selectedBulkDecisionStatusOptions =
    !hasMissingSelectedCandidates && !hasIneligibleSelectedCandidates
      ? getChangeNoticeImpactBulkDecisionStatusOptions({
          candidates: selectedCandidates,
          coverage: data.coverage,
          taskCoverageStatus: data.taskCoverage.status,
          changeNoticeStatus: status
        })
      : [];
  const hasNoCommonBulkDecision =
    selectedKeys.size > 0 &&
    !hasMissingSelectedCandidates &&
    !hasIneligibleSelectedCandidates &&
    selectedCandidates.length > 0 &&
    selectedBulkDecisionStatusOptions.length === 0;
  const bulkSelectionBlocked =
    hasMissingSelectedCandidates ||
    hasIneligibleSelectedCandidates ||
    hasNoCommonBulkDecision;
  const openDecision = useCallback(
    (candidate: Candidate, mode: ChangeNoticeImpactDecisionMode) => {
      setDecisionConflictMessage(null);
      setBulkSuccess(null);
      setDecisionTarget({ candidate, mode });
    },
    []
  );
  const closeDecision = useCallback(() => setDecisionTarget(null), []);
  const openHistory = useCallback((candidate: Candidate) => {
    setHistoryTarget(candidate);
  }, []);
  const closeHistory = useCallback(() => setHistoryTarget(null), []);
  const toggleSelection = useCallback(
    (candidate: Candidate, selected: boolean) => {
      const key = getChangeNoticeImpactSelectionKey(
        candidate.targetType,
        candidate.targetId
      );
      setBulkSuccess(null);
      setSelectedKeys((current) => {
        const next = new Set(current);
        if (selected) next.add(key);
        else next.delete(key);
        return next;
      });
    },
    []
  );
  const clearSelection = useCallback(() => {
    setSelectedKeys(new Set());
    setBulkModalOpen(false);
  }, []);
  const openBulkModal = useCallback(() => {
    setDecisionConflictMessage(null);
    setBulkSuccess(null);
    setBulkModalOpen(true);
  }, []);
  const handleBulkSuccess = useCallback(
    (result: ChangeNoticeImpactDecisionBulkWriteData) => {
      setBulkModalOpen(false);
      setSelectedKeys(new Set());
      setBulkSuccess(result);
    },
    []
  );
  const handleBulkConflict = useCallback((message: string) => {
    setBulkModalOpen(false);
    setDecisionConflictMessage(message);
  }, []);
  const handleDecisionSuccess = useCallback(() => {
    setDecisionTarget(null);
    setBulkSuccess(null);
    revalidator.revalidate();
  }, [revalidator]);
  const handleDecisionConflict = useCallback(
    (message: string) => {
      setDecisionTarget(null);
      setDecisionConflictMessage(message);
      revalidator.revalidate();
    },
    [revalidator]
  );
  const handleTaskMutation = useCallback(() => {
    revalidator.revalidate();
  }, [revalidator]);
  const selectionContent = (
    <div
      role="group"
      aria-label={t`Bulk Impact selection`}
      className="ml-auto flex flex-wrap items-center justify-end gap-2"
    >
      <span className="text-xs text-muted-foreground tabular-nums">
        <Plural value={selectedKeys.size} one="# selected" other="# selected" />
      </span>
      {selectedKeys.size > 0 && (
        <>
          <Button
            type="button"
            size="sm"
            variant="primary"
            onClick={openBulkModal}
            isDisabled={bulkSelectionBlocked || selectedCandidates.length === 0}
          >
            <Trans>Review Selected</Trans>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={clearSelection}
          >
            <Trans>Clear Selection</Trans>
          </Button>
        </>
      )}
    </div>
  );
  const selectionNotices = selectedKeys.size > 0 && (
    <div className="space-y-1">
      {hasMissingSelectedCandidates && (
        <div className="text-xs text-amber-700 dark:text-amber-300">
          <Trans>
            A selected row is no longer readable in the current workspace.
            Refresh and review the selection.
          </Trans>
        </div>
      )}
      {hasIneligibleSelectedCandidates && (
        <div className="text-xs text-amber-700 dark:text-amber-300">
          <Trans>
            One or more selected rows are no longer eligible for a bulk
            assessment. Refresh and review the selection.
          </Trans>
        </div>
      )}
      {hasNoCommonBulkDecision && (
        <div className="text-xs text-amber-700 dark:text-amber-300">
          <Trans>
            The selected rows do not share an available conclusion. Adjust the
            selection before reviewing it.
          </Trans>
        </div>
      )}
    </div>
  );

  return (
    <VStack spacing={4} className="mx-auto w-full max-w-[1400px] p-4">
      <Card className="w-full">
        <HStack className="w-full items-start justify-between">
          <CardHeader className="min-w-0 flex-1 pb-3">
            <CardTitle className="text-base">
              <Trans>Operational Impact</Trans>
            </CardTitle>
          </CardHeader>
          <CardAction className="shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  type="button"
                  aria-label={t`Refresh`}
                  icon={<LuRefreshCw />}
                  variant="secondary"
                  onClick={handleRefresh}
                  isDisabled={isRefreshing}
                  isLoading={isRefreshing}
                />
              </TooltipTrigger>
              <TooltipContent>
                <Trans>Refresh</Trans>
              </TooltipContent>
            </Tooltip>
          </CardAction>
        </HStack>
        <CardContent className="@container gap-3">
          <CoverageSummary data={data} />
          {status === "Cancelled" && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">
                <Trans>Assessment locked</Trans>
              </span>
              {" · "}
              <Trans>Existing follow-up and resolution remain available.</Trans>
            </p>
          )}
        </CardContent>
      </Card>

      {bulkSuccess && (
        <div
          role="status"
          className="w-full rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
        >
          {bulkSuccess.noOpCount > 0 ? (
            <>
              <Plural
                value={bulkSuccess.appliedCount}
                one="Impact updated for # target;"
                other="Impact updated for # targets;"
              />{" "}
              <Plural
                value={bulkSuccess.noOpCount}
                one="# target was already current."
                other="# targets were already current."
              />
            </>
          ) : (
            <Plural
              value={bulkSuccess.appliedCount}
              one="Impact updated for # target."
              other="Impact updated for # targets."
            />
          )}
        </div>
      )}

      {decisionConflictMessage && (
        <div
          role="alert"
          className="w-full rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
        >
          <div className="font-medium">
            <Trans>Impact assessment changed while you were editing.</Trans>
          </div>
          <div>{decisionConflictMessage}</div>
          <div>
            <Trans>
              The editor was closed and the workspace was refreshed. Review the
              current state before submitting again.
            </Trans>
          </div>
        </div>
      )}

      <CoverageNotice data={data} />
      {taskCoverageHasWarning && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          <Trans>
            Linked task coverage is incomplete. Decision state is independent of
            task status.
          </Trans>
        </div>
      )}

      <section
        aria-labelledby="impact-current-heading"
        className="w-full space-y-3"
      >
        <h2 id="impact-current-heading" className="text-sm font-medium">
          <Trans>Current Operational Exposure</Trans>
        </h2>
        <div className="w-full min-w-0 overflow-hidden rounded-lg border border-border bg-card">
          <ChangeNoticeImpactFilterBar
            taskCoverageStatus={data.taskCoverage.status}
            selectionContent={selectionContent}
            selectionNotices={selectionNotices}
          />
          <ImpactTable
            changeNoticeId={id}
            candidates={currentCandidates}
            actions={actions}
            coverage={data.coverage}
            taskCoverageStatus={data.taskCoverage.status}
            changeNoticeStatus={status}
            canUpdate={canUpdate}
            onRefresh={handleTaskMutation}
            onOpenDecision={openDecision}
            onOpenHistory={openHistory}
            selectionEnabled
            selectedKeys={selectedKeys}
            onToggleSelection={toggleSelection}
            emptyMessage={
              filteredEmptyState === "incomplete" ? (
                <Trans>
                  No matching loaded Impact rows are visible. Coverage is
                  incomplete, so this is not a complete result.
                </Trans>
              ) : filteredEmptyState === "complete" ? (
                <Trans>
                  No Impact rows match the current search and filters.
                </Trans>
              ) : hasDisplayFilters ? (
                <Trans>No current exposure matches these filters.</Trans>
              ) : coverageHasWarning ? (
                <Trans>No complete current result is available.</Trans>
              ) : (
                <Trans>No current operational exposure is available.</Trans>
              )
            }
          />
        </div>
      </section>

      {historicalCandidates.length > 0 && (
        <section
          aria-labelledby="impact-historical-heading"
          className="w-full space-y-2"
        >
          <h2 id="impact-historical-heading" className="text-sm font-medium">
            <Trans>Historical References</Trans>
          </h2>
          <p className="text-xs text-muted-foreground">
            <Trans>Traceable references; no new Unassessed obligation.</Trans>
          </p>
          <div className="overflow-hidden rounded-lg border border-border">
            <ImpactTable
              changeNoticeId={id}
              candidates={historicalCandidates}
              actions={actions}
              coverage={data.coverage}
              taskCoverageStatus={data.taskCoverage.status}
              changeNoticeStatus={status}
              canUpdate={canUpdate}
              onRefresh={handleTaskMutation}
              onOpenDecision={openDecision}
              onOpenHistory={openHistory}
              selectionEnabled={false}
              selectedKeys={selectedKeys}
              onToggleSelection={toggleSelection}
            />
          </div>
        </section>
      )}

      {unavailableCandidates.length > 0 && (
        <section
          aria-labelledby="impact-unavailable-heading"
          className="w-full space-y-2"
        >
          <h2 id="impact-unavailable-heading" className="text-sm font-medium">
            <Trans>Unavailable Source Rows</Trans>
          </h2>
          <p className="text-xs text-muted-foreground">
            <Trans>
              Authorized identities only. Source facts remain unavailable.
            </Trans>
          </p>
          <div className="overflow-hidden rounded-lg border border-border">
            <ImpactTable
              changeNoticeId={id}
              candidates={unavailableCandidates}
              actions={actions}
              coverage={data.coverage}
              taskCoverageStatus={data.taskCoverage.status}
              changeNoticeStatus={status}
              canUpdate={canUpdate}
              onRefresh={handleTaskMutation}
              onOpenDecision={openDecision}
              onOpenHistory={openHistory}
              selectionEnabled={false}
              selectedKeys={selectedKeys}
              onToggleSelection={toggleSelection}
            />
          </div>
        </section>
      )}

      {bulkModalOpen &&
        !bulkSelectionBlocked &&
        selectedCandidates.length > 0 && (
          <ImpactBulkDecisionModal
            changeNoticeId={id}
            candidates={selectedCandidates}
            coverage={data.coverage}
            taskCoverageStatus={data.taskCoverage.status}
            changeNoticeStatus={status}
            onClose={() => setBulkModalOpen(false)}
            onSuccess={handleBulkSuccess}
            onConflict={handleBulkConflict}
          />
        )}

      {decisionTarget && (
        <ImpactDecisionModal
          key={`${decisionTarget.candidate.targetType}-${decisionTarget.candidate.targetId}-${decisionTarget.mode}-${decisionTarget.candidate.decision?.revision ?? "new"}`}
          changeNoticeId={id}
          candidate={decisionTarget.candidate}
          mode={decisionTarget.mode}
          coverageStatus={
            data.coverage[decisionTarget.candidate.targetType].status
          }
          taskCoverageStatus={data.taskCoverage.status}
          changeNoticeStatus={status}
          onClose={closeDecision}
          onSuccess={handleDecisionSuccess}
          onConflict={handleDecisionConflict}
        />
      )}
      {historyTarget && (
        <ChangeNoticeImpactHistory
          key={`${historyTarget.targetType}-${historyTarget.targetId}-${historyTarget.decision?.revision ?? "new"}`}
          changeNoticeId={id}
          candidate={historyTarget}
          actions={actions}
          onClose={closeHistory}
        />
      )}
    </VStack>
  );
}
