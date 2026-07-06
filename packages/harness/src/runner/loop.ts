import type { Binding } from "../binding";
import { FLOOR_GATES, runGates } from "../gates";
import { appendLedger, readLedger } from "../ledger";
import { resolvePlan } from "./plan";
import {
  buildDoerPrompt,
  buildJudgePrompt,
  parseDoerResult,
  parseJudgeResult,
  type TaskContext
} from "./prompts";
import { sq } from "./shell";
import type {
  JudgeResult,
  LoopOutcome,
  RunnerConfig,
  RunnerDeps,
  Shell
} from "./types";

/** Anything uncommitted — tracked modifications AND untracked files. */
function isDirty(shell: Shell, cwd: string): boolean {
  return shell("git status --porcelain", { cwd }).output.trim().length > 0;
}

function commit(shell: Shell, cwd: string, message: string): void {
  shell("git add -A", { cwd });
  // sq() single-quotes the message — the doer's summary may contain backticks/$.
  shell(`git commit -m ${sq(message)}`, { cwd });
}

/**
 * Best-effort push after every commit — commit early, push often. A crashed
 * process (the #1031 / #1005 failure mode) then loses at most one uncommitted
 * edit; everything else is already on origin. Failure (offline, no remote) is
 * logged and ignored — never fatal.
 */
function push(shell: Shell, cwd: string, log: RunnerDeps["log"]): void {
  // force-with-lease: after a task rescue the shipping branch resets behind
  // origin — force-updating it is safe because the rescue branch already
  // preserved those commits, and the run mutex makes this branch's only writer
  // this loop.
  const r = shell("git push --force-with-lease -u origin HEAD", { cwd });
  if (!r.ok) log({ event: "push:failed", output: r.output.slice(0, 500) });
}

function headSha(shell: Shell, cwd: string): string {
  return shell("git rev-parse HEAD", { cwd }).output.trim();
}

function revertReason(
  gates: Record<string, boolean>,
  judge: JudgeResult
): string {
  const failed = Object.entries(gates)
    .filter(([, ok]) => !ok)
    .map(([id]) => id);
  if (failed.length > 0) return `gates failed: ${failed.join(", ")}`;
  if (!judge.approved) return `judge rejected: ${judge.feedback}`;
  return "not approved";
}

/**
 * Drive ONE work item through the conductor cycle to a green committed state,
 * fully unattended. This is the deterministic spine of the conductor skill,
 * promoted out of prose into code — and out of the (possibly weak) outer-loop
 * model's judgment. The harness owns:
 *
 * - CHUNKING: a planner phase decomposes the binding into small ordered tasks
 *   (deterministic fallback: one whole-binding task). Each task is one
 *   doer-session-sized unit with its own judge review.
 * - CHECKPOINTS: every doer pass is committed AND pushed before gates run.
 *   Failures fix forward on top of the checkpoint; nothing is ever discarded
 *   by `git checkout -- .`.
 * - RESCUE: a task that exhausts its attempts pushes them to a rescue branch
 *   before resetting to the last green checkpoint — preserved, reviewable,
 *   out of the shipping branch.
 *
 * Pure w.r.t. the outside world — every side effect goes through `deps`. The
 * caller (the script) creates the worktree and opens the PR. This function
 * never merges and never runs on `main`.
 */
export function runLoop(
  binding: Binding,
  config: RunnerConfig,
  deps: RunnerDeps
): LoopOutcome {
  const { claude, shell, now, log } = deps;
  const { cwd, ledgerPath } = config;
  let iteration = 0;
  // Consecutive tasks concluded without any judge verdict (even after retries)
  // — a persistent judge outage shouldn't keep burning doer budget.
  let judgeMissingStreak = 0;

  // Phase 0: PLAN — systematic chunking, in code not in model judgment. A
  // prior non-shipped run on this branch RESUMES: its plan and task statuses
  // come back from outcome.json, concluded tasks are skipped for free.
  const { tasks, status, resumed, ...carried } = resolvePlan(
    binding,
    config,
    deps
  );
  // Proof gaps on KEPT work and product questions raised along the way — both
  // ride the outcome so the PR/issue gets flagged instead of the work
  // vanishing. Seeded from the resumed run so its flags survive re-dispatch.
  const unverified: string[] = [...carried.unverified];
  const questions: string[] = [...carried.questions];

  const end = (state: LoopOutcome["state"], reason: string): LoopOutcome => {
    log({ event: "loop:end", state, reason, iterations: iteration });
    return {
      state,
      iterations: iteration,
      reason,
      plan: tasks.map((t, i) => ({
        title: t.title,
        detail: t.detail,
        criteria: t.criteria,
        status: status[i] ?? "pending"
      })),
      ...(unverified.length > 0
        ? { unverified: [...new Set(unverified)] }
        : {}),
      ...(questions.length > 0 ? { questions: [...new Set(questions)] } : {})
    };
  };

  for (let k = 0; k < tasks.length; k++) {
    const task = tasks[k];
    if (!task) continue;
    const taskLabel = `${k + 1}/${tasks.length}: ${task.title}`;
    // Resumed runs skip already-concluded tasks — no doer/judge spend.
    if (status[k] === "done" || status[k] === "flagged") {
      log({ event: "task:skip", task: taskLabel, status: status[k], resumed });
      continue;
    }
    const startSha = headSha(shell, cwd);
    const ctx: TaskContext = {
      task,
      index: k + 1,
      total: tasks.length,
      ...(startSha ? { startSha } : {}),
      limits: { turns: config.doerMaxTurns, usd: config.doerMaxBudgetUsd }
    };
    // The doer chunks its own work too: a gate-green SLICE (doer reports
    // `remaining`) is progress — it resets the failure counter and skips the
    // judge. Only failures (red gates, judge rejection, no-op sessions) count
    // toward taskMaxAttempts. `maxIterations` bounds everything globally.
    let failed = 0;
    let slice = 0;

    while (failed < config.taskMaxAttempts) {
      if (iteration >= config.maxIterations) {
        return end(
          "plateau",
          `hit max iterations (${config.maxIterations}) during task ${taskLabel}`
        );
      }
      iteration++;
      slice++;
      try {
        const ledger = readLedger(ledgerPath);
        log({ event: "iteration:start", iteration, task: taskLabel, slice });

        // 1. DOER — one focused session on the current task, fixing forward.
        const doerRes = claude({
          prompt: buildDoerPrompt(binding, ledger, ctx),
          cwd,
          maxTurns: config.doerMaxTurns,
          maxBudgetUsd: config.doerMaxBudgetUsd
        });
        const doer = parseDoerResult(doerRes.text);
        log({
          event: "doer",
          iteration,
          task: taskLabel,
          change: doer.change,
          cost: doerRes.costUsd
        });

        // 2. CHECKPOINT — commit early, push often. The work is preserved
        // BEFORE anything gets a chance to fail.
        const dirty = isDirty(shell, cwd);
        if (dirty) {
          commit(
            shell,
            cwd,
            `loop(${binding.id}): [t${k + 1}.s${slice}] ${doer.change}`
          );
          push(shell, cwd, log);
        }

        if (doer.blocked) {
          // The checkpoint above already preserved anything it left behind.
          if (dirty) {
            appendLedger(ledgerPath, {
              iteration,
              change: doer.change,
              gates: {},
              decision: "checkpoint",
              reason: `doer blocked: ${doer.blocked}`,
              task: taskLabel,
              at: now()
            });
          }
          return end("blocked", `doer blocked: ${doer.blocked}`);
        }

        // 3. FLOOR GATES (lint + conformance + clobbers) and per-package
        // typecheck — on the committed state.
        const gates: Record<string, boolean> = {};
        const iterUnverified: string[] = [];
        if (dirty) {
          const floor = config.gates ?? FLOOR_GATES;
          for (const r of runGates(floor, (cmd) => shell(cmd, { cwd }))) {
            gates[r.id] = r.passed;
          }
          for (const pkg of doer.packages) {
            gates[`typecheck:${pkg}`] = shell(
              `pnpm --filter ${pkg} typecheck`,
              {
                cwd
              }
            ).ok;
          }

          // 4. BEHAVIOR GATE — UI changes are not done until seen working.
          if (doer.touchedUI) {
            if (!deps.behaviorGate) {
              return end(
                "blocked",
                "change touches UI but the headless behavior gate is not available (milestone 2)"
              );
            }
            const b = deps.behaviorGate(binding, config, deps);
            if (b.unverified) {
              // Absence of proof is not disproof — record the gap; the work
              // ships flagged for human verification.
              iterUnverified.push(b.unverified);
            } else {
              gates.behavior = b.passed;
            }
            log({
              event: "behavior",
              iteration,
              passed: b.passed,
              ...(b.unverified ? { unverified: b.unverified } : {}),
              shots: b.screenshots.length,
              notes: b.notes
            });
          }

          // 5. CORRECTNESS GATE — the reproduce→fix→same-path test.
          if (doer.testCommand) {
            gates.correctness = shell(doer.testCommand, { cwd }).ok;
          }
        }
        const gatesGreen = Object.values(gates).every(Boolean);

        // 6-pre. NO VERDICT — the doer session was cut off (cap) or garbled.
        // Absence of a verdict is not a blocker: the tree is already
        // checkpointed and pushed; count a failed attempt and give the task a
        // FRESH session with this in the ledger. (#1031's run died here.)
        if (doer.noVerdict) {
          failed++;
          appendLedger(ledgerPath, {
            iteration,
            change: doer.change,
            gates,
            decision: "checkpoint",
            reason:
              "fixing forward: doer session ended without a verdict (likely hit its turn/budget cap)",
            task: taskLabel,
            at: now()
          });
          continue;
        }

        // 6a. SLICE — the doer chunked itself: a gate-green, committed slice
        // with work remaining is progress. Checkpoint it, skip the judge
        // (nothing complete to approve yet), reset the failure counter, and
        // hand the next session the remaining work.
        if (doer.remaining && gatesGreen && dirty) {
          failed = 0;
          appendLedger(ledgerPath, {
            iteration,
            change: doer.change,
            gates,
            decision: "checkpoint",
            reason: `slice complete; remaining: ${doer.remaining}`,
            task: taskLabel,
            ...(iterUnverified.length > 0
              ? { unverified: iterUnverified }
              : {}),
            at: now()
          });
          continue;
        }

        // 6b. JUDGE — only worth a session when the doer says the task is
        // complete and the objective gates pass.
        let judge: JudgeResult = {
          approved: false,
          unmet: [],
          feedback: doer.remaining
            ? "session ended incomplete with no committable slice"
            : "gates failed"
        };
        if (gatesGreen && !doer.remaining) {
          const askJudge = () =>
            claude({
              prompt: buildJudgePrompt(binding, ctx),
              cwd,
              maxTurns: config.judgeMaxTurns,
              maxBudgetUsd: config.judgeMaxBudgetUsd
            });
          let judgeRes = askJudge();
          judge = parseJudgeResult(judgeRes.text);
          // No verdict (capped session / garbled output) ⇒ one fresh retry —
          // cheap next to the doer work a false "rejection" would discard.
          if (judge.verdictMissing) {
            log({
              event: "judge:retry",
              iteration,
              cost: judgeRes.costUsd,
              stopReason: judgeRes.stopReason
            });
            judgeRes = askJudge();
            judge = parseJudgeResult(judgeRes.text);
          }
          log({
            event: "judge",
            iteration,
            approved: judge.approved,
            unmet: judge.unmet,
            cost: judgeRes.costUsd,
            ...(judgeRes.stopReason ? { stopReason: judgeRes.stopReason } : {}),
            ...(judge.verdictMissing ? { verdictMissing: true } : {}),
            ...(judge.disputed ? { disputed: judge.disputed } : {})
          });
        }

        // Disputed criteria are product questions, not build targets — they
        // reach the PR/issue and stop counting as unmet.
        const disputedIdx = new Set((judge.disputed ?? []).map((d) => d.index));
        questions.push(
          ...(judge.disputed ?? []).map(
            (d) =>
              `Acceptance [${d.index}] "${binding.acceptance[d.index] ?? "?"}": ${d.question}`
          )
        );

        // 7. DECIDE. The task is DONE when gates are green, the judge approved,
        // and none of ITS criteria remain unmet (disputed ones excluded). A
        // judge with no verdict after retry concludes the task FLAGGED — kept
        // for human review, never reverted, never silently shipped-as-met.
        const judgeUnavailable = gatesGreen && judge.verdictMissing === true;
        const taskUnmet = judge.unmet.filter(
          (i) => task.criteria.includes(i) && !disputedIdx.has(i)
        );
        const taskDone = gatesGreen && judge.approved && taskUnmet.length === 0;

        if (taskDone || judgeUnavailable) {
          if (judgeUnavailable) {
            iterUnverified.push(
              `task ${taskLabel} kept WITHOUT judge review (no verdict after retry) — needs human code review`
            );
            judgeMissingStreak++;
          } else {
            judgeMissingStreak = 0;
          }
          status[k] = judgeUnavailable ? "flagged" : "done";
          unverified.push(...iterUnverified);
          questions.push(
            ...(doer.assumptions ?? []).map((a) => `Assumption: ${a}`)
          );
          appendLedger(ledgerPath, {
            iteration,
            change: doer.change,
            gates,
            decision: "keep",
            reason: judgeUnavailable
              ? "gates green; kept without judge verdict — pending human review"
              : iterUnverified.length > 0
                ? "gates green; judge approved (behavior proof incomplete)"
                : "gates green; judge approved",
            task: taskLabel,
            ...(iterUnverified.length > 0
              ? { unverified: iterUnverified }
              : {}),
            ...(doer.assumptions && doer.assumptions.length > 0
              ? { assumptions: doer.assumptions }
              : {}),
            at: now()
          });
          if (judgeMissingStreak >= 2) {
            return end(
              "blocked",
              "judge produced no verdict on 2 consecutive tasks (even after retries) — kept work needs human review"
            );
          }
          break; // next task
        }

        // Not done: the checkpoint STAYS on the branch (fix forward) — the
        // next attempt improves on it with the failure reason in the ledger.
        // This is the only path that counts toward taskMaxAttempts.
        failed++;
        appendLedger(ledgerPath, {
          iteration,
          change: doer.change,
          gates,
          decision: "checkpoint",
          reason: `fixing forward: ${
            gatesGreen && taskUnmet.length > 0 && judge.approved
              ? `criteria still unmet: ${taskUnmet.join(", ")}`
              : revertReason(gates, judge)
          }`,
          task: taskLabel,
          ...(iterUnverified.length > 0 ? { unverified: iterUnverified } : {}),
          at: now()
        });
      } catch (err) {
        // Unexpected failure (claude spawn error, git/fs error): preserve
        // whatever is in the tree as a checkpoint, record, end cleanly.
        const message = err instanceof Error ? err.message : String(err);
        try {
          if (isDirty(shell, cwd)) {
            commit(shell, cwd, `loop(${binding.id}): [error salvage] wip`);
            push(shell, cwd, log);
          }
        } catch {
          /* best-effort */
        }
        appendLedger(ledgerPath, {
          iteration,
          change: "(error)",
          gates: {},
          decision: "checkpoint",
          reason: `loop error: ${message}`,
          task: taskLabel,
          at: now()
        });
        return end("error", message);
      }
    }

    // Attempts exhausted without approval: RESCUE the attempts to a branch,
    // then reset the shipping branch to the task's start. Nothing is lost —
    // it's just not on the branch a human is asked to merge.
    if (status[k] === "pending") {
      status[k] = "failed";
      const rescue = `loop-rescue/${binding.id}/t${k + 1}`;
      const tip = headSha(shell, cwd);
      if (tip && tip !== startSha) {
        const pushed = shell(`git push origin HEAD:refs/heads/${rescue}`, {
          cwd
        });
        log({ event: "rescue", branch: rescue, pushed: pushed.ok });
        if (startSha) {
          shell(`git reset --hard ${startSha}`, { cwd });
          shell("git clean -fd", { cwd });
          push(shell, cwd, log); // won't move origin backwards; best-effort
        }
        appendLedger(ledgerPath, {
          iteration,
          change: `task ${taskLabel} attempts reset`,
          gates: {},
          decision: "revert",
          reason: `task failed after ${config.taskMaxAttempts} attempts; attempts preserved on ${
            pushed.ok ? rescue : `local history (rescue push failed)`
          }`,
          task: taskLabel,
          at: now()
        });
      }
      return end(
        "plateau",
        `task ${taskLabel} failed after ${config.taskMaxAttempts} attempts — attempts preserved on ${rescue}`
      );
    }
  }

  // Every task concluded (done or flagged).
  const flagged = status.filter((s) => s === "flagged").length;
  return end(
    "shipped",
    flagged > 0 || unverified.length > 0
      ? "all tasks concluded — needs human verification of the flagged parts"
      : "all acceptance criteria met and provable"
  );
}
