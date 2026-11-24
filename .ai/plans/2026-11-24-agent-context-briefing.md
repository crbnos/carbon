# Agent context briefing and the learning loop — implementation plan

**Spec:** .ai/specs/2026-11-24-agent-context-briefing.md
**Research:** .ai/research/2026-11-24-agent-context-briefing.md
**Closest sibling:** N/A (developer tooling). Precedents: `packages/checks/src/run.ts`, `baseline.ts`, `scripts/git-hooks/pre-commit`.
**Branch:** naveenkash/c09y6

## Progress
- [x] Task 1: Add the `yaml` dev dependency to `@carbon/checks`
- [x] Task 2: Write the scope module (triggers, globs, frontmatter)
- [x] Task 3: Add `triggers` to every single-file check
- [x] Task 4: Write the file-set table for single-file checks
- [x] Task 5: Add `triggers:` and `summary:` to the 89 rules
- [x] Task 6: Write the index builder
- [x] Task 7: Write the `brief` engine
- [x] Task 8: Write the `pnpm brief` command
- [ ] Task 9: Write the rule and check honesty tests
- [ ] Task 10: Write the PreToolUse hook and track the hook settings
- [ ] Task 11: Prove that the hook reaches the agent
- [x] Task 12: Split `.ai/lessons.md` into one file per lesson
- [ ] Task 13: Add scopes to the lessons and write the triage report
- [ ] Task 14: Write the lesson honesty tests
- [ ] Task 15: Write the signal inbox
- [ ] Task 16: Log gate failures and refused edits
- [ ] Task 17: Write the Stop and UserPromptSubmit hooks
- [ ] Task 18: Write the `/learn` skill
- [ ] Task 19: Write the weekly sweep script
- [ ] Task 20: Wire the skills and the AGENTS.md files
- [ ] Task 21: Run the final verification

## Dependencies
- Task 2 needs Task 1.
- Tasks 3, 4 and 5 need Task 2. They are independent of each other.
- Task 6 needs Tasks 3, 4 and 5.
- Task 7 needs Task 6. Task 8 needs Task 7.
- Task 9 needs Tasks 3, 4, 5 and 6.
- Task 10 needs Task 8. Task 11 needs Task 10.
- Task 12 needs Task 2. Task 13 needs Task 12. Task 14 needs Tasks 9 and 13.
- Task 15 needs Task 2. Task 16 needs Tasks 10 and 15. Task 17 needs Task 16.
- Task 18 needs Task 15. Task 19 needs Task 15.
- Task 20 needs Tasks 8, 13 and 18. Task 21 needs every other task.

## Shared definitions

Every task uses these names.

```ts
// packages/checks/src/brief/scope.ts
export type Trigger = string | { text: string; minCount: number };
export type Scope = { paths: string[]; triggers: Trigger[] };
```

```jsonc
// The index that buildBriefIndex returns (Task 6)
{
  "rules":   [{ "id": ".claude/rules/database-patterns.md", "title": "Database Access Patterns",
                "paths": ["…"], "triggers": ["…"], "summary": ["…"] }],
  "lessons": [{ "id": ".ai/lessons/count-invoices-from-the-view.md", "title": "…",
                "paths": ["…"], "triggers": ["…"], "rule": "…" }],
  "checks":  [{ "id": "route-action-shape", "set": "server", "description": "…",
                "replacedBy": "…", "triggers": ["…"] }]
}
```

Signal inbox line (Task 15):

```jsonc
{ "kind": "gate-failure" | "refused-edit" | "learned" | "stop-asked",
  "at": "2026-11-24T10:00:00.000Z", "worktree": "/abs/path", "branch": "naveenkash/c09y6",
  "checkId": "no-raw-redirect", "file": "apps/erp/app/routes/x+/a.tsx", "sessionId": "…" }
```

`at` is an absolute instant. The date rule allows a JavaScript `Date` for an absolute instant (`.claude/rules/date-handling.md` → Narrow exception).

---

## Task 1: Add the `yaml` dev dependency to `@carbon/checks`

**Depends on:** none
**Files:**
- Modify: `packages/checks/package.json` — add `"yaml": "2.9.1"` to `devDependencies`.

**Steps:**
1. Add `"yaml": "2.9.1"` to `devDependencies` in `packages/checks/package.json`.
2. Run `pnpm install` from the repository root.
3. If `pnpm install` downloads `yaml` instead of using the lockfile entry, STOP and report.

**Verify:**
```bash
pnpm --filter @carbon/checks exec node -e 'console.log(require("yaml").parse("a: [1]").a[0])'
# Expected: 1
git diff --stat pnpm-lock.yaml
# Expected: only the importer entry of packages/checks changes
```

**Out of scope:** any other package's dependencies.

## Task 2: Write the scope module (triggers, globs, frontmatter)

**Depends on:** Task 1
**Files:**
- Create: `packages/checks/src/brief/scope.ts`
- Create: `packages/checks/src/brief/scope.test.ts`

**Steps:**
1. Run `pnpm --filter @carbon/checks license-headers` after you create each new file.
2. Export `Trigger` and `Scope` from Shared definitions.
3. Export `matchesPath(path: string, globs: string[]): boolean`. Use `matchesGlob` from `node:path`.
4. Export `countOccurrences(text: string, needle: string): number`. It counts non-overlapping, case-sensitive matches.
5. Export `matchingTriggers(text: string, triggers: Trigger[]): Trigger[]`. A string matches when it occurs once. An object matches when it occurs `minCount` times or more.
6. Export `triggerText(trigger: Trigger): string`.
7. Export `parseFrontmatter(markdown: string): { data: Record<string, unknown>; body: string }`.
8. In `parseFrontmatter`, if the file does not start with `---\n`, return `{ data: {}, body: markdown }`.
9. In `parseFrontmatter`, parse the block with `parse` from `yaml`. Let a YAML error throw.
10. Export `readScope(data: Record<string, unknown>): Scope`. It returns `[]` for a missing `paths` or `triggers`. It throws on a value that is not a list of strings or `{ text, minCount }` objects.
11. Write tests with literal inputs:
    - `matchesPath("apps/erp/app/routes/x+/a.tsx", ["apps/erp/app/routes/**"])` is `true`.
    - `matchesPath("apps/mes/a.ts", ["apps/erp/**"])` is `false`.
    - `matchingTriggers("a.update(x); b.update(y)", [{ text: ".update(", minCount: 2 }])` has 1 entry.
    - The same call with one `.update(` returns `[]`.
    - `matchingTriggers("CTX.TRANSACTION", ["ctx.transaction"])` returns `[]`.
    - `parseFrontmatter` returns the body after the closing `---`.
    - `parseFrontmatter` throws on `---\npaths: [\n---\n`.

**Verify:**
```bash
pnpm --filter @carbon/checks exec vitest run src/brief/scope.test.ts
# Expected: all tests pass
```

**Out of scope:** reading files from disk. Task 6 reads them.

## Task 3: Add `triggers` to every single-file check

**Depends on:** Task 2
**Files:**
- Modify: `packages/checks/src/check.ts` — add `triggers: Trigger[]` to `ConformanceCheck`.
- Modify: each file in `packages/checks/src/conformance/` that defines a `ConformanceCheck` (39 files, plus the factories `noAuthzDdlInMigrations` and `noMissingAuditColumn`).

**Steps:**
1. Add this field to `ConformanceCheck` in `check.ts`, with `import type { Trigger } from "./brief/scope"`:
   ```ts
   /** Code text that shows the check's topic. brief lists the check when one occurs. */
   triggers: Trigger[];
   ```
2. For each check, read its `scan` function and its patterns.
3. Set `triggers` to the literal tokens that every violation must contain. Example: `noRawRedirect` gets `["react-router"]`. `noInlineUniqueViolation` gets `["23505"]`.
4. Use only tokens of 4 characters or more.
5. If a check has no literal token that every violation contains, use the most specific token that most violations contain. Write a one-line comment that says so.
6. Run `pnpm exec turbo run typecheck --filter=@carbon/checks`. Fix each check that the compiler reports as missing `triggers`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/checks
# Expected: Tasks: 1 successful (or more), 0 failed
pnpm --filter @carbon/checks test
# Expected: all tests pass (the gate test included)
```

**Out of scope:** any change to a check's `scan` logic, message or baseline. `StructureCheck` and the cross-file `find*` functions get no triggers.

## Task 4: Write the file-set table for single-file checks

**Depends on:** Task 2
**Files:**
- Create: `packages/checks/src/brief/file-sets.ts`
- Create: `packages/checks/src/brief/file-sets.test.ts`
- Modify: `packages/checks/src/sources/typescript.ts` — export `TYPESCRIPT_ROOTS`.
- Modify: `packages/checks/src/sources/server-files.ts` — export `SERVER_ROOTS`, `ERP_MODULES_ROOT`, `ERP_SERVER_SUFFIXES` and its `ROUTE_ROOTS` as `SERVER_ROUTE_ROOTS`.
- Modify: `packages/checks/src/sources/test-files.ts` — export a predicate `isTrackedTestPath(path: string): boolean` with the same rules as `TEST_PATHSPECS`.
- Copy from (precedent): the `scanAll` calls in `collectFindings`, `packages/checks/src/run.ts`.

**Steps:**
1. Define this type in `file-sets.ts`:
   ```ts
   export type FileSet = {
     name: "migrations" | "server" | "typescript" | "request-handling" | "routes" | "license" | "tests";
     includes(path: string): boolean;          // repo-relative path
     violationFile(path: string): string;      // migrations: basename; others: the path
     prepare(path: string, contents: string): string; // server: maskClientCode for routes
     checks(root: string): ConformanceCheck[];
   };
   export const FILE_SETS: FileSet[];
   ```
2. Copy the check lists from each per-file `scanAll` call in `collectFindings`:
   - `migrations`: `CONFORMANCE_CHECKS` plus `noAuthzDdlInMigrations(loadManagedFunctions(root))`.
   - `server`: `SERVER_CHECKS`.
   - `typescript`: `TS_CHECKS`, plus `noRawOrSearch`, `noRawRevalidator`, `noInlineSensorOptions`, `noBareOutlet`, `noStateCopyOfLoaderData`, `formFieldBudget`.
   - `request-handling`: `noRawForwardedHeaders`, `noInterpolatedErrorLog`, `noRawRedirect`, `linguiMacroMisuse`.
   - `routes`: `indexRedirectBeforeLoaders`.
   - `license`: `spdxLicenseHeader`.
   - `tests`: `TEST_CHECKS`.
3. Leave out `noMissingAuditColumn`. It needs the generated column map.
4. Write each `includes` from the exported roots and the walk rules. Skip `node_modules` and dot directories, and match the extensions. Use `isTest` from `sources/typescript.ts`, and `isLicenseCandidate` plus `classifyPath` from `license-headers.ts`.
5. Write a parity test. For each loader, every file it returns must pass the matching `includes`. The loaders are `loadSqlFiles`, `loadServerFiles`, `loadTypescriptFiles` (default roots, `REQUEST_HANDLING_ROOTS`, `ROUTE_ROOTS`), `loadLicenseFiles` and `loadTestFiles`.
6. Write a test that `includes` is `false` for 3 literal paths outside each set. Examples: `docs/README.md`, `apps/erp/app/routes/x+/a.test.tsx`, `node_modules/x/a.ts`.
7. Write a test that the set of check ids in `FILE_SETS` equals the ids of the per-file checks in step 2.

**Verify:**
```bash
pnpm --filter @carbon/checks exec vitest run src/brief/file-sets.test.ts
# Expected: all tests pass
```

**Out of scope:** any change to `collectFindings`, the loaders' behavior, or the gate.

## Task 5: Add `triggers:` and `summary:` to the 89 rules

**Depends on:** Task 2
**Files:**
- Modify: each file in `.claude/rules/*.md` (89 files) — frontmatter only.

**Steps:**
1. 🛑 Keep each rule's `paths:` list exactly as it is. A rule that loses `paths:` loads in every session.
2. Split the 89 files into 6 batches of about 15. Give each batch to one subagent. Use the prompt in step 7.
3. Add `triggers:` under `paths:` in each rule's frontmatter. Use 2 to 8 code tokens that show the rule's topic: function names, imports, table names, SQL keywords or API calls.
4. Use the object form `{ text: ".update(", minCount: 2 }` only when one occurrence is normal and several show the topic.
5. Add `summary:` with 1 to 5 lines. Each line says "Do X, not Y" or states one hard rule from the rule's own text. Each line is at most 160 characters.
6. Change nothing below the closing `---`.
7. Subagent prompt: "Add `triggers:` and `summary:` to the frontmatter of these rules: {list}. Follow Task 5 of `.ai/plans/2026-11-24-agent-context-briefing.md`. Each trigger has at least 4 characters and is a token that code on the topic contains. Do not change `paths:` or the body. Do not run typechecks. Write your report in STE-80 (`.claude/rules/writing-ste.md`)."
8. Review each batch. Make sure no trigger is a plain English word (`status`, `table`, `error`).

**Verify:**
```bash
pnpm --filter @carbon/checks exec tsx -e 'import {readdirSync,readFileSync} from "node:fs"; import {parseFrontmatter,readScope} from "./src/brief/scope"; const d="../../.claude/rules"; let bad=0; for (const f of readdirSync(d)) { const {data}=parseFrontmatter(readFileSync(d+"/"+f,"utf8")); const s=readScope(data); const sum=(data.summary as unknown[])??[]; if(!s.paths.length||!s.triggers.length||sum.length<1||sum.length>5){bad++;console.log(f)} } console.log("bad", bad)'
# Expected: bad 0
git diff --stat .claude/rules | tail -1
# Expected: 89 files changed
```

**Out of scope:** the body of any rule. New rules.

## Task 6: Write the index builder

**Depends on:** Tasks 3, 4 and 5
**Files:**
- Create: `packages/checks/src/brief/index-builder.ts`
- Create: `packages/checks/src/brief/index-builder.test.ts`

**Steps:**
1. Export `type BriefIndex` with the shape in Shared definitions.
2. Export `buildBriefIndex(root: string): BriefIndex`.
3. Read every `.claude/rules/*.md`. Take `title` from the first `# ` line of the body.
4. Read every `.ai/lessons/*.md` except `README.md`. If the directory does not exist, use `[]`. Take `rule` from the text after `**Rule:**`, up to the end of that paragraph.
5. Build `checks` from `FILE_SETS`: one entry per check per set, with `set` as the set name.
6. Keep the build in memory. Do not write a JSON file.
7. Measure `buildBriefIndex` on the real repository. If it takes more than 300 ms, STOP and report. A cache is then a design change.
8. Test with a temporary directory that holds 1 rule and 1 lesson. Assert the whole returned object with `toEqual`.

**Verify:**
```bash
pnpm --filter @carbon/checks exec vitest run src/brief/index-builder.test.ts
# Expected: all tests pass
pnpm --filter @carbon/checks exec tsx -e 'import {buildBriefIndex} from "./src/brief/index-builder"; const t=performance.now(); const i=buildBriefIndex("../.."); console.log(i.rules.length, Math.round(performance.now()-t)+"ms")'
# Expected: 89 and a time under 300ms
```

**Out of scope:** a generated, committed index file. The spec named one. The in-memory build removes the staleness test. Record this in the spec changelog in Task 21.

## Task 7: Write the `brief` engine

**Depends on:** Task 6
**Files:**
- Create: `packages/checks/src/brief/brief.ts`
- Create: `packages/checks/src/brief/brief.test.ts`

**Steps:**
1. Export this function:
   ```ts
   export type BriefInput = {
     root: string; path: string;                 // repo-relative
     before: string;                             // current content, "" for a new file
     after: string;                              // content after the planned edit
     index: BriefIndex; baseline: Set<string>;
     seen?: Set<string>;                         // entry ids already shown this session
   };
   export type Briefing = {
     refusals: { checkId: string; line: number; message: string; replacedBy: string }[];
     lessons: BriefIndex["lessons"]; rules: BriefIndex["rules"]; checks: BriefIndex["checks"];
   };
   export function brief(input: BriefInput): Briefing;
   ```
2. Set `text` to `after`. It holds both the current content and the edit.
3. For each `FileSet` whose `includes(path)` is `true`, run each check's `scan(set.violationFile(path), set.prepare(path, X))` with X = `before` and X = `after`.
4. Put a violation in `refusals` only if all 3 conditions are true:
   1. It occurs in `after`.
   2. Its `keyOf` key does not occur in `before`.
   3. Its key is not in `baseline`.
5. Select a rule or a lesson when `matchesPath(path, paths)` is true, or when `matchingTriggers(text, triggers)` is not empty.
6. Select a check entry when its set includes `path` and one of its triggers matches `text`.
7. Remove each selected entry whose id is in `seen`. Never remove a refusal.
8. Export `applyEdit(before: string, oldString: string, newString: string, replaceAll: boolean): string`.
9. Export `formatBriefing(b: Briefing, budgetChars = 8000): string`. It prints refusals, then lessons (title and `rule`), then rules (path and `summary`), then checks (id, description, `replacedBy`).
10. When the text passes `budgetChars`, print each remaining entry as its id only, under "More that applies".
11. Write tests with a fixture index and literal file text:
    - A route file with 2 `.update(` calls selects the transaction rule fixture. The rule's `paths:` holds only `*.service.ts`.
    - An `after` that adds `import { redirect } from "react-router"` to `apps/erp/app/routes/x+/a.tsx` gives 1 refusal with `checkId` `no-raw-redirect`.
    - The same violation in `before` and `after` gives no refusal.
    - A violation whose key is in `baseline` gives no refusal.
    - An entry id in `seen` is not returned.
    - With `budgetChars` 200, the output ends with "More that applies".

**Verify:**
```bash
pnpm --filter @carbon/checks exec vitest run src/brief/brief.test.ts
# Expected: all tests pass
```

**Out of scope:** reading stdin, the hook protocol, session state on disk.

## Task 8: Write the `pnpm brief` command

**Depends on:** Task 7
**Files:**
- Create: `packages/checks/src/scripts/brief.ts`
- Modify: `packages/checks/package.json` — add `"brief": "tsx src/scripts/brief.ts"`.
- Modify: `package.json` (root) — add `"brief": "pnpm --silent --filter @carbon/checks brief"`.

**Steps:**
1. Resolve each argument against `process.env.INIT_CWD ?? process.cwd()`. Then make it relative to `repoRoot()`.
2. For each file, read its content if it exists, else `""`. Call `brief` with `before = after = content`.
3. Print `formatBriefing` for each file under a `## <path>` heading.
4. Exit 0 always. A briefing is information, not a gate.

**Verify:**
```bash
printf 'export async function action() {\n  await client.from("a").update({}).eq("id", 1);\n  await client.from("b").update({}).eq("id", 2);\n}\n' > apps/erp/app/routes/x+/__brief_probe.tsx
pnpm brief apps/erp/app/routes/x+/__brief_probe.tsx
# Expected: the database-patterns summary, and the route-action-shape check entry
rm apps/erp/app/routes/x+/__brief_probe.tsx
```

**Out of scope:** the hook. Task 10 writes it.

## Task 9: Write the rule and check honesty tests

**Depends on:** Tasks 3, 4, 5 and 6
**Files:**
- Create: `packages/checks/src/brief/scopes.test.ts`

**Steps:**
1. Build the corpus once. Run `git ls-files -z -- apps packages`. Keep `.ts`, `.tsx` and `.sql` files that are not tests. Read their content.
2. Test 1: every rule's frontmatter parses, and its `paths:` is not empty.
3. Test 2: every trigger of every rule and every check has at least 4 characters.
4. Test 3: no rule trigger and no check trigger matches more than 25% of the corpus files.
5. Test 4: for each `FileSet`, scan each corpus file it includes. If a violation's file contains none of the check's triggers, fail. Name the check and the file.
6. Test 5: every rule has 1 to 5 `summary:` lines, each at most 160 characters.
7. Print the slowest step's time. If the file takes more than 60 s, STOP and report.

**Verify:**
```bash
pnpm --filter @carbon/checks exec vitest run src/brief/scopes.test.ts
# Expected: all tests pass
```

**Out of scope:** lessons. Task 14 adds them.

## Task 10: Write the PreToolUse hook and track the hook settings

**Depends on:** Task 8
**Files:**
- Modify: `.gitignore` — after `!.claude/skills/`, add `!.claude/settings.json` and `!.claude/hooks/`.
- Create: `.claude/settings.json`
- Create: `.claude/hooks/brief-pre-tool-use.sh`
- Create: `packages/checks/src/hooks/pre-tool-use.ts`
- Create: `packages/checks/src/hooks/session-state.ts`
- Create: `packages/checks/src/hooks/pre-tool-use.test.ts`

**Steps:**
1. 🛑 Run `git check-ignore -v .claude/settings.json` first. If a user file already exists there, STOP and report.
2. Write `session-state.ts`. Export `loadSeen(dir: string, sessionId: string): Set<string>` and `saveSeen(...)`. The file is `<dir>/carbon-brief-<sessionId>.json`.
3. In `pre-tool-use.ts`, export a pure `decide(input, deps): HookOutput | null`.
4. In `decide`, if `tool_name` is not `Edit`, `Write` or `MultiEdit`, return `null`.
5. In `decide`, if `file_path` is outside the repository root, return `null`.
6. Compute `after`:
   - For `Write`, use `content`.
   - For `Edit`, use `applyEdit`.
   - For `MultiEdit`, apply each edit in order.
7. If the briefing has refusals, return:
   ```json
   { "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny",
     "permissionDecisionReason": "<formatBriefing text>" } }
   ```
8. Else, if the briefing has entries, return `permissionDecision: "allow"` with `additionalContext` set to the text.
9. Else return `null`.
10. Add the returned ids to the seen set.
11. Write the `main` part: read stdin and call `decide`. Print the JSON only when the result is not `null`. Use `scratchpad_dir` from stdin, else `os.tmpdir()`.
12. Write `brief-pre-tool-use.sh`:
    ```bash
    #!/usr/bin/env bash
    # Briefs the agent before each edit and refuses an edit a check would fail.
    exec "$CLAUDE_PROJECT_DIR/packages/checks/node_modules/.bin/tsx" \
      "$CLAUDE_PROJECT_DIR/packages/checks/src/hooks/pre-tool-use.ts"
    ```
13. Run `chmod +x .claude/hooks/brief-pre-tool-use.sh`.
14. Write `.claude/settings.json`:
    ```json
    { "hooks": { "PreToolUse": [ { "matcher": "Edit|Write|MultiEdit",
      "hooks": [ { "type": "command",
        "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/brief-pre-tool-use.sh", "timeout": 20 } ] } ] } }
    ```
15. Test `decide` with literal stdin objects:
    - A `Write` of a route with a raw `react-router` redirect gives `deny`.
    - A `Read` gives `null`.
    - A path outside the repository gives `null`.
    - The second call with the same entries and the same session gives `null`.

**Verify:**
```bash
pnpm --filter @carbon/checks exec vitest run src/hooks/pre-tool-use.test.ts
# Expected: all tests pass
echo '{"session_id":"t1","tool_name":"Write","tool_input":{"file_path":"'"$PWD"'/apps/erp/app/routes/x+/__p.tsx","content":"import { redirect } from \"react-router\";\n"}}' | CLAUDE_PROJECT_DIR="$PWD" .claude/hooks/brief-pre-tool-use.sh
# Expected: JSON with "permissionDecision":"deny" and "no-raw-redirect"
```

**Out of scope:** the Stop and UserPromptSubmit hooks (Task 17). Logging the refusal (Task 16).

## Task 11: Prove that the hook reaches the agent

**Depends on:** Task 10
**Files:**
- Create: `.ai/runs/2026-11-24-agent-context-briefing-hook-probe.md`

**Steps:**
1. Run this headless session from the repository root:
   ```bash
   claude -p --permission-mode acceptEdits \
     'Write the file apps/erp/app/routes/x+/__probe.tsx with one line: import { redirect } from "react-router"; Then report, word for word, any reason you got for a refused edit.'
   ```
2. Check that the answer names `no-raw-redirect`. That proves the refusal reaches the agent.
3. Run a second probe. Write `apps/erp/app/modules/sales/__probe.service.ts` with two `.update(` calls, and ask the agent to quote any context it got before the write.
4. Check that the answer quotes the database-patterns summary. That proves `additionalContext` reaches the agent.
5. Delete both probe files if they exist.
6. Record both answers in the run log.
7. If probe 1 fails, STOP and report. The hook protocol is wrong.
8. If only probe 2 fails, continue. Write "additionalContext not delivered" in the run log, and add it to the spec Risks in Task 21.

**Verify:**
```bash
grep -c "no-raw-redirect" .ai/runs/2026-11-24-agent-context-briefing-hook-probe.md
# Expected: 1 or more
git status --short | grep __probe
# Expected: no output
```

**Out of scope:** changes to the hook to make probe 2 pass. Report the result instead.

## Task 12: Split `.ai/lessons.md` into one file per lesson

**Depends on:** Task 2
**Files:**
- Create: `packages/checks/src/scripts/split-lessons.ts`
- Create: `.ai/lessons/README.md`
- Create: `.ai/lessons/*.md` (one per `## ` heading, 421 files)
- Delete: `.ai/lessons.md`

**Steps:**
1. Write `split-lessons.ts`. It reads `.ai/lessons.md` and splits at each line that starts with `## `.
2. For each section, make the slug from the heading: lowercase, non-alphanumerics to `-`, at most 60 characters. Add `-2`, `-3` for a repeat.
3. Write each file:
   ```markdown
   ---
   paths: []
   triggers: []
   promoted: null
   ---
   # <heading text>

   <section body, unchanged>
   ```
4. Write `.ai/lessons/README.md`. It holds the format above, the rule that `pnpm brief` selects a lesson by `paths:` or `triggers:`, and the rule that a promoted lesson is deleted.
5. Run the script. Check that the file count equals the number of `## ` lines.
6. Delete `.ai/lessons.md`.
7. Find every reference with `rg -n --hidden "\.ai/lessons\.md" --glob '!node_modules' --glob '!.context/**'`.
8. Change each reference to `.ai/lessons/`. Use "run `pnpm brief <files>`" where the text tells the agent to read the lessons.

**Verify:**
```bash
ls .ai/lessons/*.md | grep -vc README.md
# Expected: the number printed by: git show HEAD:.ai/lessons.md | grep -c "^## "
rg -n --hidden "\.ai/lessons\.md" --glob '!node_modules' --glob '!.context/**' | wc -l
# Expected: 0
```

**Out of scope:** editing a lesson's text. Choosing scopes (Task 13).

## Task 13: Add scopes to the lessons and write the triage report

**Depends on:** Task 12
**Files:**
- Modify: `.ai/lessons/*.md` — frontmatter only.
- Create: `.ai/runs/2026-11-24-lesson-triage.md`

**Steps:**
1. 🛑 Delete no lesson in this task. Deletions need a human yes (spec Q9).
2. Split the lesson files into batches of about 50. Give each batch to one subagent with the prompt in step 6.
3. For each lesson, turn its "Applies to" text into `paths:` globs. A path in code font becomes a glob. A topic becomes `triggers:`.
4. Each lesson gets at least 1 path or 1 trigger.
5. Each subagent lists 3 groups in its report:
   1. Lessons that a rule or a check already states.
   2. Duplicate lessons, by file name.
   3. Lessons that name code that no longer exists.
6. Subagent prompt: "Add `paths:` and `triggers:` to the frontmatter of these lesson files: {list}. Follow Task 13 of `.ai/plans/2026-11-24-agent-context-briefing.md`. Each trigger has at least 4 characters. Change nothing below the frontmatter. Delete no file. Report the 3 groups of step 5 with file names and one-line reasons. Write your report in STE-80 (`.claude/rules/writing-ste.md`)."
7. Merge the reports into `.ai/runs/2026-11-24-lesson-triage.md`, in STE-80, one table per group.

**Verify:**
```bash
pnpm --filter @carbon/checks exec tsx -e 'import {readdirSync,readFileSync} from "node:fs"; import {parseFrontmatter,readScope} from "./src/brief/scope"; const d="../../.ai/lessons"; let bad=0; for (const f of readdirSync(d)) { if (f==="README.md") continue; const s=readScope(parseFrontmatter(readFileSync(d+"/"+f,"utf8")).data); if(!s.paths.length&&!s.triggers.length){bad++;console.log(f)} } console.log("bad",bad)'
# Expected: bad 0
```

**Out of scope:** deleting or promoting a lesson.

## Task 14: Write the lesson honesty tests

**Depends on:** Tasks 9 and 13
**Files:**
- Modify: `packages/checks/src/brief/scopes.test.ts`

**Steps:**
1. Add: every lesson's frontmatter parses.
2. Add: every lesson has at least 1 path or 1 trigger.
3. Add the lesson triggers to tests 2 and 3 of Task 9.
4. Add: a lesson with `promoted` set to a value other than `null` fails. The commit that promotes a lesson deletes it.

**Verify:**
```bash
pnpm --filter @carbon/checks exec vitest run src/brief/scopes.test.ts
# Expected: all tests pass
```

**Out of scope:** changing a lesson to make a test pass without fixing its scope.

## Task 15: Write the signal inbox

**Depends on:** Task 2
**Files:**
- Create: `packages/checks/src/learn/inbox.ts`
- Create: `packages/checks/src/learn/inbox.test.ts`

**Steps:**
1. Export `inboxPath(): string`. It returns `process.env.CARBON_LEARN_INBOX ?? join(homedir(), ".carbon", "learn-inbox.jsonl")`.
2. Export `type Signal` with the shape in Shared definitions.
3. Export `appendSignal(signal: Signal, path = inboxPath())`. Create the directory if needed. Append one JSON line.
4. Export `readSignals(path = inboxPath()): Signal[]`. Skip lines that do not parse.
5. Export `pendingSignals(signals: Signal[], worktree: string): Signal[]`. It returns the `gate-failure` and `refused-edit` signals of the worktree after its last `learned` signal.
6. Test with a temporary file and literal signals. Assert the whole returned list.

**Verify:**
```bash
pnpm --filter @carbon/checks exec vitest run src/learn/inbox.test.ts
# Expected: all tests pass
```

**Out of scope:** who writes the signals (Tasks 16 and 17).

## Task 16: Log gate failures and refused edits

**Depends on:** Tasks 10 and 15
**Files:**
- Create: `packages/checks/src/scripts/log-gate-failure.ts`
- Modify: `packages/checks/package.json` — add `"learn:log-gate": "tsx src/scripts/log-gate-failure.ts"`.
- Modify: `scripts/git-hooks/pre-commit` — call it when the conformance step fails.
- Modify: `packages/checks/src/hooks/pre-tool-use.ts` — append a `refused-edit` signal for each refusal.

**Steps:**
1. In `log-gate-failure.ts`, call `newViolations()`. Append one `gate-failure` signal per violation, with `worktree` = `repoRoot()` and `branch` from `git rev-parse --abbrev-ref HEAD`.
2. In `pre-commit`, inside the `if !` branch of the conformance step, add before the `exit`:
   ```bash
   pnpm --silent --filter @carbon/checks learn:log-gate >/dev/null 2>&1 || true
   ```
3. In the hook's `main`, append a `refused-edit` signal per refusal. Catch and ignore a write error, so the hook never fails.

**Verify:**
```bash
CARBON_LEARN_INBOX=/tmp/inbox-test.jsonl pnpm --filter @carbon/checks learn:log-gate; echo "exit $?"
# Expected: exit 0 (no new violations on a clean branch, so no lines)
pnpm --filter @carbon/checks exec vitest run src/hooks/pre-tool-use.test.ts
# Expected: all tests pass, including a refusal that writes one line to a temporary inbox
```

**Out of scope:** CI logging. The sweep reads CI through `gh` (Task 19).

## Task 17: Write the Stop and UserPromptSubmit hooks

**Depends on:** Task 16
**Files:**
- Create: `packages/checks/src/hooks/stop.ts`
- Create: `packages/checks/src/hooks/stop.test.ts`
- Create: `.claude/hooks/learn-stop.sh`
- Create: `.claude/hooks/learn-nudge.sh`
- Modify: `.claude/settings.json` — add the `Stop` and `UserPromptSubmit` hooks.

**Steps:**
1. In `stop.ts`, export a pure `decideStop(input, signals): { decision: "block"; reason: string } | null`.
2. If `stop_hook_active` is `true`, return `null`.
3. If a `stop-asked` signal with this `sessionId` exists, return `null`.
4. If `pendingSignals` for the worktree (`cwd`) is empty, return `null`.
5. Else return `block`, with the reason "This session logged {n} check failures ({ids}). Run /learn on them before you stop."
6. In `main`, append a `stop-asked` signal when the result is `block`. Print the JSON.
7. Write `learn-stop.sh`, as in Task 10, to run `stop.ts`.
8. Write `learn-nudge.sh`. It prints one line and exits 0:
   ```bash
   #!/usr/bin/env bash
   echo "If this message corrects you, run /learn before you continue."
   ```
9. Run `chmod +x` on both scripts.
10. Add `Stop` (timeout 20) and `UserPromptSubmit` (timeout 5) entries to `.claude/settings.json`.
11. Test `decideStop` with literal signals:
    - Pending signals give a block.
    - `stop_hook_active` gives `null`.
    - A `stop-asked` signal for the session gives `null`.
    - A `learned` signal after the failures gives `null`.

**Verify:**
```bash
pnpm --filter @carbon/checks exec vitest run src/hooks/stop.test.ts
# Expected: all tests pass
jq . .claude/settings.json >/dev/null && echo valid
# Expected: valid
```

**Out of scope:** detecting a correction from the message text.

## Task 18: Write the `/learn` skill

**Depends on:** Task 15
**Files:**
- Create: `.claude/skills/learn/SKILL.md`
- Create: `packages/checks/src/scripts/learn-mark.ts`
- Modify: `packages/checks/package.json` — add `"learn:mark": "tsx src/scripts/learn-mark.ts"`.
- Modify: `.claude/skills/README.md` — add `learn` to the Skills table.
- Copy from (precedent): `.claude/skills/check-and-commit/SKILL.md` (shape), `.claude/skills/writing-skills/SKILL.md` (rules).

**Steps:**
1. Read `.claude/skills/writing-skills/SKILL.md`. Follow its frontmatter and template.
2. Write `learn-mark.ts`. It appends a `learned` signal for `repoRoot()`.
3. Write the skill with these steps, from spec section 4:
   1. Name the mistake, the files and the reason no gate caught it.
   2. Run `pnpm brief <files>`. Run `rg` over `.claude/rules`, `.ai/lessons` and `packages/checks/src/conformance` for the same mistake.
   3. If an entry exists, make it stronger: a better trigger, a summary line, or a check.
   4. Else choose the store: a check if the mistake shows in code text, else a rule line, else a lesson file.
   5. For a check, prove that it fails on the code with the mistake.
   6. For a lesson, give it `paths:` or `triggers:`.
   7. When a lesson moves into a check or a rule, delete the lesson file in the same commit.
   8. Never delete a lesson that you did not promote.
   9. Run `pnpm --filter @carbon/checks learn:mark`.
   10. Commit through `/check-and-commit`.
4. Add a "Sweep mode" section. It runs `pnpm --filter @carbon/checks learn:sweep` and turns each proposal into a store change. It asks the human before it opens a pull request.

**Verify:**
```bash
head -5 .claude/skills/learn/SKILL.md
# Expected: frontmatter with name: learn and a description
CARBON_LEARN_INBOX=/tmp/inbox-test.jsonl pnpm --filter @carbon/checks learn:mark && tail -1 /tmp/inbox-test.jsonl
# Expected: a line with "kind":"learned"
```

**Out of scope:** running the skill on a real mistake.

## Task 19: Write the weekly sweep script

**Depends on:** Task 15
**Files:**
- Create: `packages/checks/src/learn/sweep.ts`
- Create: `packages/checks/src/learn/sweep.test.ts`
- Create: `packages/checks/src/scripts/learn-sweep.ts`
- Modify: `packages/checks/package.json` — add `"learn:sweep": "tsx src/scripts/learn-sweep.ts"`.

**Steps:**
1. In `sweep.ts`, export a pure `groupSignals(signals, sinceIso): { checkId: string; count: number; files: string[]; worktrees: number }[]`. Keep only groups with `count >= 2`.
2. Export a pure `fixCommitSignals(commits)`. The input is `{ sha, subject, files, at }[]`. It returns each `fix:` commit whose files another commit changed in the 14 days before it.
3. In `learn-sweep.ts`, read the inbox for the last 7 days.
4. Read the commits of the last 21 days with `git log --since=21.days --name-only --format=...`.
5. If `gh` is on the path, read failed runs with `gh run list --workflow=check.yml --status=failure --limit 30 --json databaseId,headBranch,createdAt`.
6. For each failed run, read `gh run view <id> --log-failed`. Parse the lines after "New conformance violations:".
7. If `gh` fails, print a note and continue without CI.
8. Write `.ai/runs/<YYYY-MM-DD>-learn-sweep.md`. Write one table of repeated check failures and one of unrecorded fixes. Get the date from `datetime.today("UTC")` (`@carbon/utils`), or from `git log -1 --format=%cs`.
9. Test `groupSignals` and `fixCommitSignals` with literal inputs. Assert whole results.

**Verify:**
```bash
pnpm --filter @carbon/checks exec vitest run src/learn/sweep.test.ts
# Expected: all tests pass
pnpm --filter @carbon/checks learn:sweep && ls .ai/runs/ | grep learn-sweep
# Expected: one learn-sweep file
```

**Out of scope:** opening the pull request. Scheduling the weekly run. Both are outward-facing, and the human starts them.

## Task 20: Wire the skills and the AGENTS.md files

**Depends on:** Tasks 8, 13 and 18
**Files:**
- Modify: `AGENTS.md` (root) — "Always" list.
- Modify: `.claude/skills/plan/SKILL.md` — Step 3.
- Modify: `.claude/skills/execute/SKILL.md` — step 2.
- Modify: `.claude/skills/fix/SKILL.md` — 3.1 and the final phase.
- Modify: `.claude/skills/self-review/SKILL.md` — Must fix.
- Modify: `.claude/skills/check-and-commit/SKILL.md` — gate failure.
- Modify: `packages/checks/AGENTS.md` — `brief`, `triggers`, hooks, inbox.

**Steps:**
1. In root `AGENTS.md`, replace the lessons line with "Run `pnpm brief <files>` before you edit a file. It lists the checks, rules and lessons that apply."
2. In root `AGENTS.md`, add "After the user corrects you, run `/learn`."
3. In the "Self-Improvement Loop" section, replace the `.ai/lessons.md` text with `/learn`.
4. In `/plan` Step 3, add "Run `pnpm brief` on each task's files. Paste the output into the task under **Briefing:**."
5. In `/execute` step 2, replace "Read `.ai/lessons.md` for the area" with "Run `pnpm brief` on the task's files."
6. In `/fix` 3.1, replace step 2 with "Run `pnpm brief` on the affected files."
7. Add a last step to `/fix`: "If the root cause was an earlier agent's mistake, run `/learn`."
8. In `/self-review`, add "Run `/learn` for each Must fix."
9. In `/check-and-commit`, add "If the same check fails a second time on this branch, run `/learn`."
10. In `packages/checks/AGENTS.md`, add 3 items:
    - "A new `ConformanceCheck` needs `triggers`."
    - `pnpm brief` and its file sets (`src/brief/file-sets.ts`).
    - The hooks in `src/hooks/` and the inbox in `src/learn/`.

**Verify:**
```bash
rg -n "pnpm brief" AGENTS.md .claude/skills/{plan,execute,fix}/SKILL.md | wc -l
# Expected: 4 or more
rg -n "/learn" AGENTS.md .claude/skills/{fix,self-review,check-and-commit}/SKILL.md | wc -l
# Expected: 4 or more
```

**Out of scope:** other skills. The `.codex/` copies, which `pnpm install-skills` makes.

## Task 21: Run the final verification

**Depends on:** every other task
**Files:**
- Modify: `.ai/specs/2026-11-24-agent-context-briefing.md` — status, changelog, deviations.

**Steps:**
1. Run the 5 commands in Verify.
2. Check each acceptance criterion of the spec. Write the evidence for each one in the spec changelog.
3. Record 2 deviations in the changelog:
   1. The index is built in memory, not stored in a file.
   2. Task 11's result for `additionalContext`.
4. Set the spec status to `in-progress`. The weekly schedule is still a human step.
5. Do the STE-80 review pass on the spec, the plan, the run logs and the triage report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/checks
# Expected: 0 failed
pnpm --filter @carbon/checks test
# Expected: all tests pass
pnpm exec biome check packages/checks .claude/hooks
# Expected: no errors
pnpm --filter @carbon/checks exec vitest run src/run.test.ts
# Expected: 2 passed
pnpm brief apps/erp/app/modules/sales/sales.service.ts | head -20
# Expected: at least one rule summary and one lesson
```

**Out of scope:** scheduling the weekly sweep. Deleting the lessons in the triage report. Both need the human.
