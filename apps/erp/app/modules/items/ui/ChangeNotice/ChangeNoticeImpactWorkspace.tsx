import { ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack
} from "@carbon/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuChevronRight,
  LuExternalLink,
  LuHistory,
  LuRefreshCw,
  LuTriangle
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
import ChangeNoticeStatus from "./ChangeNoticeStatus";

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
      return <Trans>Purchase Order line</Trans>;
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
    <Badge variant="outline" className="whitespace-nowrap">
      {decisionLabel(status)}
    </Badge>
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
  if (candidate.freshness === "Changed since assessment") {
    badges.push(
      <Badge
        key="freshness"
        variant="outline"
        className="whitespace-nowrap border-orange-500/50 text-orange-700 dark:text-orange-300"
      >
        <Trans>Changed since assessment</Trans>
      </Badge>
    );
  } else if (candidate.freshness === "Unknown") {
    badges.push(
      <Badge
        key="freshness"
        variant="outline"
        className="whitespace-nowrap border-amber-500/50 text-amber-700 dark:text-amber-300"
      >
        <Trans>Freshness unavailable</Trans>
      </Badge>
    );
  }
  return badges;
}

function sourceLink(candidate: Candidate) {
  if (!candidate.parent || candidate.sourceAvailability !== "Present") {
    return null;
  }
  const href =
    candidate.targetType === "purchaseOrderLine"
      ? path.to.purchaseOrderLine(candidate.parent.id, candidate.targetId)
      : candidate.targetType === "job"
        ? path.to.job(candidate.parent.id)
        : path.to.jobMaterials(candidate.parent.id);
  return (
    <Link
      to={href}
      className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
    >
      <LuExternalLink className="size-3" />
      <Trans>Open source</Trans>
    </Link>
  );
}

function provenanceLabel(label: string | null): ReactNode {
  return label ?? <Trans>Affected item</Trans>;
}

function Provenance({ candidate }: { candidate: Candidate }) {
  if (candidate.provenance.length === 0) return null;
  return (
    <details className="group rounded-md border border-border/70 px-3 py-2 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1 font-medium [&::-webkit-details-marker]:hidden">
        <LuChevronRight className="size-3 transition-transform group-open:rotate-90" />
        <Trans>Provenance</Trans>
      </summary>
      <div className="mt-2 space-y-2 pl-4">
        {candidate.currentProvenance.length > 0 && (
          <div>
            <div className="text-muted-foreground">
              <Trans>Current cause</Trans>
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
              <Trans>Historical causes</Trans>
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
            <Trans>No-action reason</Trans>:
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
            <Trans>Resolution note</Trans>:
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
    <details className="group rounded-md border border-border/70 px-3 py-2 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1 font-medium [&::-webkit-details-marker]:hidden">
        <LuChevronRight className="size-3 transition-transform group-open:rotate-90" />
        {candidate.freshness === "Changed since assessment" ? (
          <Trans>Assessment snapshot · changed</Trans>
        ) : (
          <Trans>Assessment snapshot</Trans>
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

type ImpactDecisionDrawerProps = {
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

function ImpactDecisionDrawer({
  changeNoticeId,
  candidate,
  mode,
  coverageStatus,
  taskCoverageStatus,
  changeNoticeStatus,
  onClose,
  onSuccess,
  onConflict
}: ImpactDecisionDrawerProps) {
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
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent size="sm">
        <ValidatedForm
          key={`${candidate.targetType}-${candidate.targetId}-${mode}-${decision?.revision ?? "new"}`}
          validator={changeNoticeImpactDecisionFormValidator}
          method="post"
          action={path.to.changeNoticeImpactDecision(changeNoticeId)}
          defaultValues={formDefaults}
          fetcher={fetcher}
          className="flex h-full flex-col"
        >
          <DrawerHeader>
            <DrawerTitle>
              {mode === "resolve" ? (
                <Trans>Resolve operational impact</Trans>
              ) : decision ? (
                <Trans>Reassess operational impact</Trans>
              ) : (
                <Trans>Assess operational impact</Trans>
              )}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={4}>
              <Hidden name="changeNoticeId" value={changeNoticeId} />
              <Hidden name="targetType" value={candidate.targetType} />
              <Hidden name="targetId" value={candidate.targetId} />
              {decision && (
                <Hidden name="expectedRevision" value={decision.revision} />
              )}

              <div className="w-full space-y-2 rounded-md bg-muted/40 p-3 text-xs">
                <div className="font-medium">
                  {domainLabel(candidate.targetType)} · {candidate.targetId}
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
                  label={t`No-action reason`}
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
                  label={t`Confirm no purchasing intervention remains`}
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
                      ? t`New follow-up rationale`
                      : t`Follow-up rationale`
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
                      ? t`Correction rationale`
                      : t`Review rationale`
                  }
                  value={rationale}
                  onChange={setRationale}
                  isRequired
                />
              )}
              {decisionStatus === "Resolved" && (
                <TextArea
                  name="resolutionNote"
                  label={t`Closure evidence`}
                  isRequired
                />
              )}

              {resolveBlocked && (
                <div
                  role="alert"
                  className="w-full rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
                >
                  {resolutionControls.resolveBlock === "taskCoverage" ? (
                    <Trans>
                      Resolution is unavailable until linked task coverage is
                      complete.
                    </Trans>
                  ) : (
                    <Trans>
                      Every linked task must be Completed or Skipped before this
                      Impact can be resolved.
                    </Trans>
                  )}
                </div>
              )}
              {failedResponse?.error?.message && (
                <div
                  role="alert"
                  className="w-full rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                >
                  {failedResponse.error.message}
                </div>
              )}
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={resolveBlocked} isLoading={isSubmitting}>
                {mode === "resolve" ? (
                  <Trans>Resolve</Trans>
                ) : mode === "assess" ? (
                  <Trans>Save assessment</Trans>
                ) : (
                  <Trans>Save reassessment</Trans>
                )}
              </Submit>
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                isDisabled={isSubmitting}
              >
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
}

type ImpactBulkDecisionDrawerProps = {
  changeNoticeId: string;
  candidates: Candidate[];
  coverage: ChangeNoticeImpactWorkspaceReadModel["coverage"];
  taskCoverageStatus: ChangeNoticeImpactWorkspaceReadModel["taskCoverage"]["status"];
  changeNoticeStatus: ChangeNotice["status"] | null | undefined;
  onClose: () => void;
  onSuccess: (data: ChangeNoticeImpactDecisionBulkWriteData) => void;
  onConflict: (message: string) => void;
};

function ImpactBulkDecisionDrawer({
  changeNoticeId,
  candidates,
  coverage,
  taskCoverageStatus,
  changeNoticeStatus,
  onClose,
  onSuccess,
  onConflict
}: ImpactBulkDecisionDrawerProps) {
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
  const selectedTargetLabel = (candidate: Candidate) => (
    <div className="min-w-0">
      <div className="font-medium">
        {domainLabel(candidate.targetType)} · {candidate.targetId}
      </div>
      <div className="text-xs text-muted-foreground">
        {candidate.parent?.readableId ?? (
          <Trans>Source record unavailable</Trans>
        )}
        {candidate.item?.readableIdWithRevision
          ? ` · ${candidate.item.readableIdWithRevision}`
          : ""}
      </div>
    </div>
  );

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent size="sm">
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
          className="flex h-full flex-col"
        >
          <DrawerHeader>
            <DrawerTitle>
              <Trans>Review bulk Impact assessment</Trans>
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={4}>
              <Hidden name="changeNoticeId" value={changeNoticeId} />
              <Hidden name="targets" value={JSON.stringify(formTargets)} />

              <div className="w-full space-y-2 rounded-md bg-muted/40 p-3 text-xs">
                <div className="font-medium">
                  <Trans>{candidates.length} selected targets</Trans>
                </div>
                <p className="text-muted-foreground">
                  <Trans>
                    The server will recheck every target and reject the whole
                    batch if any source fact, eligibility rule, or decision
                    revision changed after this preview.
                  </Trans>
                </p>
              </div>

              <div className="max-h-64 w-full space-y-2 overflow-y-auto rounded-md border border-border/70 p-2">
                {candidates.map((candidate) => (
                  <div
                    key={`${candidate.targetType}-${candidate.targetId}`}
                    className="space-y-2 rounded-md border border-border/70 p-2"
                  >
                    {selectedTargetLabel(candidate)}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-muted-foreground">
                        <Trans>Current conclusion</Trans>:
                      </span>
                      {stateBadge(
                        candidate,
                        coverage[candidate.targetType].status
                      )}
                      {conditionBadges(candidate)}
                    </div>
                    <SnapshotFacts candidate={candidate} />
                  </div>
                ))}
              </div>

              <Select
                name="decisionStatus"
                label={t`Conclusion for every selected target`}
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
                  label={t`No-action reason for every selected target`}
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
                  label={t`Confirm no purchasing intervention remains for every selected target`}
                  description={t`Supplier return, replacement, credit, and communication interventions have been reviewed.`}
                />
              )}

              {decisionStatus === "Resolved" ? (
                <TextArea
                  name="resolutionNote"
                  label={t`Closure evidence for every selected target`}
                  isRequired
                />
              ) : (
                <TextAreaControlled
                  name="rationale"
                  label={
                    decisionStatus === "No action required"
                      ? t`Review rationale for every selected target`
                      : t`Follow-up rationale for every selected target`
                  }
                  value={rationale}
                  onChange={setRationale}
                  isRequired
                />
              )}

              {failedResponse?.error?.message && (
                <div
                  role="alert"
                  className="w-full rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                >
                  {failedResponse.error.message}
                </div>
              )}
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isLoading={isSubmitting}>
                <Trans>Apply to {candidates.length}</Trans>
              </Submit>
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                isDisabled={isSubmitting}
              >
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
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

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
      {controls.assess && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onOpen("assess")}
        >
          <Trans>Assess</Trans>
        </Button>
      )}
      {controls.reassess && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onOpen("reassess")}
        >
          <Trans>Reassess</Trans>
        </Button>
      )}
      {controls.resolve && (
        <Button
          type="button"
          size="sm"
          variant="primary"
          isDisabled={controls.resolveBlock !== null}
          onClick={() => onOpen("resolve")}
        >
          <Trans>Resolve</Trans>
        </Button>
      )}
      {controls.resolveBlock === "taskCoverage" && (
        <span className="text-xs text-amber-700 dark:text-amber-300">
          <Trans>Resolve after linked task coverage is complete.</Trans>
        </span>
      )}
      {controls.resolveBlock === "nonTerminalTask" && (
        <span className="text-xs text-amber-700 dark:text-amber-300">
          <Trans>
            Resolve after every linked task is Completed or Skipped.
          </Trans>
        </span>
      )}
    </div>
  );
}

function ImpactRow({
  changeNoticeId,
  candidate,
  actions,
  coverageStatus,
  taskCoverageStatus,
  changeNoticeStatus,
  canUpdate,
  onRefresh,
  onOpenDecision,
  onOpenHistory,
  selectionEnabled,
  isSelected,
  onToggleSelection
}: {
  changeNoticeId: string;
  candidate: Candidate;
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
  selectionEnabled: boolean;
  isSelected: boolean;
  onToggleSelection: (candidate: Candidate, selected: boolean) => void;
}) {
  const canSelect =
    selectionEnabled &&
    canSelectChangeNoticeImpactCandidate({
      candidate,
      coverageStatus,
      taskCoverageStatus,
      changeNoticeStatus,
      canUpdate
    });
  const itemLabel = candidate.item?.readableIdWithRevision ??
    candidate.item?.readableId ?? <Trans>Item details unavailable</Trans>;
  const badges = conditionBadges(candidate);

  return (
    <div className="space-y-3 rounded-md border border-border/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {(canSelect || isSelected) && (
            <IndeterminateCheckbox
              checked={isSelected}
              indeterminate={false}
              disabled={!canSelect}
              aria-label={`Select ${candidate.targetType} ${candidate.targetId}`}
              onChange={(selected) => onToggleSelection(candidate, selected)}
            />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {domainLabel(candidate.targetType)}
              </span>
              {stateBadge(candidate, coverageStatus)}
              {badges}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {candidate.parent && (
                <span className="inline-flex items-center gap-1">
                  <span>{candidate.parent.readableId}</span>
                  <ParentStatus parent={candidate.parent} />
                </span>
              )}
              {candidate.parent?.type === "purchaseOrder" &&
                candidate.parent.supplierName && (
                  <span>
                    <Trans>Supplier</Trans>: {candidate.parent.supplierName}
                  </span>
                )}
              <span>{itemLabel}</span>
            </div>
          </div>
        </div>
        {(sourceLink(candidate) ||
          canViewChangeNoticeImpactHistory(candidate)) && (
          <div className="flex shrink-0 items-center gap-1">
            {sourceLink(candidate)}
            {canViewChangeNoticeImpactHistory(candidate) && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onOpenHistory(candidate)}
              >
                <LuHistory className="size-3.5" />
                <Trans>History</Trans>
              </Button>
            )}
          </div>
        )}
      </div>
      <SnapshotFacts candidate={candidate} />
      {candidate.unavailableReason && (
        <div className="text-xs text-amber-700 dark:text-amber-300">
          {candidate.unavailableReason}
        </div>
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

function DocumentGroups({
  changeNoticeId,
  candidates,
  actions,
  emptyMessage,
  coverage,
  taskCoverageStatus,
  changeNoticeStatus,
  canUpdate,
  onRefresh,
  onOpenDecision,
  onOpenHistory,
  selectionEnabled,
  selectedKeys,
  onToggleSelection
}: {
  changeNoticeId: string;
  candidates: Candidate[];
  actions: ChangeNoticeActionTask[];
  emptyMessage: ReactNode;
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
}) {
  const groups = groupCandidates(candidates);
  if (groups.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <Card key={group.key}>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm">
                {group.label || <Trans>Source record unavailable</Trans>}
              </CardTitle>
              {group.parent && (
                <span className="text-xs text-muted-foreground">
                  <ParentStatus parent={group.parent} />
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {group.candidates.map((candidate) => (
              <ImpactRow
                key={`${candidate.targetType}-${candidate.targetId}`}
                changeNoticeId={changeNoticeId}
                candidate={candidate}
                actions={actions}
                coverageStatus={coverage[candidate.targetType].status}
                taskCoverageStatus={taskCoverageStatus}
                changeNoticeStatus={changeNoticeStatus}
                canUpdate={canUpdate}
                onRefresh={onRefresh}
                onOpenDecision={onOpenDecision}
                onOpenHistory={onOpenHistory}
                selectionEnabled={selectionEnabled}
                isSelected={selectedKeys.has(
                  getChangeNoticeImpactSelectionKey(
                    candidate.targetType,
                    candidate.targetId
                  )
                )}
                onToggleSelection={onToggleSelection}
              />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CoverageNotice({
  label,
  coverage
}: {
  label: ReactNode;
  coverage: ChangeNoticeImpactCoverage;
}) {
  if (coverage.status === "complete") return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
      <LuTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">
          {coverage.status === "restricted" ? (
            <Trans>
              This source domain is restricted for your current permissions. No
              target identities or source facts are shown.
            </Trans>
          ) : coverage.status === "partial" ? (
            <Trans>
              Coverage is partial. Counts and source-deletion conclusions are
              withheld where the scan could not be completed.
            </Trans>
          ) : (
            <Trans>
              Coverage failed. This is not an empty or safe result; refresh
              after the source is available.
            </Trans>
          )}
        </div>
        {coverage.errorMessage && (
          <div className="mt-1 text-xs text-muted-foreground">
            {coverage.errorMessage}
          </div>
        )}
      </div>
    </div>
  );
}

function CoverageCount({ value }: { value: number | null }) {
  const { locale } = useLocale();
  return value === null ? (
    <Trans>Unavailable</Trans>
  ) : (
    value.toLocaleString(locale)
  );
}

function CoverageSummary({
  data
}: {
  data: ChangeNoticeImpactWorkspaceReadModel;
}) {
  const domains = [
    {
      key: "purchaseOrderLine" as const,
      label: <Trans>Purchase Order lines</Trans>,
      coverage: data.coverage.purchaseOrderLine
    },
    {
      key: "job" as const,
      label: <Trans>Producing Jobs</Trans>,
      coverage: data.coverage.job
    },
    {
      key: "jobMaterial" as const,
      label: <Trans>Job Materials</Trans>,
      coverage: data.coverage.jobMaterial
    }
  ];
  return (
    <section aria-labelledby="impact-coverage-heading" className="w-full">
      <h2 id="impact-coverage-heading" className="sr-only">
        <Trans>Assessment coverage</Trans>
      </h2>
      <div className="grid gap-2 md:grid-cols-3">
        {domains.map(({ key, label, coverage }) => (
          <Card key={key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{label}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">
                  <Trans>Current</Trans>
                </div>
                <div className="text-lg font-semibold">
                  <CoverageCount value={coverage.currentExposureCount} />
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">
                  <Trans>Historical</Trans>
                </div>
                <div className="text-lg font-semibold">
                  <CoverageCount value={coverage.historicalReferenceCount} />
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">
                  <Trans>Unassessed</Trans>
                </div>
                <div className="text-lg font-semibold">
                  <CoverageCount value={coverage.unassessedCount} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
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
  const [bulkDrawerOpen, setBulkDrawerOpen] = useState(false);
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
  const currentPurchaseOrderCandidates = currentCandidates.filter(
    (candidate) => candidate.targetType === "purchaseOrderLine"
  );
  const currentProductionCandidates = currentCandidates.filter(
    (candidate) =>
      candidate.targetType === "job" || candidate.targetType === "jobMaterial"
  );
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
    setBulkDrawerOpen(false);
  }, []);
  const openBulkDrawer = useCallback(() => {
    setDecisionConflictMessage(null);
    setBulkSuccess(null);
    setBulkDrawerOpen(true);
  }, []);
  const handleBulkSuccess = useCallback(
    (result: ChangeNoticeImpactDecisionBulkWriteData) => {
      setBulkDrawerOpen(false);
      setSelectedKeys(new Set());
      setBulkSuccess(result);
    },
    []
  );
  const handleBulkConflict = useCallback((message: string) => {
    setBulkDrawerOpen(false);
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
      aria-label="Bulk Impact selection"
      className="ml-auto flex flex-wrap items-center justify-end gap-2"
    >
      <span className="text-xs text-muted-foreground tabular-nums">
        <Trans>{selectedKeys.size} selected</Trans>
      </span>
      {selectedKeys.size > 0 && (
        <>
          <Button
            type="button"
            size="sm"
            variant="primary"
            onClick={openBulkDrawer}
            isDisabled={bulkSelectionBlocked || selectedCandidates.length === 0}
          >
            <Trans>Review selected</Trans>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={clearSelection}
          >
            <Trans>Clear selection</Trans>
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
          <CardHeader className="min-w-0 flex-1">
            <Link
              to={path.to.changeNoticeDetails(id)}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <LuChevronRight className="size-3 rotate-180" />
              <Trans>Back to Change Notice</Trans>
            </Link>
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
        <CardContent className="gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>
              <Trans>Operational Impact</Trans>
            </CardTitle>
            {status && <ChangeNoticeStatus status={status} />}
          </div>
          <CardDescription className="flex flex-wrap gap-x-2">
            <span>
              {changeNotice?.changeOrderId ?? <Trans>Change Notice</Trans>}
            </span>
            {changeNotice?.name && <span>· {changeNotice.name}</span>}
          </CardDescription>
          {status === "Done" && (
            <CardDescription className="text-emerald-700 dark:text-emerald-300">
              <Trans>
                Done · Engineering released. Operational assessment remains
                available.
              </Trans>
            </CardDescription>
          )}
          {status === "Cancelled" && (
            <CardDescription className="text-amber-700 dark:text-amber-300">
              <Trans>
                Cancelled · New Impact assessment is locked. Existing
                operational follow-up remains available.
              </Trans>
            </CardDescription>
          )}
        </CardContent>
      </Card>

      {bulkSuccess && (
        <div
          role="status"
          className="w-full rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
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
          className="w-full rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
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

      {coverageHasWarning && (
        <div className="space-y-2">
          <CoverageNotice
            label={<Trans>Assessment coverage needs attention</Trans>}
            coverage={
              [
                data.coverage.purchaseOrderLine,
                data.coverage.job,
                data.coverage.jobMaterial
              ].find((coverage) => coverage.status !== "complete") ??
              data.coverage.purchaseOrderLine
            }
          />
          <div className="grid gap-2 md:grid-cols-3">
            <CoverageNotice
              label={<Trans>Purchase Order lines</Trans>}
              coverage={data.coverage.purchaseOrderLine}
            />
            <CoverageNotice
              label={<Trans>Producing Jobs</Trans>}
              coverage={data.coverage.job}
            />
            <CoverageNotice
              label={<Trans>Job Materials</Trans>}
              coverage={data.coverage.jobMaterial}
            />
          </div>
        </div>
      )}
      {taskCoverageHasWarning && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          <Trans>
            Some linked task metadata is unavailable. Decision state is shown
            independently and has not been inferred from task status. Task
            details are omitted where linked-task coverage could not be read.
          </Trans>
        </div>
      )}

      <CoverageSummary data={data} />

      <section className="w-full space-y-3">
        <div>
          <h2 className="text-base font-semibold">
            <Trans>Current operational exposure</Trans>
          </h2>
          <p className="text-xs text-muted-foreground">
            <Trans>
              Supported purchasing and production targets that can receive an
              independent Impact assessment.
            </Trans>
          </p>
        </div>
        <ChangeNoticeImpactFilterBar
          taskCoverageStatus={data.taskCoverage.status}
          selectionContent={selectionContent}
          selectionNotices={selectionNotices}
        />
        {filteredEmptyState ? (
          <div className="w-full rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            {filteredEmptyState === "incomplete" ? (
              <Trans>
                No matching loaded Impact rows are visible. Coverage is
                incomplete, so this is not a complete result.
              </Trans>
            ) : (
              <Trans>
                No Impact rows match the current search and filters.
              </Trans>
            )}
          </div>
        ) : (
          (currentCandidates.length > 0 || !hasDisplayFilters) &&
          (currentCandidates.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              {coverageHasWarning ? (
                <Trans>No complete current result is available.</Trans>
              ) : (
                <Trans>No current operational exposure is available.</Trans>
              )}
            </div>
          ) : (
            <>
              {(currentPurchaseOrderCandidates.length > 0 ||
                !hasDisplayFilters) && (
                <DocumentGroups
                  changeNoticeId={id}
                  candidates={currentPurchaseOrderCandidates}
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
                    <Trans>No Purchase Order lines are available.</Trans>
                  }
                />
              )}
              {(currentProductionCandidates.length > 0 ||
                !hasDisplayFilters) && (
                <DocumentGroups
                  changeNoticeId={id}
                  candidates={currentProductionCandidates}
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
                    <Trans>No Jobs or Job Materials are available.</Trans>
                  }
                />
              )}
            </>
          ))
        )}
      </section>

      {!filteredEmptyState && (
        <>
          {(historicalCandidates.length > 0 || !hasDisplayFilters) && (
            <section className="w-full space-y-3">
              <div>
                <h2 className="text-base font-semibold">
                  <Trans>Historical references</Trans>
                </h2>
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    These references remain traceable but do not create a new
                    Unassessed obligation.
                  </Trans>
                </p>
              </div>
              <DocumentGroups
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
                emptyMessage={
                  coverageHasWarning ? (
                    <Trans>Historical coverage is incomplete.</Trans>
                  ) : (
                    <Trans>No historical references are available.</Trans>
                  )
                }
              />
            </section>
          )}

          {unavailableCandidates.length > 0 && (
            <section className="w-full space-y-3">
              <div>
                <h2 className="text-base font-semibold">
                  <Trans>Unavailable source rows</Trans>
                </h2>
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    Source identities are retained only where they were
                    authorized; decision-relevant facts are withheld until
                    coverage is restored.
                  </Trans>
                </p>
              </div>
              <DocumentGroups
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
                emptyMessage={
                  <Trans>No unavailable source rows are available.</Trans>
                }
              />
            </section>
          )}
        </>
      )}

      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-sm">
            <Trans>Informational context only</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          <Trans>
            Receipts, inspections, sales, shipments, and other related records
            are outside the current Impact assessment scope. They do not count
            toward assessment totals or offer decision controls here.
          </Trans>
        </CardContent>
      </Card>

      {bulkDrawerOpen &&
        !bulkSelectionBlocked &&
        selectedCandidates.length > 0 && (
          <ImpactBulkDecisionDrawer
            changeNoticeId={id}
            candidates={selectedCandidates}
            coverage={data.coverage}
            taskCoverageStatus={data.taskCoverage.status}
            changeNoticeStatus={status}
            onClose={() => setBulkDrawerOpen(false)}
            onSuccess={handleBulkSuccess}
            onConflict={handleBulkConflict}
          />
        )}

      {decisionTarget && (
        <ImpactDecisionDrawer
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
