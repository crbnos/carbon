// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { stopWorkEnd } from "@carbon/ee/project-control";
import {
  BarProgress,
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import {
  LuChevronRight,
  LuClock,
  LuGitPullRequestArrow,
  LuHandCoins,
  LuOctagonX
} from "react-icons/lu";
import { Link, useParams } from "react-router";
import {
  CustomerAvatar,
  EmployeeAvatar,
  Empty,
  ReadOnlyField,
  ReadOnlyFields
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useCurrencyFormatter, useDateFormatter, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { Project } from "../../types";
import ProjectStatus from "../Projects/ProjectStatus";

type ProjectOverviewProps = {
  figures: { budget: number | null; committed: number; actual: number };
  nextMilestone: {
    id: string;
    name: string;
    startDate: string | null;
    endDate: string | null;
    elementCount: number;
    completedCount: number;
  } | null;
  openTimeCount: number;
};

/**
 * The project's landing page (Layer 2): the facts, the budget, the next
 * milestone and what needs attention. Read-only: every value is text, and
 * every action is a link to the page that owns it.
 */
export default function ProjectOverview({
  figures,
  nextMilestone,
  openTimeCount
}: ProjectOverviewProps) {
  const { t } = useLingui();
  const { projectId } = useParams();
  if (!projectId) throw new Error("projectId not found");
  const { formatDate } = useDateFormatter();
  const money = useCurrencyFormatter();
  const routeData = useRouteData<{
    project: Project;
    overdueBorrowCount: number;
    openChangeRequests: { id: string }[];
  }>(path.to.project(projectId));
  const project = routeData?.project;
  if (!project) return null;

  const overdueBorrowCount = routeData?.overdueBorrowCount ?? 0;
  const openChangeRequestCount = routeData?.openChangeRequests.length ?? 0;
  const stopWorkDate = project.stopWorkDate;
  const stopWorkStart = stopWorkDate ? formatDate(stopWorkDate) : "";
  const stopWorkEndDate = stopWorkDate
    ? formatDate(stopWorkEnd(stopWorkDate))
    : "";

  const attention: ReactNode[] = [];
  if (stopWorkDate) {
    attention.push(
      <AttentionRow
        key="stop-work"
        to={path.to.projectSettings(projectId)}
        icon={<LuOctagonX className="text-red-500" />}
      >
        <Trans>
          Stop-work order since {stopWorkStart}, ends {stopWorkEndDate}
        </Trans>
      </AttentionRow>
    );
  }
  if (overdueBorrowCount > 0) {
    attention.push(
      <AttentionRow
        key="borrows"
        to={path.to.projectStock(projectId)}
        icon={<LuHandCoins />}
      >
        <Plural
          value={overdueBorrowCount}
          one="# borrow is past its payback date"
          other="# borrows are past their payback date"
        />
      </AttentionRow>
    );
  }
  if (openChangeRequestCount > 0) {
    attention.push(
      <AttentionRow
        key="change-requests"
        to={path.to.projectChangeRequests(projectId)}
        icon={<LuGitPullRequestArrow />}
      >
        <Plural
          value={openChangeRequestCount}
          one="# open change request"
          other="# open change requests"
        />
      </AttentionRow>
    );
  }
  if (openTimeCount > 0) {
    attention.push(
      <AttentionRow
        key="time"
        to={path.to.projectTime(projectId)}
        icon={<LuClock />}
      >
        <Plural
          value={openTimeCount}
          one="# time entry is not posted yet"
          other="# time entries are not posted yet"
        />
      </AttentionRow>
    );
  }

  const budget = figures.budget;
  const isOverBudget = budget !== null && figures.actual > budget;

  return (
    <div className="@container mx-auto flex w-full max-w-[64rem] flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Details</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ReadOnlyFields>
            <ReadOnlyField label={t`Status`}>
              <ProjectStatus status={project.status} />
            </ReadOnlyField>
            <ReadOnlyField label={t`Owner`}>
              {project.ownerId ? (
                <EmployeeAvatar employeeId={project.ownerId} size="xs" />
              ) : null}
            </ReadOnlyField>
            <ReadOnlyField label={t`Customer`}>
              {project.customerId ? (
                <CustomerAvatar customerId={project.customerId} size="xs" />
              ) : null}
            </ReadOnlyField>
            <ReadOnlyField label={t`Start`}>
              {project.startDate ? formatDate(project.startDate) : null}
            </ReadOnlyField>
            <ReadOnlyField label={t`Due`}>
              {project.endDate ? formatDate(project.endDate) : null}
            </ReadOnlyField>
            <ReadOnlyField label={t`Cost Treatment`} termId="cost-treatment">
              <Enumerable value={project.costTreatment} />
            </ReadOnlyField>
          </ReadOnlyFields>
        </CardContent>
      </Card>

      <div className="grid gap-4 @3xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Budget</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {budget !== null && budget > 0 ? (
              <BarProgress
                progress={Math.min(figures.actual, budget)}
                max={budget}
                label={t`Actual of budget`}
                value={`${money.format(figures.actual)} / ${money.format(budget)}`}
                activeClassName={
                  isOverBudget ? "bg-red-500" : "bg-muted-foreground"
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                <Trans>No budget set on the plan.</Trans>
              </p>
            )}
            <div className="grid grid-cols-3 gap-4">
              <ReadOnlyField label={t`Budget`}>
                {budget !== null ? (
                  <span className="tabular-nums">{money.format(budget)}</span>
                ) : null}
              </ReadOnlyField>
              <ReadOnlyField label={t`Committed`}>
                <span className="tabular-nums">
                  {money.format(figures.committed)}
                </span>
              </ReadOnlyField>
              <ReadOnlyField label={t`Actual`}>
                <span
                  className={
                    isOverBudget ? "tabular-nums text-red-500" : "tabular-nums"
                  }
                >
                  {money.format(figures.actual)}
                </span>
              </ReadOnlyField>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Next milestone</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nextMilestone ? (
              <Link
                to={path.to.projectMilestones(projectId)}
                className="-mx-2 flex flex-col gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-accent/50"
              >
                <div className="flex min-w-0 items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {nextMilestone.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {nextMilestone.startDate
                      ? `${formatDate(nextMilestone.startDate)} – `
                      : ""}
                    {nextMilestone.endDate
                      ? formatDate(nextMilestone.endDate)
                      : ""}
                  </span>
                </div>
                <BarProgress
                  progress={nextMilestone.completedCount}
                  max={Math.max(nextMilestone.elementCount, 1)}
                  label={t`Elements done`}
                  value={`${nextMilestone.completedCount} / ${nextMilestone.elementCount}`}
                  activeClassName="bg-muted-foreground"
                />
              </Link>
            ) : (
              <Empty
                className="py-4"
                title={t`No upcoming milestone`}
                description={null}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Needs attention</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {attention.length > 0 ? (
            <div className="-mx-2 flex flex-col">{attention}</div>
          ) : (
            <Empty
              className="py-4"
              title={t`Nothing needs attention`}
              description={null}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AttentionRow({
  to,
  icon,
  children
}: {
  to: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-9 items-center gap-3 rounded-lg px-2 text-sm transition-colors hover:bg-accent/50"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <LuChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
