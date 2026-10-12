// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { stopWorkEnd } from "@carbon/ee/project-control";
import { cn, Progress, Subheading } from "@carbon/react";
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
  useCurrencyFormatter,
  useDateFormatter,
  usePercentFormatter,
  useRouteData
} from "~/hooks";
import { useCustomers, usePeople } from "~/stores";
import { path } from "~/utils/path";
import type { Project } from "../../types";

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
 * The project's landing page (Layer 2): one quiet line of facts, the budget,
 * the next milestone and what needs attention. Read-only: every value is
 * text, and every action is a link to the page that owns it. The status is
 * in the header and the details are in Settings, so neither repeats here.
 * An empty section is one muted line, not the `Empty` illustration: this is
 * a summary, and a cabinet per quiet section is louder than the data.
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
  const percent = usePercentFormatter();
  const [people] = usePeople();
  const [customers] = useCustomers();
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

  // Owner · Customer · Start – Due · Cost treatment. A missing fact is left
  // out, not shown as a dash.
  const start = project.startDate ? formatDate(project.startDate) : null;
  const due = project.endDate ? formatDate(project.endDate) : null;
  const facts = [
    project.ownerId
      ? people.find((person) => person.id === project.ownerId)?.name
      : null,
    project.customerId
      ? customers.find((customer) => customer.id === project.customerId)?.name
      : null,
    start && due ? `${start} – ${due}` : start ? t`Starts ${start}` : null,
    !start && due ? t`Due ${due}` : null,
    project.costTreatment
  ].filter((fact): fact is string => Boolean(fact));

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
  const hasBudget = budget !== null && budget > 0;
  const isOverBudget = hasBudget && figures.actual > budget;
  const actualText = money.format(figures.actual);
  const budgetText = hasBudget ? money.format(budget) : "";
  const committedText = money.format(figures.committed);

  return (
    <div className="@container mx-auto flex w-full max-w-[64rem] flex-col gap-8 px-6 py-8">
      {facts.length > 0 && (
        <p className="text-sm text-muted-foreground text-pretty">
          {facts.join(" · ")}
        </p>
      )}

      <div className="grid gap-8 @3xl:grid-cols-2">
        <OverviewSection title={t`Budget`}>
          <div className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3">
            {hasBudget ? (
              <>
                <div className="flex items-baseline justify-between gap-4 text-sm tabular-nums">
                  <span className="min-w-0 truncate">
                    <span className={cn(isOverBudget && "text-red-500")}>
                      {actualText}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      <Trans>of {budgetText}</Trans>
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-xs",
                      isOverBudget ? "text-red-500" : "text-muted-foreground"
                    )}
                  >
                    {percent.format(figures.actual / budget)}
                  </span>
                </div>
                <Progress
                  value={Math.min((figures.actual / budget) * 100, 100)}
                  aria-label={t`Actual of budget`}
                  className="h-1.5 min-w-0"
                  indicatorClassName={
                    isOverBudget ? "bg-red-500" : "bg-foreground/70"
                  }
                />
                <p className="text-xs text-muted-foreground tabular-nums">
                  <Trans>Committed {committedText}</Trans>
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  <Trans>No budget set on the plan.</Trans>
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  <Trans>
                    Actual {actualText} · Committed {committedText}
                  </Trans>
                </p>
              </>
            )}
          </div>
        </OverviewSection>

        <OverviewSection title={t`Next milestone`}>
          {nextMilestone ? (
            <Link
              to={path.to.projectMilestones(projectId)}
              className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3 transition-colors hover:bg-accent/50"
            >
              <div className="flex min-w-0 items-baseline justify-between gap-4 text-sm">
                <span className="truncate">{nextMilestone.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {nextMilestone.startDate
                    ? `${formatDate(nextMilestone.startDate)} – `
                    : ""}
                  {nextMilestone.endDate
                    ? formatDate(nextMilestone.endDate)
                    : ""}
                </span>
              </div>
              <Progress
                value={
                  nextMilestone.elementCount > 0
                    ? (nextMilestone.completedCount /
                        nextMilestone.elementCount) *
                      100
                    : 0
                }
                aria-label={t`Elements done`}
                className="h-1.5 min-w-0"
                indicatorClassName="bg-foreground/70"
              />
              <div className="flex items-baseline justify-between gap-4 text-xs text-muted-foreground tabular-nums">
                <span>
                  <Trans>Elements done</Trans>
                </span>
                <span>
                  {nextMilestone.completedCount} / {nextMilestone.elementCount}
                </span>
              </div>
            </Link>
          ) : (
            <p className="rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">
              <Trans>No upcoming milestone</Trans>
            </p>
          )}
        </OverviewSection>
      </div>

      <OverviewSection title={t`Needs attention`}>
        <div className="rounded-lg border border-border p-1">
          {attention.length > 0 ? (
            attention
          ) : (
            <p className="flex min-h-9 items-center px-3 text-sm text-muted-foreground">
              <Trans>Nothing needs attention</Trans>
            </p>
          )}
        </div>
      </OverviewSection>
    </div>
  );
}

/** A small heading over its content: no card header bar, no divider. */
function OverviewSection({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <Subheading as="h3">{title}</Subheading>
      {children}
    </section>
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
      className="flex min-h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors hover:bg-accent/50"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <LuChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
