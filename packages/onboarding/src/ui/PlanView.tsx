import { cn } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useEffect, useRef } from "react";
import {
  LuArrowUpRight,
  LuCalendarClock,
  LuCheck,
  LuFileText,
  LuPlay
} from "react-icons/lu";
import { PAGE_COPY } from "../content";
import { BOARD_TASKS } from "../content/board";
import { SPINE } from "../content/spine";
import {
  boardTasksForTier,
  effectiveGateStatus,
  formatDate,
  ownerForStep,
  ownerLeadLabel,
  planAnchorId,
  resolveTimeline,
  spineForTier,
  stepTaskProgress,
  taskKey,
  taskStatus,
  tasksForStep
} from "../logic";
import type { BoardTask, GateValue, StateKind, StepDef, Tier } from "../types";
import { GanttChart } from "./GanttChart";
import { ProgressPill } from "./ProgressPill";
import { PageHeader } from "./primitives";
import {
  useCheckMap,
  useFieldMap,
  useHubActions,
  useResolveVideoUrl,
  useSignals,
  useTier
} from "./state";

// The phases as cards. Each card's checklist is the phase's Project Board tasks;
// ticking one here writes the same task state the board reads (no drift).
// Read-only re: dates — the timeline is configured in Setup & Controls.
export function PlanView() {
  const { t, i18n } = useLingui();
  const map = useCheckMap();
  const fields = useFieldMap();
  const tier = useTier();
  const signals = useSignals();
  const { setCheck, setGate } = useHubActions();
  const steps = spineForTier(SPINE, tier);
  const tasks = boardTasksForTier(BOARD_TASKS, tier);
  const tasksDone = tasks.filter((t) => taskStatus(t, map) === "done").length;

  // Target go-live = the resolved Go-Live checkpoint date (from the schedule set
  // in Setup & Controls). Display only; null until a project start/go-live is set.
  const timeline = resolveTimeline(steps, fields, i18n);
  const goLiveDate =
    timeline.bars.find((b) => b.key === "gate:golive")?.gateDate ?? null;

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <PageHeader
        title={i18n._(PAGE_COPY.plan.title)}
        lead={
          <Trans>
            The {steps.length} phases to go live, each ending at a checkpoint.
            Tick a task here and it updates on the Project Board too.
          </Trans>
        }
        aside={
          <ProgressPill
            done={tasksDone}
            total={tasks.length}
            label={t`tasks`}
          />
        }
      />

      {goLiveDate ? (
        <div className="rounded-xl border bg-card shadow-button-base px-4 py-3 flex items-center gap-3">
          <LuCalendarClock className="shrink-0 text-primary" />
          <span className="text-xxs uppercase tracking-wide font-medium text-muted-foreground shrink-0">
            <Trans>Target go-live</Trans>
          </span>
          <span className="text-sm font-medium">{formatDate(goLiveDate)}</span>
        </div>
      ) : null}

      <GanttChart steps={steps} />

      <div className="flex flex-col gap-4">
        {steps.map((step) => (
          <PhaseCard
            key={step.key}
            step={step}
            tier={tier}
            stepTasks={tasksForStep(tasks, step.key)}
            map={map}
            gateStatus={effectiveGateStatus(step, map, signals)}
            progress={stepTaskProgress(tasks, step.key, map)}
            onToggleTask={setCheck}
            onToggleGate={setGate}
          />
        ))}
      </div>
    </div>
  );
}

function PhaseCard({
  step,
  tier,
  stepTasks,
  map,
  gateStatus,
  progress,
  onToggleTask,
  onToggleGate
}: {
  step: StepDef;
  tier: Tier;
  stepTasks: BoardTask[];
  map: Map<string, string>;
  gateStatus: GateValue;
  progress: { done: number; total: number };
  onToggleTask: (itemKey: string, kind: StateKind, value: string) => void;
  onToggleGate: (key: string, next: GateValue) => void;
}) {
  const { t, i18n } = useLingui();
  const { done, total } = progress;
  const allDone = total > 0 && done === total;
  const gatePassed = gateStatus === "done";

  // Auto-pass the checkpoint when its tasks all complete — one-way, on the
  // incomplete→complete transition (and on mount if already complete, so the
  // screenshot case self-heals). The ref guard means a manual reopen sticks
  // instead of being re-passed every render.
  const wasAllDone = useRef(false);
  useEffect(() => {
    if (allDone && !wasAllDone.current && gateStatus !== "done") {
      onToggleGate(step.key, "done");
    }
    wasAllDone.current = allDone;
  }, [allDone, gateStatus, step.key, onToggleGate]);

  return (
    <div
      id={planAnchorId(step.key)}
      className="rounded-2xl border bg-card shadow-button-base overflow-hidden scroll-mt-6"
    >
      <div className="p-5 pb-4">
        <div className="flex items-start gap-4">
          <span className="shrink-0 size-9 rounded-xl border bg-background flex items-center justify-center text-sm font-semibold tabular-nums">
            {step.n}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-semibold tracking-tight">
                {i18n._(step.title)}
              </span>
              <span className="text-xxs uppercase tracking-wide rounded px-1.5 py-0.5 border text-muted-foreground font-medium">
                <Trans>Checkpoint:</Trans> {i18n._(step.gate)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {i18n._(step.timing)}
              {tier !== "self_serve"
                ? ` · ${i18n._(ownerLeadLabel(ownerForStep(step, tier)))}`
                : null}
            </div>
          </div>
          {total > 0 ? (
            <span
              className={cn(
                "shrink-0 text-xxs font-medium rounded px-1.5 py-0.5 tabular-nums",
                allDone
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border text-muted-foreground"
              )}
            >
              {done} / {total} <Trans>done</Trans>
            </span>
          ) : null}
        </div>

        {step.desc ? (
          <p className="text-sm text-muted-foreground mt-3">
            {i18n._(step.desc)}
          </p>
        ) : null}

        <PhaseResources step={step} />

        {stepTasks.length ? (
          <ul className="mt-4 flex flex-col gap-1">
            {stepTasks.map((task) => {
              const isDone = taskStatus(task, map) === "done";
              return (
                <li key={task.key}>
                  <button
                    type="button"
                    onClick={() =>
                      onToggleTask(
                        taskKey(task.key),
                        "task",
                        isDone ? "todo" : "done"
                      )
                    }
                    className="w-full flex items-start gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted/50 transition-colors"
                  >
                    <span
                      className={cn(
                        "shrink-0 mt-0.5 size-4 rounded border flex items-center justify-center transition-colors",
                        isDone
                          ? "bg-emerald-500 border-emerald-500 text-white"
                          : "bg-card border-input"
                      )}
                    >
                      {isDone ? <LuCheck className="size-3" /> : null}
                    </span>
                    <span
                      className={cn(
                        "text-sm",
                        isDone && "line-through text-muted-foreground"
                      )}
                    >
                      {i18n._(task.label)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      <div
        className={cn(
          "px-5 py-3 border-t text-xs flex items-center gap-3 transition-colors",
          gatePassed ? "bg-emerald-500/5" : "bg-card"
        )}
      >
        <div className="min-w-0 flex-1">
          <span className="text-muted-foreground">
            <Trans>Checkpoint ·</Trans>{" "}
          </span>
          <span className="font-medium">{i18n._(step.gate)}</span>
        </div>
        <button
          type="button"
          onClick={() => onToggleGate(step.key, gatePassed ? "todo" : "done")}
          className={cn(
            "shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xxs font-medium transition-colors active:scale-[0.97]",
            gatePassed
              ? "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
              : "border bg-card hover:border-primary hover:text-primary"
          )}
        >
          {gatePassed ? (
            <>
              <LuCheck className="size-3" />
              <Trans>Passed · reopen</Trans>
            </>
          ) : (
            t`Mark checkpoint passed`
          )}
        </button>
      </div>
    </div>
  );
}

// Docs + video links for a phase, pulled from its nested product steps. Videos
// resolve through the ERP-injected trainingConfig (useResolveVideoUrl); a step
// with neither a doc nor a resolvable video is dropped.
function PhaseResources({ step }: { step: StepDef }) {
  const { i18n } = useLingui();
  const resolveVideoUrl = useResolveVideoUrl();
  const items = (step.nested ?? [])
    .map((n) => ({
      key: n.key,
      label: n.label,
      docsUrl: n.docsUrl,
      videoUrl: n.videoKey ? resolveVideoUrl(n.videoKey) : undefined
    }))
    .filter((r) => r.docsUrl || r.videoUrl);

  if (items.length === 0) return null;

  return (
    <div className="mt-4 flex flex-col gap-1.5">
      <div className="text-xxs uppercase tracking-wide font-medium text-muted-foreground">
        <Trans>Learn</Trans>
      </div>
      {items.map((r) => (
        <div key={r.key} className="flex items-center gap-2 text-xs">
          <span className="flex-1 min-w-0 truncate text-muted-foreground">
            {i18n._(r.label)}
          </span>
          {r.docsUrl ? (
            <ResourceLink
              href={r.docsUrl}
              icon={<LuFileText className="size-3" />}
            >
              <Trans>Docs</Trans>
            </ResourceLink>
          ) : null}
          {r.videoUrl ? (
            <ResourceLink
              href={r.videoUrl}
              icon={<LuPlay className="size-3" />}
            >
              <Trans>Video</Trans>
            </ResourceLink>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ResourceLink({
  href,
  icon,
  children
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="shrink-0 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
    >
      {icon}
      {children}
      <LuArrowUpRight className="size-3 opacity-60" />
    </a>
  );
}
