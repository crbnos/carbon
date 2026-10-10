// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  DatePicker,
  HStack,
  Status,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { PROJECT_PEG_STATE_COLOR_MAP } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { Fragment } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { Link, useParams } from "react-router";
import { DateTime, Hyperlink } from "~/components";
import { usePermissions, useQuantityFormatter, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { ProjectPegRow } from "../../projects.service";

type ProjectPeggingProps = {
  pegs: ProjectPegRow[];
  /** The chosen As of day, or null for the current pegs. */
  asOfDate: string | null;
};

/**
 * The project Pegging tab (Projects Phase 3): which orders of the planning
 * group are for this project, by item. A Soft peg sits on open supply and
 * MRP may move it; a Hard peg is received stock; a Manual peg is a
 * planner's override. As of shows the pegs that were current at the end of
 * a past day.
 */
export default function ProjectPegging({
  pegs,
  asOfDate
}: ProjectPeggingProps) {
  const { t } = useLingui();
  const { projectId } = useParams();
  if (!projectId) throw new Error("projectId not found");
  const permissions = usePermissions();
  const canOverride = permissions.can("update", "projects") && !asOfDate;
  const formatQuantity = useQuantityFormatter();
  const [, setParams] = useUrlParams();

  const stateLabels: Record<ProjectPegRow["state"], string> = {
    Soft: t`Soft`,
    Hard: t`Hard`,
    Manual: t`Manual`
  };

  // The service orders the rows by item, so a group is a run of rows.
  const groups: { itemId: string; rows: ProjectPegRow[] }[] = [];
  for (const peg of pegs) {
    const last = groups[groups.length - 1];
    if (last?.itemId === peg.itemId) last.rows.push(peg);
    else groups.push({ itemId: peg.itemId, rows: [peg] });
  }

  const supplyCell = (peg: ProjectPegRow) => {
    if (peg.supplyType === "Planning Action") {
      return (
        <span className="text-muted-foreground">
          <Trans>Planned order</Trans>
        </span>
      );
    }
    const label = peg.supplyReadableId ?? peg.supplyId;
    const to = !peg.supplyDocumentId
      ? null
      : peg.supplyType === "Job"
        ? path.to.job(peg.supplyDocumentId)
        : path.to.purchaseOrder(peg.supplyDocumentId);
    return (
      <div className="flex min-w-0 flex-col">
        {to ? (
          <Hyperlink to={to}>
            <span className="whitespace-nowrap">{label}</span>
          </Hyperlink>
        ) : (
          <span className="whitespace-nowrap">{label}</span>
        )}
        <span className="text-xs text-muted-foreground">
          {peg.supplyType === "Job" ? t`Job` : t`Purchase Order`}
        </span>
      </div>
    );
  };

  return (
    <div className="@container mx-auto flex w-full max-w-[80rem] flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Pegging</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              The orders of the planning group that are for this project. MRP
              may move a soft peg on any run; it keeps hard and manual pegs.
            </Trans>
          </CardDescription>
          <CardAction>
            <HStack className="flex-wrap justify-end">
              <span className="whitespace-nowrap text-sm text-muted-foreground">
                <Trans>As of</Trans>
              </span>
              <DatePicker
                size="sm"
                aria-label={t`As of`}
                value={asOfDate ? parseDate(asOfDate) : null}
                onChange={(value) => setParams({ asOf: value?.toString() })}
              />
              {asOfDate && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setParams({ asOf: null })}
                >
                  <Trans>Current</Trans>
                </Button>
              )}
            </HStack>
          </CardAction>
        </CardHeader>
        <CardContent>
          {groups.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              {asOfDate ? (
                <Trans>The project had no pegs on that day.</Trans>
              ) : (
                <Trans>
                  The project has no pegs. MRP pegs the planning group's orders
                  to its members on its next run.
                </Trans>
              )}
            </p>
          ) : (
            <TableBase full>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Supply</Trans>
                  </Th>
                  <Th>
                    <Trans>Quantity</Trans>
                  </Th>
                  <Th>
                    <Trans>Need Date</Trans>
                  </Th>
                  <Th>
                    <Trans>State</Trans>
                  </Th>
                  <Th>
                    <Trans>Element</Trans>
                  </Th>
                  <Th className="w-12">
                    <span className="sr-only">
                      <Trans>Actions</Trans>
                    </span>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {groups.map((group) => {
                  const item = group.rows[0]?.item;
                  const total = group.rows.reduce(
                    (sum, row) => sum + Number(row.quantity),
                    0
                  );
                  return (
                    <Fragment key={group.itemId}>
                      <Tr className="bg-muted/40">
                        <Td colSpan={6}>
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex min-w-0 items-baseline gap-2">
                              <Hyperlink
                                to={path.to.inventoryItem(group.itemId)}
                              >
                                <span className="whitespace-nowrap font-medium">
                                  {item?.readableIdWithRevision ?? group.itemId}
                                </span>
                              </Hyperlink>
                              <span className="truncate text-xs text-muted-foreground">
                                {item?.name ?? ""}
                              </span>
                            </div>
                            <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                              <Trans>Pegged {formatQuantity(total)}</Trans>
                            </span>
                          </div>
                        </Td>
                      </Tr>
                      {group.rows.map((peg) => {
                        const warning = peg.state === "Manual" && peg.exception;
                        return (
                          <Tr
                            key={peg.id}
                            className={cn(
                              warning && "bg-amber-500/10 dark:bg-amber-500/10"
                            )}
                          >
                            <Td>{supplyCell(peg)}</Td>
                            <Td className="tabular-nums">
                              {formatQuantity(Number(peg.quantity))}
                            </Td>
                            <Td className="whitespace-nowrap">
                              {peg.needDate ? (
                                <DateTime value={peg.needDate} variant="date" />
                              ) : null}
                            </Td>
                            <Td>
                              <div className="flex min-w-0 flex-col gap-1">
                                <div>
                                  <Status
                                    color={
                                      PROJECT_PEG_STATE_COLOR_MAP[peg.state]
                                    }
                                  >
                                    {stateLabels[peg.state]}
                                  </Status>
                                </div>
                                {peg.state === "Manual" && peg.manualReason && (
                                  <span className="truncate text-xs text-muted-foreground">
                                    {peg.manualReason}
                                  </span>
                                )}
                                {warning && (
                                  <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                                    <LuTriangleAlert className="size-3 shrink-0" />
                                    {peg.exception}
                                  </span>
                                )}
                              </div>
                            </Td>
                            <Td>
                              {peg.element && peg.projectElementId ? (
                                <Hyperlink
                                  to={path.to.projectElement(
                                    projectId,
                                    peg.projectElementId
                                  )}
                                >
                                  <span className="whitespace-nowrap">
                                    {peg.element.readableId ?? peg.element.name}
                                  </span>
                                </Hyperlink>
                              ) : (
                                <span className="text-muted-foreground">
                                  <Trans>Project</Trans>
                                </span>
                              )}
                            </Td>
                            <Td>
                              {peg.state === "Soft" && !asOfDate && (
                                <OverrideButton
                                  isDisabled={!canOverride}
                                  to={`${path.to.projectPeggingManual(projectId)}?pegId=${peg.id}`}
                                />
                              )}
                            </Td>
                          </Tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </Tbody>
            </TableBase>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OverrideButton({
  to,
  isDisabled
}: {
  to: string;
  isDisabled: boolean;
}) {
  if (isDisabled) {
    return (
      <Button variant="secondary" size="sm" isDisabled>
        <Trans>Override</Trans>
      </Button>
    );
  }
  return (
    <Button variant="secondary" size="sm" asChild>
      <Link to={to}>
        <Trans>Override</Trans>
      </Link>
    </Button>
  );
}
