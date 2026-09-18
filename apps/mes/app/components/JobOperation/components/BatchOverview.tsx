import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Heading,
  HStack,
  Separator,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { JOB_STATUS_COLOR_MAP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { FaCheck, FaTrash } from "react-icons/fa";
import { LuBoxes, LuGitBranchPlus, LuLayers } from "react-icons/lu";
import { Link } from "react-router";
import type {
  BatchMaterialTotal,
  JobOperationBatch
} from "~/services/operations.service";
import type { JobMaterial } from "~/services/types";
import { path } from "~/utils/path";

// The batch as the unit of work: aggregated quantities, the one shared pick
// per material, where the output lands, and every member job. Rendered by
// JobOperation in place of the per-job details when the "Batch" scope is on.
export function BatchOverview({
  batch,
  totals,
  currentOperationId,
  currentMaterials,
  onIssue
}: {
  batch: JobOperationBatch;
  totals: Record<string, BatchMaterialTotal>;
  currentOperationId: string;
  // This job's material rows — the shared pick is launched from one of them,
  // and batch mode on the issue modal widens it to the whole batch.
  currentMaterials: JobMaterial[];
  onIssue: (material: JobMaterial) => void;
}) {
  const { t } = useLingui();
  const members = batch.operations ?? [];
  const jobIdOf = (m: (typeof members)[number]) =>
    (m.job as { jobId?: string | null } | null)?.jobId ?? m.id;

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

  return (
    <>
      <div className="flex items-start p-4 lg:p-6">
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4 w-full min-w-0">
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

      <Separator />
      <div className="flex flex-col gap-4 p-4 lg:p-6 w-full">
        <VStack spacing={0}>
          <Heading size="h3">
            <Trans>Materials</Trans>
          </Heading>
          <p className="text-sm text-muted-foreground">
            <Trans>
              One pick covers the whole batch, split across jobs by what each
              still needs.
            </Trans>
          </p>
        </VStack>
        <Table className="w-full text-base">
          <Thead>
            <Tr>
              <Th className="text-sm">
                <Trans>Part</Trans>
              </Th>
              <Th className="text-sm">
                <Trans>Batch required</Trans>
              </Th>
              <Th className="text-sm">
                <Trans>Issued</Trans>
              </Th>
              <Th className="text-right" />
            </Tr>
          </Thead>
          <Tbody>
            {materials.length === 0 ? (
              <Tr>
                <Td colSpan={4} className="text-muted-foreground">
                  <Trans>No materials on this batch.</Trans>
                </Td>
              </Tr>
            ) : (
              materials.map(([itemId, m]) => {
                const tracked =
                  m.requiresBatchTracking || m.requiresSerialTracking;
                const fullyIssued = m.required > 0 && m.issued >= m.required;
                const pickFrom = materialByItem.get(itemId);
                const split = [...m.perMember]
                  .sort(
                    (a, b) =>
                      (memberOrder.get(a.jobOperationId) ?? 0) -
                      (memberOrder.get(b.jobOperationId) ?? 0)
                  )
                  .map((p) => p.required)
                  .join(" · ");
                return (
                  <Tr key={itemId}>
                    <Td>
                      <VStack spacing={0}>
                        <span className="font-medium">{m.itemReadableId}</span>
                        <span className="text-sm text-muted-foreground line-clamp-1">
                          {m.name}
                        </span>
                      </VStack>
                    </Td>
                    <Td>
                      <VStack spacing={0}>
                        <span className="tabular-nums">
                          {m.required} {m.unitOfMeasureCode}
                        </span>
                        {m.perMember.length > 1 && (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {split}
                          </span>
                        )}
                      </VStack>
                    </Td>
                    <Td>
                      <span
                        className={cn(
                          "tabular-nums",
                          tracked &&
                            (fullyIssued
                              ? "text-emerald-500"
                              : m.issued > 0
                                ? "text-yellow-500"
                                : "")
                        )}
                      >
                        {tracked ? m.issued : "—"}
                      </span>
                    </Td>
                    <Td className="text-right">
                      {!tracked ? (
                        <span className="text-sm text-muted-foreground">
                          <Trans>Backflushed at completion</Trans>
                        </span>
                      ) : fullyIssued ? (
                        <HStack spacing={1} className="justify-end">
                          <FaCheck className="h-3 w-3 text-emerald-500" />
                          <span className="text-sm text-emerald-500">
                            <Trans>Issued</Trans>
                          </span>
                        </HStack>
                      ) : pickFrom ? (
                        <Button
                          variant="secondary"
                          leftIcon={<LuGitBranchPlus />}
                          onClick={() => onIssue(pickFrom)}
                        >
                          <Trans>Pick {m.required - m.issued}</Trans>
                        </Button>
                      ) : null}
                    </Td>
                  </Tr>
                );
              })
            )}
          </Tbody>
        </Table>
      </div>

      <Separator />
      <div className="flex flex-col gap-4 p-4 lg:p-6 w-full">
        <HStack className="justify-between w-full">
          <Heading size="h3">
            <Trans>Jobs in this batch</Trans>
          </Heading>
          {merged && (
            <HStack spacing={1} className="text-sm text-muted-foreground">
              <LuBoxes className="h-3 w-3" />
              <span>
                <Trans>
                  all output →{" "}
                  <span className="font-mono">{batch.outputLotNumber}</span>
                </Trans>
              </span>
            </HStack>
          )}
        </HStack>
        <Table className="w-full text-base">
          <Thead>
            <Tr>
              <Th className="text-sm">
                <Trans>Job</Trans>
              </Th>
              <Th className="text-sm">
                <Trans>Item</Trans>
              </Th>
              <Th className="text-sm">
                <Trans>Quantity</Trans>
              </Th>
              {!merged && (
                <Th className="text-sm">
                  <Trans>Lot</Trans>
                </Th>
              )}
              <Th className="text-right text-sm">
                <Trans>Status</Trans>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {members.map((m) => {
              const status = (m.job as { status?: string | null } | null)
                ?.status;
              const item = m.jobMakeMethod?.item;
              const isCurrent = m.id === currentOperationId;
              return (
                <Tr key={m.id}>
                  <Td>
                    <Link
                      to={`${path.to.operation(m.id)}?scope=job`}
                      className="font-medium hover:underline"
                    >
                      {jobIdOf(m)}
                    </Link>
                    {isCurrent && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        <Trans>this job</Trans>
                      </span>
                    )}
                  </Td>
                  <Td>
                    <VStack spacing={0}>
                      <span>{item?.readableIdWithRevision}</span>
                      <span className="text-sm text-muted-foreground line-clamp-1">
                        {item?.name}
                      </span>
                    </VStack>
                  </Td>
                  <Td>
                    <span className="tabular-nums">
                      {m.quantityComplete ?? 0} / {m.operationQuantity ?? 0}
                    </span>
                  </Td>
                  {!merged && (
                    <Td className="font-mono">
                      {m.requiresBatchTracking ? m.batchNumber || "—" : null}
                    </Td>
                  )}
                  <Td className="text-right">
                    {status && (
                      <Badge
                        variant={
                          JOB_STATUS_COLOR_MAP[
                            status as keyof typeof JOB_STATUS_COLOR_MAP
                          ] ?? "gray"
                        }
                      >
                        {status}
                      </Badge>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </div>
    </>
  );
}
