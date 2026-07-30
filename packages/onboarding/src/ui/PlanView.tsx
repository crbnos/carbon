import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  cn,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import {
  LuCalendarClock,
  LuCheck,
  LuFileText,
  LuPlay,
  LuRotateCcw,
  LuTriangleAlert
} from "react-icons/lu";
import { PAGE_COPY } from "../content";
import { BOARD_TASKS, boardTasksForScope } from "../content/board";
import { SPINE } from "../content/spine";
import {
  boardTasksForTier,
  effectiveGateStatus,
  formatDate,
  ownerForStep,
  ownerLeadLabel,
  planAnchorId,
  resolveTimeline,
  setupAnchorId,
  spineForTier,
  stepTaskProgress,
  taskKey,
  taskSetupProgress,
  taskStatus,
  tasksForStep
} from "../logic";
import type { BoardTask, GateValue, StateKind, StepDef, Tier } from "../types";
import { ProgressPill } from "./ProgressPill";
import { DerivedStatus, LearnLink, PageHeader } from "./primitives";
import {
  useCheckMap,
  useExclusions,
  useFieldMap,
  useHubActions,
  useResolveVideoUrl,
  useSignals,
  useTier
} from "./state";

// The phases as cards. Each card's checklist is the phase's Project Board tasks;
// ticking one here writes the same task state the board reads (no drift).
// Read-only re: dates — the timeline is configured in Setup & Controls.
export function PlanView({
  onOpenSetupMap
}: {
  // Jump to the Setup Map — Configure's checklist derives its status from
  // there, so its tasks aren't manually tickable here. An optional anchor id
  // deep-links straight to the matching group's section.
  onOpenSetupMap?: (anchorId?: string) => void;
} = {}) {
  const { t, i18n } = useLingui();
  const map = useCheckMap();
  const fields = useFieldMap();
  const tier = useTier();
  const signals = useSignals();
  const exclusions = useExclusions();
  const { setCheck, setGate } = useHubActions();
  const steps = spineForTier(SPINE, tier);
  const tasks = boardTasksForScope(
    boardTasksForTier(BOARD_TASKS, tier),
    exclusions.modules
  );
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
            Tick off each task as you complete it.
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

      <div className="flex flex-col gap-4">
        {steps.map((step) => {
          const progress = stepTaskProgress(tasks, step.key, map);
          return (
            <PhaseCard
              key={step.key}
              step={step}
              tier={tier}
              stepTasks={tasksForStep(tasks, step.key)}
              map={map}
              gateStatus={effectiveGateStatus(step, map, signals, progress)}
              progress={progress}
              onToggleTask={setCheck}
              onToggleGate={setGate}
              onOpenSetupMap={onOpenSetupMap}
            />
          );
        })}
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
  onToggleGate,
  onOpenSetupMap
}: {
  step: StepDef;
  tier: Tier;
  stepTasks: BoardTask[];
  map: Map<string, string>;
  gateStatus: GateValue;
  progress: { done: number; total: number };
  onToggleTask: (itemKey: string, kind: StateKind, value: string) => void;
  onToggleGate: (key: string, next: GateValue) => void;
  onOpenSetupMap?: (anchorId?: string) => void;
}) {
  const { t, i18n } = useLingui();
  const { done, total } = progress;
  const allDone = total > 0 && done === total;
  const gatePassed = gateStatus === "done";
  const gateInProgress = gateStatus === "prog";

  // Passing a checkpoint with tasks still open is allowed, but warned first —
  // the same confirm-with-warning pattern as finalizing a quote without
  // shipping costs.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const openTasks = stepTasks.filter(
    (task) => taskStatus(task, map) !== "done"
  );

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
          <span
            className={cn(
              "shrink-0 size-9 rounded-xl border flex items-center justify-center text-sm font-semibold tabular-nums",
              gatePassed
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                : gateInProgress
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-background"
            )}
          >
            {step.n}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-semibold tracking-tight">
                {i18n._(step.title)}
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
            <Badge
              variant={allDone ? "green" : "outline"}
              className="shrink-0 tabular-nums"
            >
              {done} / {total} <Trans>done</Trans>
            </Badge>
          ) : null}
        </div>

        {step.desc ? (
          <p className="text-sm text-muted-foreground mt-3">
            {i18n._(step.desc)}
          </p>
        ) : null}

        {/* The separate "Learn" block would duplicate the per-task Docs/Video
            badges when the phase's own tasks already carry links (Configure). */}
        {stepTasks.some((t) => t.docsUrl || t.academyUrl) ? null : (
          <PhaseResources step={step} />
        )}

        {stepTasks.length ? (
          <ul className="mt-4 flex flex-col gap-1">
            {stepTasks.map((task) => {
              const status = taskStatus(task, map);
              const isDone = status === "done";
              const isProg = status === "prog";
              // Setup-Map-derived tasks have no manual tick of their own — the
              // Setup Map is where the work actually happens.
              const fromSetupMap = !!task.setupKeys?.length;
              const checkbox = (
                <span
                  className={cn(
                    "shrink-0 mt-0.5 size-4 rounded border flex items-center justify-center transition-colors",
                    isDone
                      ? "bg-emerald-500 border-emerald-500 text-white"
                      : isProg
                        ? "bg-primary/15 border-primary"
                        : "bg-card border-input"
                  )}
                >
                  {isDone ? <LuCheck className="size-3" /> : null}
                </span>
              );
              const label = (
                <span className="min-w-0 flex flex-col">
                  <span
                    className={cn(
                      "text-sm truncate",
                      isDone && "line-through text-muted-foreground"
                    )}
                  >
                    {i18n._(task.label)}
                  </span>
                  {task.hint ? (
                    <span className="text-xs text-muted-foreground truncate">
                      {i18n._(task.hint)}
                    </span>
                  ) : null}
                </span>
              );

              // Setup rows aren't tickable here — they check themselves off as
              // their Setup Map rows are configured, so they get the derived
              // ring (never a checkbox) and the row opens the Setup Map, with
              // the module's Docs/Video links inline. An <a> can't nest in a
              // <button>, so these use a flex row of separate controls.
              if (fromSetupMap) {
                const setupProgress = taskSetupProgress(task, map);
                const taskName = i18n._(task.label);
                return (
                  <li
                    key={task.key}
                    className="group flex items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50 transition-colors"
                  >
                    <DerivedStatus
                      status={isDone ? "done" : isProg ? "prog" : "todo"}
                      fraction={
                        setupProgress.total > 0
                          ? setupProgress.done / setupProgress.total
                          : undefined
                      }
                      tooltip={
                        isDone
                          ? t`"${taskName}" is done — all ${setupProgress.total} of its Setup Map items are configured.`
                          : t`"${taskName}" checks itself off once its ${setupProgress.total} Setup Map items are marked "Configured" — ${setupProgress.done} of ${setupProgress.total} so far.`
                      }
                      className="size-4 mt-0.5"
                    />
                    <button
                      type="button"
                      onClick={() => onOpenSetupMap?.(setupAnchorId(task.key))}
                      title={t`Open the Setup Map`}
                      className="flex items-start gap-3 min-w-0 flex-1 text-left"
                    >
                      {label}
                    </button>
                    <div className="shrink-0 flex items-center gap-2 text-xs mt-0.5">
                      {task.docsUrl ? (
                        <LearnLink
                          href={task.docsUrl}
                          icon={<LuFileText className="size-3" />}
                        >
                          <Trans>Docs</Trans>
                        </LearnLink>
                      ) : null}
                      {task.academyUrl ? (
                        <LearnLink
                          href={task.academyUrl}
                          icon={<LuPlay className="size-3" />}
                        >
                          <Trans>Video</Trans>
                        </LearnLink>
                      ) : null}
                    </div>
                  </li>
                );
              }

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
                    className="group w-full flex items-start gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted/50 transition-colors"
                  >
                    {checkbox}
                    {label}
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
          gatePassed
            ? "bg-emerald-500/5"
            : gateInProgress
              ? "bg-primary/5"
              : "bg-card"
        )}
      >
        <div className="min-w-0 flex-1">
          <span className="text-muted-foreground">
            <Trans>Checkpoint ·</Trans>{" "}
          </span>
          <span className="font-medium">{i18n._(step.gate)}</span>
          {gateInProgress ? (
            // In-progress blue app-wide (BoP status language), not theme
            // primary — primary is near-black on neutral themes.
            <Badge variant="blue" className="ml-2">
              <Trans>In progress</Trans>
            </Badge>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            if (gatePassed) {
              onToggleGate(step.key, "todo");
            } else if (openTasks.length > 0) {
              setConfirmOpen(true);
            } else {
              onToggleGate(step.key, "done");
            }
          }}
          className={cn(
            "shrink-0 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xxs font-medium transition-colors active:scale-[0.97]",
            gatePassed
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
              : "bg-card hover:border-primary hover:text-primary"
          )}
        >
          {gatePassed ? (
            <>
              <LuCheck className="size-3" />
              <Trans>Passed</Trans>
              <span className="opacity-60">·</span>
              <LuRotateCcw className="size-3" />
              <Trans>Reopen</Trans>
            </>
          ) : (
            t`Mark checkpoint passed`
          )}
        </button>
      </div>

      <Modal open={confirmOpen} onOpenChange={setConfirmOpen}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>{t`Mark "${i18n._(step.gate)}" as passed?`}</ModalTitle>
            <ModalDescription>
              <Trans>
                Are you sure you want to pass this checkpoint? The{" "}
                {i18n._(step.title)} phase still has unfinished tasks.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Alert variant="destructive">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                <Trans>Tasks still open</Trans>
              </AlertTitle>
              <AlertDescription>
                <Trans>The following tasks are not done yet:</Trans>
                <ul className="list-disc py-2 pl-4">
                  {openTasks.map((task) => (
                    <li key={task.key}>{i18n._(task.label)}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              onClick={() => {
                setConfirmOpen(false);
                onToggleGate(step.key, "done");
              }}
            >
              <Trans>Mark checkpoint passed</Trans>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
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
            <LearnLink
              href={r.docsUrl}
              icon={<LuFileText className="size-3" />}
            >
              <Trans>Docs</Trans>
            </LearnLink>
          ) : null}
          {r.videoUrl ? (
            <LearnLink href={r.videoUrl} icon={<LuPlay className="size-3" />}>
              <Trans>Video</Trans>
            </LearnLink>
          ) : null}
        </div>
      ))}
    </div>
  );
}
