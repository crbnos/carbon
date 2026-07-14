import type { Binding } from "../binding";
import type { LedgerEntry } from "../ledger";
import type { DoerResult, JudgeResult, PlanTask } from "./types";

/** Task context threaded into the doer/judge prompts by the loop. */
export type TaskContext = {
  task: PlanTask;
  /** 1-based position and plan size, for orientation ("task 2 of 5"). */
  index: number;
  total: number;
  /** SHA at task start — the judge diffs `<sha>..HEAD` to see the task's work. */
  startSha?: string;
  /** The doer's session caps, so it can budget its slices instead of getting
   *  cut off mid-edit with no verdict. */
  limits?: { turns: number; usd: number };
};

function taskSection(binding: Binding, ctx: TaskContext | undefined): string {
  if (!ctx) return "";
  const criteria =
    ctx.task.criteria.length > 0
      ? ctx.task.criteria
          .map((i) => `  [${i}] ${binding.acceptance[i] ?? "?"}`)
          .join("\n")
      : "  (none mapped)";
  return `
YOUR CURRENT TASK (${ctx.index} of ${ctx.total} in the plan): ${ctx.task.title}
${ctx.task.detail}
This task advances these acceptance criteria (work on THESE only):
${criteria}
`;
}

/** Pull the last fenced ```json block out of model text. Throws if none parses. */
export function extractJson<T>(text: string): T {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  const last = blocks.at(-1)?.[1];
  if (!last) throw new Error("No ```json block in model output.");
  return JSON.parse(last.trim()) as T;
}

/** Like extractJson, but returns null instead of throwing — for total parsers. */
export function tryExtractJson<T>(text: string): T | null {
  try {
    return extractJson<T>(text);
  } catch {
    return null;
  }
}

function ledgerSummary(ledger: LedgerEntry[]): string {
  if (ledger.length === 0) return "(no prior iterations)";
  return ledger
    .map(
      (e) =>
        `#${e.iteration} ${e.decision.toUpperCase()} — ${e.change} (${e.reason})`
    )
    .join("\n");
}

function acceptanceList(binding: Binding): string {
  return binding.acceptance.map((c, i) => `  [${i}] ${c}`).join("\n");
}

/** Grooming context (the binding's markdown body), when the groomer wrote any. */
export function groomingNotes(binding: Binding): string {
  if (!binding.notes) return "";
  return `\nGrooming context (decisions already made — follow them instead of re-deciding):\n${binding.notes}\n`;
}

/**
 * The doer makes the SMALLEST change toward the weakest-covered acceptance
 * criterion, then reports a structured handoff. Encodes the conductor's §2.1
 * rules for an unattended agent: there is no human, so it never asks — it
 * decides or BLOCKS.
 */
export function buildDoerPrompt(
  binding: Binding,
  ledger: LedgerEntry[],
  ctx?: TaskContext
): string {
  return `You are the DOER in an unattended conductor loop. There is NO human watching — you may never ask a question; either make a change, or report \`blocked\`.

Work item (${binding.kind}, risk ${binding.risk}): ${binding.title}

Acceptance criteria (each is a definition of done):
${acceptanceList(binding)}
${groomingNotes(binding)}${taskSection(binding, ctx)}
Prior iterations (fix forward — earlier attempts are already committed; improve on them, don't start over):
${ledgerSummary(ledger)}

Your job THIS iteration:
- ${ctx ? "Complete YOUR CURRENT TASK above — nothing more. Other tasks in the plan are not your job this session." : "Make the SMALLEST change toward the weakest-covered acceptance criterion."} Do not batch unrelated changes.
- UI work: FIRST copy the nearest existing screen/component (precedent), don't design from concepts.
- ERP-domain logic (accounting, costing, tax, inventory valuation, RMAs): ground it in how real ERPs work; don't invent domain logic.
- Schema/migration changes: run \`pnpm run generate:types\` BEFORE any typecheck (stale types = false green).
- Module code: keep ONE \`<module>.service.ts\` and ONE \`<module>.models.ts\`; never scatter new ones.
- Correctness: write a test that FAILS on the bug/missing-feature and PASSES after your change. Report its exact command.

Chunk your own work — you have a hard turn/budget cap${ctx?.limits ? ` (about ${ctx.limits.turns} tool-use turns / $${ctx.limits.usd} for THIS session — a session that hits the cap mid-edit reports nothing and wastes its work)` : ""}:
- If the task will not fit comfortably in this session, STOP EARLY at a COHERENT SLICE: code that compiles, is lint-clean, and is safe to commit as-is. Report what's left in \`remaining\` — the loop checkpoints your slice and gives a fresh session this context to continue.
- A clean partial slice is SUCCESS; a complete-but-broken sprint to the buzzer is failure. Never race your limits, and never leave the tree half-edited at the end of your session.
- Prior slices are already committed — build on them, don't redo them.

Questions vs blockers — questions belong to GROOMING, not to this loop:
- NEVER block on a question of interpretation, preference, or an ambiguous acceptance criterion. Choose the most reasonable interpretation (prefer matching existing app behavior/precedent) and record it in \`assumptions\` — it will be surfaced on the PR for a human to confirm.
- Reserve \`blocked\` for hard impossibilities: missing credentials/secrets, the work requires a destructive or production-side action, or the issue's premise contradicts the code so completely that ANY change would be a guess.

You are running inside the loop's git worktree. Make your edits directly. Do NOT commit — the loop decides keep/revert. Do NOT open a PR.

End your reply with EXACTLY one fenced json block, no prose after it:
\`\`\`json
{
  "change": "<one line: what you changed>",
  "packages": ["@carbon/<pkg>", "..."],
  "testCommand": "<command that fails before / passes after, or \\"\\">",
  "touchedUI": <true if any user-facing UI changed, else false>,
  "remaining": "<omit when the task is COMPLETE; otherwise one line: what a fresh session should do next>",
  "assumptions": ["<interpretation you chose instead of asking>", "..."],
  "blocked": "<omit unless truly impossible without a human; then explain why>"
}
\`\`\``;
}

/**
 * The judge reviews the uncommitted working tree against acceptance + design
 * rules. A SEPARATE session — never the doer grading itself.
 */
export function buildJudgePrompt(binding: Binding, ctx?: TaskContext): string {
  const inspect = ctx?.startSha
    ? `Inspect the change yourself: run \`git diff ${ctx.startSha}..HEAD\` (the task's committed work) plus \`git status\` in the worktree.`
    : "Inspect the change yourself: run `git diff` (and `git status`) in the worktree.";
  return `You are the JUDGE in an unattended conductor loop. Review the ${ctx ? "current task's committed work" : "current UNCOMMITTED change"} against the acceptance criteria and Carbon's design rules. Be skeptical — do not rubber-stamp.

Work item (${binding.kind}, risk ${binding.risk}): ${binding.title}

Acceptance criteria:
${acceptanceList(binding)}
${groomingNotes(binding)}${taskSection(binding, ctx)}
${inspect} Check:
- Does the change actually advance the weakest criterion, with a real reproduce→fix→pass test?
- Does it follow Carbon conventions (module layout, RLS/migration rules, existing components over ad-hoc styles)?
- Is the scope minimal — no unrelated edits?
- For each acceptance criterion, is it now MET and provable?
${ctx ? "- `approved` judges THIS task's work; `unmet` lists ALL acceptance indices still unsatisfied across the whole work item (later tasks will cover theirs — that's expected)." : ""}

Disputed criteria — do NOT hold the loop hostage to a wrong spec:
- If a criterion rests on a premise the code contradicts (the mechanism it describes does not exist), or hinges on a product decision no agent can make, put it in \`disputed\` with a one-line question for the human and leave it OUT of \`unmet\`. Iterating cannot resolve a product question — it goes back to the issue instead.
- Dispute sparingly: a criterion that is merely hard is unmet, not disputed.

End your reply with EXACTLY one fenced json block, no prose after it:
\`\`\`json
{
  "approved": <true only if THIS change is correct, in-scope, and convention-clean>,
  "unmet": [<indices of acceptance criteria still NOT satisfied; empty array means all done>],
  "disputed": [{"index": <criterion index>, "question": "<one-line product question>"}],
  "feedback": "<concise: what's wrong, or what remains>"
}
\`\`\``;
}

export function parseDoerResult(text: string): DoerResult {
  const raw = tryExtractJson<Partial<DoerResult>>(text);
  // No verdict ⇒ the doer was cut off (limit) or misbehaved. Absence of a
  // verdict is not a blocker: the loop checkpoints the tree, counts a failed
  // attempt, and continues the task with a fresh session.
  if (!raw) {
    return {
      change: "(doer session ended without a verdict)",
      packages: [],
      testCommand: "",
      touchedUI: false,
      noVerdict: true
    };
  }
  const assumptions = Array.isArray(raw.assumptions)
    ? raw.assumptions.filter(
        (a): a is string => typeof a === "string" && a !== ""
      )
    : [];
  const remaining =
    typeof raw.remaining === "string" ? raw.remaining.trim() : "";
  return {
    change: raw.change ?? "(no summary)",
    packages: Array.isArray(raw.packages) ? raw.packages : [],
    testCommand: raw.testCommand ?? "",
    touchedUI: raw.touchedUI === true,
    ...(remaining ? { remaining } : {}),
    ...(assumptions.length > 0 ? { assumptions } : {}),
    ...(raw.blocked ? { blocked: raw.blocked } : {})
  };
}

export function parseJudgeResult(text: string): JudgeResult {
  const raw = tryExtractJson<Partial<JudgeResult>>(text);
  if (!raw)
    return {
      approved: false,
      unmet: [],
      verdictMissing: true,
      feedback: "judge returned no JSON verdict"
    };
  const disputed = Array.isArray(raw.disputed)
    ? raw.disputed.filter(
        (d): d is { index: number; question: string } =>
          typeof d === "object" &&
          d !== null &&
          typeof (d as { question?: unknown }).question === "string"
      )
    : [];
  return {
    approved: raw.approved === true,
    unmet: Array.isArray(raw.unmet) ? raw.unmet : [],
    ...(disputed.length > 0 ? { disputed } : {}),
    feedback: raw.feedback ?? ""
  };
}
