// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { stopWorkEnd } from "@carbon/ee/project-control";
import { Badge, cn, Progress } from "@carbon/react";
import { RoundingMode, round } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
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
import { DateTime, EmployeeAvatar } from "~/components";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePercentFormatter,
  usePermissions,
  useRouteData
} from "~/hooks";
import { useItems, usePeople } from "~/stores";
import { path } from "~/utils/path";
import type {
  ProjectElementPriority,
  ProjectStateGroup
} from "../../projects.models";
import type { Project, ProjectState } from "../../types";
import { ElementPriorityIcon, sortStates } from "../Elements/ElementProperties";
import { ProjectDescription, ProjectProperties } from "./ProjectProperties";
import { StateIcon } from "./StateIcon";

type ProjectOverviewProps = {
  /** The company's today, `YYYY-MM-DD`. */
  today: string;
  figures: { budget: number | null; committed: number; actual: number };
  progress: {
    /** Work elements per state id. */
    stateCounts: Record<string, number>;
    total: number;
    done: number;
    cancelled: number;
    overdue: number;
  };
  comingUp: {
    id: string;
    name: string;
    stateGroup: ProjectStateGroup;
    stateColor: string;
    priority: ProjectElementPriority | null;
    targetDate: string;
    ownerId: string | null;
  }[];
  milestones: {
    id: string;
    name: string;
    endDate: string | null;
    completedAt: string | null;
  }[];
  activity: {
    id: string;
    kind: "comment" | "cost";
    at: string;
    userId: string | null;
    element: { id: string; name: string } | null;
    costType: string | null;
    quantity: number | null;
    unitOfMeasureCode: string | null;
    amount: number | null;
    itemId: string | null;
    isReversal: boolean;
  }[];
  openTimeCount: number;
  /** The members section, in DCAA timekeeping. */
  members?: ReactNode;
};

/**
 * The project's landing page: quiet cards in two columns. The left column is
 * the work — what it is about, how far it is, what is due next, the budget
 * and what needs attention; the right column is the project — its details
 * (each saved as it changes), milestones, members and recent activity.
 */
export default function ProjectOverview({
  today,
  figures,
  progress,
  comingUp,
  milestones,
  activity,
  openTimeCount,
  members
}: ProjectOverviewProps) {
  const { t } = useLingui();
  const { projectId } = useParams();
  if (!projectId) throw new Error("projectId not found");
  const permissions = usePermissions();
  const routeData = useRouteData<{
    project: Project;
    states: ProjectState[];
    overdueBorrowCount: number;
    openChangeRequests: { id: string }[];
  }>(path.to.project(projectId));
  const project = routeData?.project;
  if (!project) return null;

  const isDisabled =
    !permissions.can("update", "projects") || project.status === "Closed";

  return (
    <div className="@container mx-auto w-full max-w-[90rem] px-6 py-6">
      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <OverviewCard title={t`About`}>
            <ProjectDescription
              key={project.id}
              projectId={projectId}
              description={project.description}
              isDisabled={isDisabled}
            />
          </OverviewCard>
          <ProgressCard
            projectId={projectId}
            project={project}
            states={routeData?.states ?? []}
            progress={progress}
            today={today}
          />
          <ComingUpCard
            projectId={projectId}
            comingUp={comingUp}
            today={today}
          />
          <BudgetCard figures={figures} />
          <NeedsAttentionCard
            projectId={projectId}
            project={project}
            overdueBorrowCount={routeData?.overdueBorrowCount ?? 0}
            openChangeRequestCount={routeData?.openChangeRequests.length ?? 0}
            openTimeCount={openTimeCount}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <OverviewCard title={t`Details`}>
            <ProjectProperties />
          </OverviewCard>
          <MilestonesCard projectId={projectId} milestones={milestones} />
          {members}
          <ActivityCard projectId={projectId} activity={activity} />
        </div>
      </div>
    </div>
  );
}

/** A light card: a title row (with an optional link) over its content. */
function OverviewCard({
  title,
  action,
  flush = false,
  children
}: {
  title: string;
  action?: ReactNode;
  /** The content runs to the card's edges (a list of rows). */
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-border bg-card">
      <div className="flex min-h-12 items-center justify-between gap-2 px-5 pt-3 pb-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </div>
      <div className={cn("min-w-0", flush ? "pb-1" : "px-5 pb-5")}>
        {children}
      </div>
    </section>
  );
}

function CardLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
    </Link>
  );
}

/** How far the work is: done of all, by state, and the time left. */
function ProgressCard({
  projectId,
  project,
  states,
  progress,
  today
}: {
  projectId: string;
  project: Project;
  states: ProjectState[];
  progress: ProjectOverviewProps["progress"];
  today: string;
}) {
  const { t } = useLingui();
  const percent = usePercentFormatter();
  const { formatDate } = useDateFormatter();
  // Cancelled work is no longer part of the whole.
  const whole = progress.total - progress.cancelled;
  const shown = sortStates(states).filter(
    (state) => (progress.stateCounts[state.id] ?? 0) > 0
  );
  const daysLeft = project.endDate
    ? parseDate(project.endDate).compare(parseDate(today))
    : null;
  const due = project.endDate
    ? formatDate(project.endDate, { month: "short", day: "numeric" })
    : "";

  return (
    <OverviewCard
      title={t`Progress`}
      action={
        whole > 0 ? (
          <span className="text-sm text-muted-foreground tabular-nums">
            <Trans>
              {progress.done} of {whole} done
            </Trans>
          </span>
        ) : undefined
      }
    >
      {progress.total === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans>
            No work yet.{" "}
            <Link
              to={path.to.projectElements(projectId)}
              className="text-foreground hover:underline"
            >
              Plan the project
            </Link>
          </Trans>
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-4xl font-semibold tracking-tight tabular-nums">
              {percent.format(
                // Whole percents, rounded down: 100% only once all is done.
                whole > 0
                  ? round((progress.done * 100) / whole, 0, RoundingMode.Down) /
                      100
                  : 0
              )}
            </span>
            {daysLeft !== null &&
              (daysLeft >= 0 ? (
                <span className="text-sm text-muted-foreground">
                  <Trans>
                    <Plural value={daysLeft} one="# day" other="# days" /> until{" "}
                    {due}
                  </Trans>
                </span>
              ) : (
                <span className="text-sm text-red-500">
                  <Trans>
                    <Plural value={-daysLeft} one="# day" other="# days" /> past{" "}
                    {due}
                  </Trans>
                </span>
              ))}
            {progress.overdue > 0 && (
              <Badge variant="red" className="gap-1">
                <LuClock className="size-3" />
                <Plural
                  value={progress.overdue}
                  one="# overdue"
                  other="# overdue"
                />
              </Badge>
            )}
          </div>
          <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
            {shown.map((state) => (
              <div
                key={state.id}
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{
                  width: `${((progress.stateCounts[state.id] ?? 0) / progress.total) * 100}%`,
                  backgroundColor: state.color
                }}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {shown.map((state) => (
              <span key={state.id} className="flex items-center gap-1.5">
                <StateIcon group={state.group} color={state.color} />
                <span className="text-muted-foreground">{state.name}</span>
                <span className="font-medium tabular-nums">
                  {progress.stateCounts[state.id]}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </OverviewCard>
  );
}

/** The open work with a target date, soonest first. */
function ComingUpCard({
  projectId,
  comingUp,
  today
}: {
  projectId: string;
  comingUp: ProjectOverviewProps["comingUp"];
  today: string;
}) {
  const { t } = useLingui();
  const dueLabel = useDueLabel(today);
  return (
    <OverviewCard
      title={t`Coming up`}
      action={
        <CardLink to={path.to.projectElements(projectId)}>
          <Trans>View list</Trans>
        </CardLink>
      }
      flush
    >
      {comingUp.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-muted-foreground">
          <Trans>No open work has a target date.</Trans>
        </p>
      ) : (
        <ul className="flex flex-col">
          {comingUp.map((element) => {
            const due = dueLabel(element.targetDate);
            return (
              <li key={element.id} className="border-t border-border">
                <Link
                  to={path.to.projectElement(projectId, element.id)}
                  className="flex min-h-11 items-center gap-3 px-5 py-2 transition-colors hover:bg-accent/40"
                >
                  <StateIcon
                    group={element.stateGroup}
                    color={element.stateColor}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {element.name}
                  </span>
                  {element.priority && element.priority !== "None" && (
                    <span className="shrink-0">
                      <ElementPriorityIcon priority={element.priority} />
                    </span>
                  )}
                  <span
                    className={cn(
                      "w-20 shrink-0 text-right text-sm tabular-nums",
                      due.tone === "overdue"
                        ? "text-red-500"
                        : due.tone === "soon"
                          ? "text-amber-600 dark:text-amber-500"
                          : "text-muted-foreground"
                    )}
                  >
                    {due.label}
                  </span>
                  <span className="flex w-6 shrink-0 justify-center">
                    {element.ownerId && (
                      <EmployeeAvatar
                        employeeId={element.ownerId}
                        size="xs"
                        withName={false}
                      />
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </OverviewCard>
  );
}

/** "Yesterday", "Today", "Tomorrow", a weekday this week, else the date. */
function useDueLabel(today: string) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  return (date: string) => {
    const days = parseDate(date).compare(parseDate(today));
    if (days < -1) {
      return {
        label: formatDate(date, { month: "short", day: "numeric" }),
        tone: "overdue" as const
      };
    }
    if (days === -1) return { label: t`Yesterday`, tone: "overdue" as const };
    if (days === 0) return { label: t`Today`, tone: "soon" as const };
    if (days === 1) return { label: t`Tomorrow`, tone: "soon" as const };
    if (days < 7) {
      return {
        label: formatDate(date, { weekday: "short" }),
        tone: "later" as const
      };
    }
    return {
      label: formatDate(date, { month: "short", day: "numeric" }),
      tone: "later" as const
    };
  };
}

/** Actual and committed cost against the budget. */
function BudgetCard({ figures }: { figures: ProjectOverviewProps["figures"] }) {
  const { t } = useLingui();
  const money = useCurrencyFormatter();
  const percent = usePercentFormatter();
  const budget = figures.budget;
  const hasBudget = budget !== null && budget > 0;
  const isOverBudget = hasBudget && figures.actual > budget;
  const actualText = money.format(figures.actual);
  const budgetText = hasBudget ? money.format(budget) : "";
  const committedText = money.format(figures.committed);

  return (
    <OverviewCard
      title={t`Budget`}
      action={
        hasBudget ? (
          <span
            className={cn(
              "text-sm tabular-nums",
              isOverBudget ? "text-red-500" : "text-muted-foreground"
            )}
          >
            {percent.format(figures.actual / budget)}
          </span>
        ) : undefined
      }
    >
      {hasBudget ? (
        <div className="flex flex-col gap-3">
          <span className="text-sm tabular-nums">
            <span className={cn(isOverBudget && "text-red-500")}>
              {actualText}
            </span>{" "}
            <span className="text-muted-foreground">
              <Trans>of {budgetText}</Trans>
            </span>
          </span>
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
        </div>
      ) : (
        <p className="text-sm text-muted-foreground tabular-nums">
          <Trans>
            No budget set on the plan. Actual {actualText} · Committed{" "}
            {committedText}
          </Trans>
        </p>
      )}
    </OverviewCard>
  );
}

/** What needs a decision; the card shows only when something does. */
function NeedsAttentionCard({
  projectId,
  project,
  overdueBorrowCount,
  openChangeRequestCount,
  openTimeCount
}: {
  projectId: string;
  project: Project;
  overdueBorrowCount: number;
  openChangeRequestCount: number;
  openTimeCount: number;
}) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const stopWorkDate = project.stopWorkDate;
  const rows: ReactNode[] = [];
  if (stopWorkDate) {
    const start = formatDate(stopWorkDate);
    const end = formatDate(stopWorkEnd(stopWorkDate));
    rows.push(
      <AttentionRow
        key="stop-work"
        to={path.to.project(projectId)}
        icon={<LuOctagonX className="text-red-500" />}
      >
        <Trans>
          Stop-work order since {start}, ends {end}
        </Trans>
      </AttentionRow>
    );
  }
  if (overdueBorrowCount > 0) {
    rows.push(
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
    rows.push(
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
    rows.push(
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
  if (rows.length === 0) return null;
  return (
    <OverviewCard title={t`Needs attention`} flush>
      <div className="flex flex-col">{rows}</div>
    </OverviewCard>
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
      className="flex min-h-11 items-center gap-3 border-t border-border px-5 text-sm transition-colors hover:bg-accent/40"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <LuChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/** The milestones in order, each with its end date. */
function MilestonesCard({
  projectId,
  milestones
}: {
  projectId: string;
  milestones: ProjectOverviewProps["milestones"];
}) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  return (
    <OverviewCard
      title={t`Milestones`}
      action={
        <CardLink to={path.to.projectMilestones(projectId)}>
          <Trans>View schedule</Trans>
        </CardLink>
      }
    >
      {milestones.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans>No milestones yet.</Trans>
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {milestones.map((milestone) => (
            <li
              key={milestone.id}
              className="flex min-w-0 items-center gap-3 text-sm"
            >
              <span
                aria-hidden
                className={cn(
                  "size-2.5 shrink-0 rotate-45 rounded-[2px]",
                  milestone.completedAt ? "bg-emerald-500" : "bg-violet-500"
                )}
              />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  milestone.completedAt && "text-muted-foreground"
                )}
              >
                {milestone.name}
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {milestone.endDate
                  ? formatDate(milestone.endDate, {
                      month: "short",
                      day: "numeric"
                    })
                  : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </OverviewCard>
  );
}

/** The latest comments and posted costs, newest first. */
function ActivityCard({
  projectId,
  activity
}: {
  projectId: string;
  activity: ProjectOverviewProps["activity"];
}) {
  const { t } = useLingui();
  const [people] = usePeople();
  const [items] = useItems();
  const money = useCurrencyFormatter();
  const nameOf = (id: string | null) =>
    (id && people.find((person) => person.id === id)?.name) ?? t`Someone`;
  const itemOf = (id: string | null) =>
    (id && items.find((item) => item.id === id)?.readableIdWithRevision) ??
    t`A part`;

  return (
    <OverviewCard
      title={t`Recent activity`}
      action={
        <CardLink to={path.to.projectTime(projectId)}>
          <Trans>View costs</Trans>
        </CardLink>
      }
    >
      {activity.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans>No activity yet.</Trans>
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {activity.map((entry) => {
            const element = entry.element ? (
              <Link
                to={path.to.projectElement(projectId, entry.element.id)}
                className="font-medium text-foreground hover:underline"
              >
                {entry.element.name}
              </Link>
            ) : (
              <span className="font-medium text-foreground">
                <Trans>the project</Trans>
              </span>
            );
            const who = (
              <span className="font-medium text-foreground">
                {nameOf(entry.userId)}
              </span>
            );
            const quantity = `${entry.quantity ?? 0} ${entry.unitOfMeasureCode ?? ""}`;
            const amount = money.format(entry.amount ?? 0);
            return (
              <li key={entry.id} className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 shrink-0">
                  <EmployeeAvatar
                    employeeId={entry.userId}
                    size="xs"
                    withName={false}
                  />
                </span>
                <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                  {entry.kind === "comment" ? (
                    <Trans>
                      {who} commented on {element}
                    </Trans>
                  ) : entry.isReversal ? (
                    <Trans>
                      {who} reversed {amount} on {element}
                    </Trans>
                  ) : entry.costType === "Labor" ? (
                    <Trans>
                      {who} logged {quantity} on {element}
                    </Trans>
                  ) : entry.costType === "Material" ? (
                    <Trans>
                      {itemOf(entry.itemId)} was issued to {element}
                    </Trans>
                  ) : (
                    <Trans>
                      {amount} of {entry.costType} posted to {element}
                    </Trans>
                  )}
                </p>
                <span className="shrink-0 text-xs text-muted-foreground">
                  <DateTime value={entry.at} variant="relative" />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </OverviewCard>
  );
}
