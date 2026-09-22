import { convertKbToString } from "@carbon/files";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Heading,
  IconButton,
  Progress,
  Separator,
  Table,
  Tbody,
  Td,
  Tfoot,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { formatDate, groupBy } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Fragment, Suspense, useCallback, useState } from "react";
import { FaCheck, FaTrash } from "react-icons/fa";
import {
  LuActivity,
  LuChevronDown,
  LuChevronRight,
  LuCircleCheck,
  LuDownload,
  LuGitBranchPlus,
  LuLayers,
  LuMapPin
} from "react-icons/lu";
import { Await, Link } from "react-router";
import { FileIcon, FilePreview } from "~/components";
import { ProcedureStepTypeIcon, TrackingTypeIcon } from "~/components/Icons";
import ItemThumbnail from "~/components/ItemThumbnail";
import type {
  BatchFile,
  BatchMaterialTotal,
  BatchStep,
  BatchWorkInstructions,
  JobOperationBatch
} from "~/services/operations.service";
import { getFileType } from "~/services/operations.service";
import type {
  JobMaterial,
  JobOperationStep,
  StorageItem
} from "~/services/types";
import { path } from "~/utils/path";
import { BatchRecordModal } from "./BatchRecordModal";
import { hasStepDescription, StepMedia } from "./Step";
import { TableSkeleton } from "./TableSkeleton";

type ItemType = Parameters<typeof ItemThumbnail>[0]["type"];

// The batch as the unit of work: aggregated quantities, the one shared pick
// per material, where the output lands, and every member job. Rendered by
// JobOperation in place of the per-job details when the "Batch" scope is on.
export function BatchOverview({
  batch,
  totals,
  currentMaterials,
  onIssue,
  workInstructions,
  onDownloadFile,
  view = "details"
}: {
  batch: JobOperationBatch;
  totals: Record<string, BatchMaterialTotal>;
  // This job's material rows — the shared pick is launched from one of them,
  // and batch mode on the issue modal widens it to the whole batch.
  currentMaterials: JobMaterial[];
  onIssue: (material: JobMaterial) => void;
  // Steps, parameters and files across every member (streams in after load).
  workInstructions?: Promise<BatchWorkInstructions> | null;
  onDownloadFile: (file: StorageItem) => void;
  // Details: stats, materials, files, jobs. Instructions: the steps and
  // process parameters every job follows — the batch's Instructions tab.
  view?: "details" | "instructions";
}) {
  const { t } = useLingui();
  const jobIdOf = (m: NonNullable<JobOperationBatch["operations"]>[number]) =>
    (m.job as { jobId?: string | null } | null)?.jobId ?? m.id;
  // Job-number order everywhere, so per-job splits line up with the jobs table.
  const members = [...(batch.operations ?? [])].sort((a, b) =>
    jobIdOf(a).localeCompare(jobIdOf(b), undefined, { numeric: true })
  );
  const jobIdByOperation = new Map(members.map((m) => [m.id, jobIdOf(m)]));

  const quantity = members.reduce((s, m) => s + (m.operationQuantity ?? 0), 0);
  const completed = members.reduce((s, m) => s + (m.quantityComplete ?? 0), 0);
  const scrapped = members.reduce((s, m) => s + (m.quantityScrapped ?? 0), 0);

  const materials = Object.entries(totals).sort(([, a], [, b]) =>
    (a.itemReadableId ?? "").localeCompare(b.itemReadableId ?? "")
  );
  const trackedLines = materials.filter(
    ([, m]) => m.requiresBatchTracking || m.requiresSerialTracking
  );
  const issuedLines = trackedLines.filter(
    ([, m]) => m.required > 0 && m.issued >= m.required
  );

  const merged = Boolean(batch.mergeOutput && batch.outputLotNumber);
  const materialByItem = new Map(
    currentMaterials.map((m) => [m.itemId, m] as const)
  );
  const memberOrder = new Map(members.map((m, i) => [m.id, i] as const));
  const mixedItems =
    new Set(members.map((m) => m.jobMakeMethod?.item?.readableIdWithRevision))
      .size > 1;
  // A merged batch names its one lot in the section header instead.
  const showLots = !merged && members.some((m) => m.requiresBatchTracking);
  const remaining = (m: (typeof members)[number]) =>
    Math.max(0, (m.operationQuantity ?? 0) - (m.quantityComplete ?? 0));
  const inJobOrder = <T extends { jobOperationId: string }>(rows: T[]) =>
    [...rows].sort(
      (a, b) =>
        (memberOrder.get(a.jobOperationId) ?? 0) -
        (memberOrder.get(b.jobOperationId) ?? 0)
    );
  // Files under a sub-header per job: the batch-wide ones (the item's) first,
  // then each job in job order.
  const fileGroups = (files: BatchFile[]) => {
    const byJob = groupBy(files, (file) => file.jobReadableId ?? "");
    const order = ["", ...members.map(jobIdOf)];
    return Object.entries(byJob).sort(
      ([a], [b]) => order.indexOf(a) - order.indexOf(b)
    );
  };
  const [recordingKey, setRecordingKey] = useState<string | null>(null);
  const closeRecord = useCallback(() => setRecordingKey(null), []);
  // Descriptions start open, as on the job's own step list.
  const [collapsedSteps, setCollapsedSteps] = useState<Set<string>>(
    () => new Set()
  );
  const toggleStep = (key: string) =>
    setCollapsedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (view === "instructions") {
    return (
      <>
        {workInstructions && (
          <Suspense fallback={<TableSkeleton />}>
            <Await resolve={workInstructions}>
              {(resolved) => (
                <>
                  {resolved.steps.length === 0 &&
                    resolved.parameters.length === 0 && (
                      <p className="p-6 text-sm text-muted-foreground">
                        <Trans>This batch has no work instructions.</Trans>
                      </p>
                    )}
                  {resolved.steps.length > 0 && (
                    <Section
                      divider={false}
                      title={t`Work instructions`}
                      description={t`Every job in the batch follows these steps. Record a step for all of them at once.`}
                    >
                      <Panel>
                        <ul className="divide-y">
                          {resolved.steps.map((step, _i, steps) => {
                            const anyDescription = steps.some((s) =>
                              hasStepDescription(
                                s.description as JobOperationStep["description"]
                              )
                            );
                            const spec = stepSpecification(step);
                            const recorded = step.perMember.filter(
                              (m) => m.recorded
                            ).length;
                            const allRecorded =
                              recorded === step.perMember.length;
                            const hasDescription = hasStepDescription(
                              step.description as JobOperationStep["description"]
                            );
                            const descriptionOpen =
                              hasDescription && !collapsedSteps.has(step.key);
                            return (
                              <li
                                key={step.key}
                                className="px-4 py-3.5 transition-colors hover:bg-muted/30 md:px-5"
                              >
                                <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
                                  <div className="flex min-w-0 flex-1 items-center gap-3">
                                    <IconChip>
                                      <ProcedureStepTypeIcon
                                        type={
                                          step.type as Parameters<
                                            typeof ProcedureStepTypeIcon
                                          >[0]["type"]
                                        }
                                      />
                                    </IconChip>
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                        <span className="text-sm font-medium text-pretty">
                                          {step.name}
                                        </span>
                                        {step.required && (
                                          <Badge variant="gray">
                                            <Trans>Required</Trans>
                                          </Badge>
                                        )}
                                      </div>
                                      {spec && (
                                        <p className="text-sm tabular-nums text-muted-foreground">
                                          {spec}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1.5 pl-12 md:justify-end md:pl-0">
                                    {/* How far the batch is, not which job is
                                      which — the record grid names the jobs. */}
                                    <div
                                      className="flex w-24 gap-0.5"
                                      aria-hidden
                                    >
                                      {inJobOrder(step.perMember).map(
                                        (member) => (
                                          <span
                                            key={member.stepId}
                                            className={cn(
                                              "h-1.5 flex-1 rounded-full",
                                              member.recorded
                                                ? "bg-emerald-500"
                                                : "bg-muted-foreground/20"
                                            )}
                                          />
                                        )
                                      )}
                                    </div>
                                    <span className="mr-1 w-16 text-xs tabular-nums text-muted-foreground">
                                      {t`${recorded}/${step.perMember.length} jobs`}
                                    </span>
                                    <Button
                                      variant={
                                        allRecorded ? "ghost" : "secondary"
                                      }
                                      rightIcon={<LuCircleCheck />}
                                      onClick={() => setRecordingKey(step.key)}
                                    >
                                      {allRecorded ? (
                                        <Trans>Update</Trans>
                                      ) : (
                                        <Trans>Record</Trans>
                                      )}
                                    </Button>
                                    {hasDescription ? (
                                      <IconButton
                                        aria-label={
                                          descriptionOpen
                                            ? t`Hide description`
                                            : t`Show description`
                                        }
                                        variant="ghost"
                                        icon={
                                          descriptionOpen ? (
                                            <LuChevronDown />
                                          ) : (
                                            <LuChevronRight />
                                          )
                                        }
                                        onClick={() => toggleStep(step.key)}
                                      />
                                    ) : (
                                      anyDescription && (
                                        // Keeps the progress column aligned
                                        // with rows that have the toggle.
                                        <span className="hidden size-8 shrink-0 md:block" />
                                      )
                                    )}
                                  </div>
                                </div>
                                {(hasDescription || step.slides.length > 0) && (
                                  <div className="pl-12">
                                    <StepMedia
                                      description={
                                        step.description as JobOperationStep["description"]
                                      }
                                      slides={step.slides}
                                      showDescription={descriptionOpen}
                                    />
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </Panel>
                      {(() => {
                        const step = resolved.steps.find(
                          (s) => s.key === recordingKey
                        );
                        return step ? (
                          <BatchRecordModal
                            batchId={batch.id as string}
                            step={step}
                            members={inJobOrder(step.perMember)}
                            jobIdOf={(id) => jobIdByOperation.get(id) ?? id}
                            onClose={closeRecord}
                          />
                        ) : null;
                      })()}
                    </Section>
                  )}

                  {resolved.parameters.length > 0 && (
                    <Section title={t`Process parameters`}>
                      <Panel>
                        <dl className="divide-y">
                          {resolved.parameters.map((parameter) => (
                            <div
                              key={parameter.key}
                              className="flex items-center justify-between gap-4 px-4 py-3 md:px-5"
                            >
                              <dt className="flex min-w-0 items-center gap-3 text-sm font-medium">
                                <IconChip>
                                  <LuActivity />
                                </IconChip>
                                <span className="truncate">
                                  {parameter.key}
                                </span>
                              </dt>
                              <dd className="flex min-w-0 flex-col items-end gap-1 text-right">
                                {parameter.values.length === 1 ? (
                                  <span className="font-medium tabular-nums">
                                    {parameter.values[0]?.value}
                                  </span>
                                ) : (
                                  parameter.values.map((v) => (
                                    <span
                                      key={v.value}
                                      className="text-sm tabular-nums"
                                    >
                                      <span className="font-medium">
                                        {v.value}
                                      </span>{" "}
                                      <span className="text-muted-foreground">
                                        ·{" "}
                                        {v.jobOperationIds
                                          .map(
                                            (id) =>
                                              jobIdByOperation.get(id) ?? id
                                          )
                                          .join(", ")}
                                      </span>
                                    </span>
                                  ))
                                )}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </Panel>
                    </Section>
                  )}
                </>
              )}
            </Await>
          </Suspense>
        )}
      </>
    );
  }

  return (
    <>
      <div className="flex items-start p-4 lg:p-6">
        <div className="grid gap-3 md:gap-4 grid-cols-2 xl:grid-cols-4 w-full min-w-0">
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 justify-between">
              <CardTitle>
                <Trans>Completed</Trans>
              </CardTitle>
              <FaCheck className="h-3 w-3 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <Heading size="h1">
                <Trans>
                  {completed} of {quantity}
                </Trans>
              </Heading>
              <p className="text-sm text-muted-foreground">
                {t`across ${members.length} jobs`}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-2 justify-between">
              <CardTitle>
                <Trans>Materials issued</Trans>
              </CardTitle>
              <LuGitBranchPlus className="h-3 w-3 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <Heading size="h1">
                <Trans>
                  {issuedLines.length} of {trackedLines.length}
                </Trans>
              </Heading>
              <p className="text-sm text-muted-foreground">
                <Trans>tracked lines</Trans>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-2 justify-between">
              <CardTitle>
                <Trans>Scrapped</Trans>
              </CardTitle>
              <FaTrash className="h-3 w-3 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <Heading size="h1">{scrapped}</Heading>
              <p className="text-sm text-muted-foreground">
                <Trans>batch total</Trans>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-2 justify-between">
              <CardTitle>
                <Trans>Output lot</Trans>
              </CardTitle>
              <LuLayers className="h-3 w-3 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <Heading size="h3" className="font-mono truncate">
                {merged ? batch.outputLotNumber : t`Separate lots`}
              </Heading>
              <p className="text-sm text-muted-foreground">
                {merged ? (
                  <Trans>one combined lot · planned</Trans>
                ) : (
                  <Trans>one per job · planned</Trans>
                )}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Always shown in batch mode so the operator can see the jobs, parts
          and quantities that belong in the run — a laser nest or an oven load
          is the same item across many jobs, and needs the per-job list even
          when the parts don't have to be kept apart afterwards. */}
      <Section
        title={t`Load list`}
        description={
          mixedItems
            ? t`The jobs make different items — keep each job's parts apart.`
            : showLots
              ? t`Each job's output is its own lot — keep each job's parts apart.`
              : t`The jobs and parts that make up this run.`
        }
      >
        <Panel>
          <Table>
            <Thead className="bg-muted/40">
              <Tr>
                <Th className={th}>
                  <Trans>Job</Trans>
                </Th>
                <Th className={th}>
                  <Trans>Item</Trans>
                </Th>
                <Th className={cn(th, "hidden md:table-cell")}>
                  <Trans>Due</Trans>
                </Th>
                {showLots && (
                  <Th className={cn(th, "hidden md:table-cell")}>
                    <Trans>Lot</Trans>
                  </Th>
                )}
                <Th className={cn(th, "whitespace-nowrap text-right")}>
                  <Trans>To run</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody className={rows}>
              {members.map((m) => {
                const job = m.job as {
                  deadlineType?: string | null;
                  customer?: { name?: string | null } | null;
                } | null;
                const toRun = remaining(m);
                return (
                  <Tr key={m.id}>
                    <Td className={cn(td, "whitespace-nowrap text-sm")}>
                      <Link
                        to={`${path.to.operation(m.id)}?scope=job`}
                        className="font-medium hover:underline"
                      >
                        {jobIdOf(m)}
                      </Link>
                      {job?.customer?.name && (
                        <p className="truncate text-sm text-muted-foreground">
                          {job.customer.name}
                        </p>
                      )}
                    </Td>
                    <Td className={cn(td, "w-full max-w-0")}>
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="hidden shrink-0 sm:block">
                          <ItemThumbnail
                            thumbnailPath={m.jobMakeMethod?.item?.thumbnailPath}
                            type={m.jobMakeMethod?.item?.type as ItemType}
                          />
                        </div>
                        <div className="min-w-0">
                          <span className="block truncate font-medium">
                            {m.jobMakeMethod?.item?.readableIdWithRevision}
                          </span>
                          {m.jobMakeMethod?.item?.name && (
                            <p className="truncate text-sm text-muted-foreground">
                              {m.jobMakeMethod.item.name}
                            </p>
                          )}
                        </div>
                      </div>
                    </Td>
                    <Td
                      className={cn(
                        td,
                        "hidden whitespace-nowrap text-sm text-muted-foreground md:table-cell"
                      )}
                    >
                      {["ASAP", "No Deadline"].includes(
                        job?.deadlineType ?? ""
                      ) || !m.dueDate
                        ? (job?.deadlineType ?? "—")
                        : formatDate(m.dueDate)}
                    </Td>
                    {showLots && (
                      <Td
                        className={cn(
                          td,
                          "hidden whitespace-nowrap font-mono text-sm md:table-cell"
                        )}
                      >
                        {m.requiresBatchTracking ? m.batchNumber || "—" : "—"}
                      </Td>
                    )}
                    <Td className={cn(td, "whitespace-nowrap text-right")}>
                      <span className="font-medium tabular-nums">{toRun}</span>
                      {toRun !== (m.operationQuantity ?? 0) && (
                        <span className="ml-1 text-xs tabular-nums text-muted-foreground">
                          {t`of ${m.operationQuantity ?? 0}`}
                        </span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
            <Tfoot className="border-t bg-muted/40">
              <Tr>
                <Td
                  colSpan={1 + 1 + 1 + (showLots ? 1 : 0)}
                  className={cn(td, "text-sm text-muted-foreground")}
                >
                  <Trans>Total</Trans>
                </Td>
                <Td
                  className={cn(
                    td,
                    "whitespace-nowrap text-right font-medium tabular-nums"
                  )}
                >
                  {members.reduce((sum, m) => sum + remaining(m), 0)}
                </Td>
              </Tr>
            </Tfoot>
          </Table>
        </Panel>
      </Section>

      <Section
        title={t`Materials`}
        description={t`One pick covers the whole batch — it is shared out to the jobs automatically.`}
      >
        <Panel>
          <Table>
            <Tbody className={rows}>
              {materials.length === 0 ? (
                <Tr>
                  <Td
                    colSpan={4}
                    className="py-8 text-center text-muted-foreground"
                  >
                    <Trans>No materials on this batch.</Trans>
                  </Td>
                </Tr>
              ) : (
                [
                  {
                    key: "pick",
                    label: t`To pick`,
                    lines: trackedLines
                  },
                  {
                    key: "backflush",
                    label: t`Used automatically at completion`,
                    lines: materials.filter(
                      ([, m]) =>
                        !m.requiresBatchTracking && !m.requiresSerialTracking
                    )
                  }
                ]
                  .filter((group) => group.lines.length > 0)
                  .map((group) => (
                    <Fragment key={group.key}>
                      <Tr>
                        <Td colSpan={4} className={groupHeader}>
                          {group.label}
                        </Td>
                      </Tr>
                      {group.lines.map(([itemId, m]) => {
                        const tracked = group.key === "pick";
                        const fullyIssued =
                          m.required > 0 && m.issued >= m.required;
                        const pickFrom = materialByItem.get(itemId);
                        const action = !tracked ? null : fullyIssued ? (
                          <Badge variant="green" className="gap-1">
                            <FaCheck className="size-2.5" />
                            <Trans>Issued</Trans>
                          </Badge>
                        ) : pickFrom ? (
                          <Button
                            leftIcon={<LuGitBranchPlus />}
                            onClick={() => onIssue(pickFrom)}
                          >
                            <Trans>Pick {m.required - m.issued}</Trans>
                          </Button>
                        ) : null;
                        return (
                          <Tr key={itemId}>
                            <Td className={cn(td, "w-full max-w-0")}>
                              <div className="flex min-w-0 items-center gap-3">
                                <div className="hidden shrink-0 sm:block">
                                  <ItemThumbnail
                                    thumbnailPath={m.thumbnailPath}
                                    type={m.itemType as ItemType}
                                  />
                                </div>
                                <div className="min-w-0">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span className="truncate font-medium">
                                      {m.itemReadableId}
                                    </span>
                                    {tracked && (
                                      <Badge
                                        variant="outline"
                                        className="shrink-0 gap-1 font-medium normal-case"
                                      >
                                        <TrackingTypeIcon
                                          type={
                                            m.requiresSerialTracking
                                              ? "Serial"
                                              : "Batch"
                                          }
                                        />
                                        <span className="hidden sm:inline">
                                          {m.requiresSerialTracking ? (
                                            <Trans>Serialized</Trans>
                                          ) : (
                                            <Trans>Lot tracked</Trans>
                                          )}
                                        </span>
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="truncate text-sm text-muted-foreground">
                                    {m.name}
                                  </p>
                                </div>
                              </div>
                            </Td>
                            <Td
                              className={cn(
                                td,
                                "hidden whitespace-nowrap text-sm text-muted-foreground md:table-cell"
                              )}
                            >
                              {m.storageUnitName && (
                                <span className="inline-flex items-center gap-1.5">
                                  <LuMapPin className="size-3.5" />
                                  {m.storageUnitName}
                                </span>
                              )}
                            </Td>
                            <Td
                              className={cn(
                                td,
                                "whitespace-nowrap text-right md:w-48"
                              )}
                            >
                              {tracked ? (
                                <div className="flex flex-col items-end gap-1.5">
                                  <span className="text-sm tabular-nums text-muted-foreground">
                                    <span className="font-medium text-foreground">
                                      {m.issued}
                                    </span>{" "}
                                    / {m.required} {m.unitOfMeasureCode}
                                  </span>
                                  <Progress
                                    value={
                                      m.required > 0
                                        ? Math.min(
                                            100,
                                            (m.issued / m.required) * 100
                                          )
                                        : 0
                                    }
                                    className="h-1.5 w-full min-w-24"
                                    indicatorClassName={
                                      fullyIssued
                                        ? "bg-emerald-500"
                                        : "bg-primary"
                                    }
                                  />
                                  {action && (
                                    <div className="sm:hidden">{action}</div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-sm font-medium tabular-nums">
                                  {m.required} {m.unitOfMeasureCode}
                                </span>
                              )}
                            </Td>
                            <Td
                              className={cn(
                                td,
                                "hidden w-px whitespace-nowrap text-right sm:table-cell"
                              )}
                            >
                              {action}
                            </Td>
                          </Tr>
                        );
                      })}
                    </Fragment>
                  ))
              )}
            </Tbody>
          </Table>
        </Panel>
      </Section>

      {workInstructions && (
        <Suspense fallback={null}>
          <Await resolve={workInstructions}>
            {(resolved) => (
              <>
                {resolved.files.length > 0 && (
                  <Section title={t`Files`}>
                    <Panel>
                      <Table>
                        <Tbody className={rows}>
                          {fileGroups(resolved.files).map(
                            ([jobReadableId, files]) => (
                              <Fragment key={jobReadableId || "batch"}>
                                {jobReadableId ? (
                                  <Tr key={`group-${jobReadableId}`}>
                                    <Td colSpan={2} className={groupHeader}>
                                      {jobReadableId}
                                    </Td>
                                  </Tr>
                                ) : null}
                                {files.map((file) => {
                                  const type = getFileType(file.name);
                                  const size = convertKbToString(
                                    Math.floor(
                                      (file.metadata?.size ?? 0) / 1024
                                    )
                                  );
                                  const name = (
                                    <span className="block truncate font-medium">
                                      {file.name}
                                    </span>
                                  );
                                  return (
                                    <Tr key={file.storagePath}>
                                      <Td className={td}>
                                        <div className="flex min-w-0 items-center gap-3">
                                          <FileIcon type={type} />
                                          <div className="min-w-0">
                                            {["PDF", "Image"].includes(type) ? (
                                              <FilePreview
                                                bucket="private"
                                                pathToFile={file.storagePath}
                                                // @ts-ignore FilePreview narrows type
                                                type={type}
                                              >
                                                {name}
                                              </FilePreview>
                                            ) : (
                                              name
                                            )}
                                            <span className="text-xs text-muted-foreground tabular-nums">
                                              {size}
                                            </span>
                                          </div>
                                        </div>
                                      </Td>
                                      <Td className={cn(td, "w-px text-right")}>
                                        <IconButton
                                          aria-label={t`Download`}
                                          variant="ghost"
                                          icon={<LuDownload />}
                                          onClick={() => onDownloadFile(file)}
                                        />
                                      </Td>
                                    </Tr>
                                  );
                                })}
                              </Fragment>
                            )
                          )}
                        </Tbody>
                      </Table>
                    </Panel>
                  </Section>
                )}
              </>
            )}
          </Await>
        </Suspense>
      )}
    </>
  );
}

// The step's acceptance rule in one line: a tolerance band, a unit, or the
// allowed choices. Null when the step has nothing to specify.
function stepSpecification(step: BatchStep): string | null {
  const unit = step.unitOfMeasureCode ? ` ${step.unitOfMeasureCode}` : "";
  if (step.minValue !== null && step.maxValue !== null) {
    return `${step.minValue} – ${step.maxValue}${unit}`;
  }
  if (step.minValue !== null) return `≥ ${step.minValue}${unit}`;
  if (step.maxValue !== null) return `≤ ${step.maxValue}${unit}`;
  if (step.listValues?.length) return step.listValues.join(" · ");
  return unit ? unit.trim() : null;
}

function Section({
  title,
  description,
  aside,
  divider = true,
  children
}: {
  title: string;
  description?: string;
  aside?: ReactNode;
  // Off for a tab's first section, which has nothing above it to divide.
  divider?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      {divider && <Separator />}
      <section className="flex w-full min-w-0 flex-col gap-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <Heading size="h3">{title}</Heading>
            {description && (
              <p className="text-sm text-muted-foreground text-pretty">
                {description}
              </p>
            )}
          </div>
          {aside}
        </div>
        {children}
      </section>
    </>
  );
}

// Every list on the batch view sits in the same bordered panel as the job
// view's Steps and Parameters, with a tinted header and divided rows.
const th = "h-10 px-4 text-xs font-medium text-muted-foreground md:px-5";
const td = "h-auto px-4 py-3 md:px-5";
const rows = "[&>tr]:border-b [&>tr:last-child]:border-0";
const groupHeader =
  "h-auto bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground group-hover:bg-muted/40 md:px-5";

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="w-full min-w-0 overflow-hidden rounded-lg border bg-card">
      {children}
    </div>
  );
}

function IconChip({ children }: { children: ReactNode }) {
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted [&>svg]:size-4">
      {children}
    </div>
  );
}
