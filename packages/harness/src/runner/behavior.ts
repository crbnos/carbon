import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Binding } from "../binding";
import { screenshotsDir } from "../layout";
import { tryExtractJson } from "./prompts";
import { sq } from "./shell";
import type { BehaviorResult, RunnerConfig, RunnerDeps, Shell } from "./types";

/** Read one `KEY=value` line out of the worktree's `.env.local`. */
function readEnvVar(cwd: string, key: string): string | undefined {
  try {
    const env = readFileSync(join(cwd, ".env.local"), "utf8");
    const m = env.match(new RegExp(`^${key}=(.+)$`, "m"));
    return m?.[1]?.trim();
  } catch {
    return undefined;
  }
}

/**
 * The base URLs to try, in order: the portless `*.dev` host, then the localhost
 * backend (the app may be up on its port even when the portless proxy/cert is
 * flaky). Empty entries are dropped.
 */
function candidateUrls(cwd: string): string[] {
  const erpUrl = readEnvVar(cwd, "ERP_URL");
  const port = readEnvVar(cwd, "PORT_ERP");
  return [erpUrl, port ? `http://localhost:${port}` : undefined].filter(
    (u): u is string => Boolean(u)
  );
}

/** Is `url` serving? 2xx/3xx/4xx all count — the app responded; only a refused/timed-out connection fails. */
export function reachable(url: string, shell: Shell): boolean {
  const r = shell(`curl -k -s -o /dev/null -m 8 -w "%{http_code}" ${sq(url)}`);
  const code = Number.parseInt(r.output.trim(), 10);
  return Number.isFinite(code) && code >= 200 && code < 500;
}

/**
 * Make the app reachable, deterministically. Probe the candidates; if none
 * answer, make ONE bounded boot attempt (`crbn up --no-apps` brings up the
 * services and returns) and re-probe. Returns the live base URL, or a `blocked`
 * note — boot is environmental, so failure stops the loop rather than churning.
 */
export function ensureStack(
  cwd: string,
  shell: Shell,
  log: RunnerDeps["log"]
): { baseUrl: string } | { blocked: string } {
  const candidates = candidateUrls(cwd);
  if (candidates.length === 0) {
    return {
      blocked: "no ERP_URL/PORT_ERP in .env.local — is this a Carbon worktree?"
    };
  }
  for (const url of candidates) {
    if (reachable(url, shell)) return { baseUrl: url };
  }

  log({
    event: "behavior:boot",
    msg: "stack not reachable, attempting crbn up --no-apps"
  });
  shell("CARBON_DEV_YES=1 crbn up --no-apps", { cwd });
  for (const url of candidates) {
    if (reachable(url, shell)) return { baseUrl: url };
  }
  return {
    blocked: `ERP not reachable (tried ${candidates.join(", ")}); start the stack with app servers (\`crbn up\`) before UI loops`
  };
}

export function buildBehaviorPrompt(
  binding: Binding,
  baseUrl: string,
  email: string,
  shotDir: string
): string {
  return `You are the BEHAVIOR GATE in an unattended conductor loop. The code change is already applied in this worktree. Your job: prove — in the RUNNING app — whether the fix works. There is NO human; never ask a question.

Work item (${binding.kind}): ${binding.title}

Acceptance criteria:
${binding.acceptance.map((c, i) => `  [${i}] ${c}`).join("\n")}
${binding.notes ? `\nGrooming context (may include repro steps / test-data hints):\n${binding.notes}\n` : ""}
The app is reachable at ${baseUrl}. Use the \`agent-browser\` CLI (open / wait --load networkidle / snapshot -i / fill / click / screenshot).

Steps:
1. Log in via the dev bypass: open ${baseUrl}/login, fill the email field with "${email}", submit, and wait until you land on /x (the authenticated app). If login itself fails, that is UNVERIFIED (environmental), not a fail.
2. Navigate to the screen the work item affects and REPRODUCE the exact condition it describes (e.g. the specific record/state). Do not test a happy path that sidesteps the bug.
3. If the needed records/state don't exist, spend a MODEST effort creating the minimal data through the UI or existing seed data. If the condition needs extensive data generation you cannot complete reliably (long transaction chains, many linked entities), STOP EARLY and return verdict "unverified" — do not burn the whole budget trying.
4. Verify whether the change actually works on that screen.
5. Capture screenshots to: ${shotDir} (use explicit file paths like ${shotDir}/after-<label>.png). At least one screenshot is required for a "passed" verdict.

Your verdict must distinguish DISPROOF from ABSENCE OF PROOF:
- "passed": you reproduced the relevant condition and SAW the acceptance behavior work, with screenshots.
- "failed": you REACHED the relevant condition and the behavior is still wrong — the change is disproven. Screenshot the wrong behavior.
- "unverified": you could NOT reach the condition either way (login/environment failure, test data you could not construct, state unreachable). Say exactly what proof is missing and what a human would need to do to verify. NEVER report "failed" when the truth is "could not test".

End your reply with EXACTLY one fenced json block, no prose after it:
\`\`\`json
{
  "verdict": "passed" | "failed" | "unverified",
  "screenshots": ["${shotDir}/after-...png", "..."],
  "notes": "<what you reproduced and observed, or exactly what proof is missing>"
}
\`\`\``;
}

/** Prompt for the best-effort BEFORE capture (the fix is temporarily reverted). */
export function buildBeforePrompt(
  binding: Binding,
  baseUrl: string,
  email: string,
  shotDir: string
): string {
  return `You are capturing a BEFORE screenshot for an unattended conductor loop. The fix has been TEMPORARILY REVERTED, so the running app currently shows the BUG. There is NO human; never ask a question.

Work item (${binding.kind}): ${binding.title}
The failing condition: ${binding.acceptance[0] ?? binding.title}

The app is at ${baseUrl}. Log in via the dev bypass (email "${email}") if not already authenticated, navigate to the affected screen, and REPRODUCE the bug. The app was just hot-reloaded to the reverted code — reload the page and wait for it to settle before capturing. Capture ONE screenshot of the bug to ${shotDir}/before-01.png.

End your reply with EXACTLY one fenced json block, no prose after it:
\`\`\`json
{ "screenshots": ["${shotDir}/before-01.png"], "notes": "<what the bug looks like>" }
\`\`\``;
}

/**
 * Best-effort BEFORE capture: stash the doer's (uncommitted) fix so the app
 * shows the bug, screenshot it, then ALWAYS restore the fix. Failures here never
 * fail the gate — the AFTER capture is what verifies; before is a bonus for the
 * PR. Only stashes when there's actually a change to revert.
 */
function captureBefore(
  binding: Binding,
  cfg: RunnerConfig,
  deps: RunnerDeps,
  baseUrl: string,
  email: string,
  shotDir: string
): void {
  const { shell } = deps;
  const stash = shell("git stash push --include-untracked -m loop-before", {
    cwd: cfg.cwd
  });
  if (!stash.ok || /No local changes/.test(stash.output)) return;
  try {
    deps.claude({
      prompt: buildBeforePrompt(binding, baseUrl, email, shotDir),
      cwd: cfg.cwd,
      maxTurns: cfg.behaviorMaxTurns,
      maxBudgetUsd: cfg.behaviorMaxBudgetUsd
    });
  } catch {
    /* best-effort — the AFTER capture is what gates */
  } finally {
    shell("git stash pop", { cwd: cfg.cwd }); // ALWAYS restore the fix
  }
}

export function parseBehaviorResult(text: string): BehaviorResult {
  const raw = tryExtractJson<Partial<BehaviorResult> & { verdict?: string }>(
    text
  );
  // No verdict at all ⇒ the gate was cut off or misbehaved — that is absence
  // of proof, not disproof. Unverified, never a silent revert of the fix.
  if (!raw) {
    return {
      passed: false,
      screenshots: [],
      notes: "behavior gate returned no JSON verdict",
      unverified: "behavior gate returned no JSON verdict"
    };
  }
  const screenshots = Array.isArray(raw.screenshots) ? raw.screenshots : [];
  const notes = raw.notes ?? "";
  // Three-way verdict; tolerate the legacy `passed` boolean shape.
  const verdict = raw.verdict ?? (raw.passed === true ? "passed" : "failed");
  if (verdict === "passed") return { passed: true, screenshots, notes };
  if (verdict === "unverified") {
    return {
      passed: false,
      screenshots,
      notes,
      unverified: notes || "behavior gate could not verify either way"
    };
  }
  return { passed: false, screenshots, notes };
}

/**
 * The real UI behavior gate, matching `RunnerDeps.behaviorGate`. Deterministic
 * readiness check (blocks if the stack can't be brought up) + a model-driven
 * browser verification that must SEE the fix work and capture screenshots.
 */
export function behaviorGate(
  binding: Binding,
  cfg: RunnerConfig,
  deps: RunnerDeps
): BehaviorResult {
  const stack = ensureStack(cfg.cwd, deps.shell, deps.log);
  if ("blocked" in stack) {
    // Environmental — the gate can't even attempt verification. Absence of
    // proof, not disproof: the loop keeps judge-approved work and ships it
    // flagged for human verification instead of discarding it.
    return {
      passed: false,
      screenshots: [],
      notes: stack.blocked,
      unverified: stack.blocked
    };
  }

  const email = readEnvVar(cfg.cwd, "DEV_BYPASS_EMAIL") ?? "test@carbon.ms";
  const shotDir = screenshotsDir(cfg.cwd, binding.id);
  mkdirSync(shotDir, { recursive: true });

  // BEFORE (best-effort): show the bug with the fix reverted, then restore it.
  captureBefore(binding, cfg, deps, stack.baseUrl, email, shotDir);

  // AFTER (essential): verify the fix works and screenshot it.
  const res = deps.claude({
    prompt: buildBehaviorPrompt(binding, stack.baseUrl, email, shotDir),
    cwd: cfg.cwd,
    maxTurns: cfg.behaviorMaxTurns,
    maxBudgetUsd: cfg.behaviorMaxBudgetUsd
  });
  const result = parseBehaviorResult(res.text);
  // A capped/errored run never counts as verified — but it never counts as
  // DISPROOF either: the session ran out, the truth is "could not test".
  if (res.incomplete) {
    const notes =
      `${result.notes} [claude stopped: ${res.stopReason ?? "incomplete"}]`.trim();
    return { ...result, passed: false, notes, unverified: notes };
  }
  return result;
}
