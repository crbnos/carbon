# CLAUDE.md

## Environment

- This project is a manufacturing system called Carbon. It contains apps for ERP, MES, and a training app called academy.
- Any time you want to know about the project, first use the Task tool to query the files in `llm/cache/`. Do this constantly, literally any time you want to know anything. Don't check the code first, ALWAYS check the cache.
- There are specific workflows defined in `llm/workflows/`. ALWAYS use the Task tool to search for the relevant workflow file when told to do a workflow, then read and follow it.

## Core Principles

- **Simplicity First:** Make every change as simple as possible. Minimize code impact. Do not over-engineer simple or obvious fixes.
- **No Laziness:** Identify root causes. Avoid temporary fixes. Apply senior developer standards.
- **Minimal Impact:** Touch only what is necessary. Avoid introducing new bugs.
- **Demand Elegance:** For non-trivial changes, pause and ask whether there is a more elegant solution. If a fix feels hacky, implement the solution you would choose knowing everything you now know. Critically evaluate your own work before presenting it.

## Workflow Orchestration

### Plan First

- Enter plan mode for any non-trivial task (three or more steps, or involving architectural decisions).
- If something goes wrong, stop and re-plan immediately rather than continuing blindly.
- Use plan mode for verification steps, not just implementation.
- Write detailed specifications upfront to reduce ambiguity.

### Subagent Strategy

- Use subagents liberally to keep the main context window clean.
- Offload research, exploration, and parallel analysis to subagents.
- For complex problems, allocate more compute via subagents.
- Assign one task per subagent to ensure focused execution.

### Verification Before Done

- Never declare a task complete without proving it works.
- Diff behavior between main and your changes when relevant.
- Ask: "Would a staff engineer approve this?"
- Run tests, check logs, and demonstrate correctness.

### Autonomous Bug Fixing

- When given a bug report, fix it without asking for unnecessary guidance.
- Review logs, errors, and failing tests, then resolve them.
- Avoid requiring context switching from the user.
- Fix failing CI tests proactively.

## Task Management

1. **Plan First:** Write the plan to `llm/tasks/todo.md` with checkable items.
2. **Verify Plan:** Review before starting implementation.
3. **Track Progress:** Mark items complete as you go.
4. **Explain Changes:** Provide a high-level summary at each step.
5. **Add Review Section:** Add a review section to `llm/tasks/todo.md`.
6. **Capture Lessons:** Update `llm/tasks/lessons.md` after corrections.

### Self-Improvement Loop

- After any correction from the user, update `llm/tasks/lessons.md` with the relevant pattern.
- Create rules for yourself that prevent repeating the same mistake.
- Iterate on these lessons rigorously until the mistake rate declines.
- Review lessons at the start of each session when relevant to the project.

## Tool Rules

### General

- ALWAYS prefer your default tools over resorting to the Bash tool. You historically have a bad habit of doing `find ... | xargs ... grep` where you could just use your Grep tool. Avoid this! Just use the simple Grep tool.

### Grep

- ALWAYS try spawning a subtask to search the cache first if you are looking for something you aren't 100% confident exists.
- NEVER assume something exists with too specific a pattern. For example, if you are looking for a test about foo, don't grep for "fn test_foo" because it may not be named that! Think broader and more general.
- ALWAYS filter out the results from the `**/node_modules/**`, `**/.vercel/**` and `**/.turbo/**` directories which fill up with trash you don't want to search.
- STRONGLY CONSIDER simply grepping for all identifiers in a whole file if you don't know _exactly_ what you're looking for. Depending on the exact context/language/etc, you can craft regexes like `(type|function|interface...etc) .*[{;]$` or be more or less sophisticated as needed. Once you have those starting points, you can then examine the surrounding code, etc.
- STRONGLY CONSIDER using the Task tool to have a sub-agent run the grep if the results are of unknown size, such as dumping all the identifiers in a file. Have it return just the relevant stuff.

### TodoWrite

- ALWAYS append this to every item: "Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed." This is very important even though it seems silly.
- NEVER create an explicit todo item for updating the cache.

### Cache (`llm/cache/`)

- ALWAYS update the cache if you learn something about the codebase that was not in the cache and is not from a current change you're making (i.e. is committed).
- ALWAYS update the cache after a commit.
- NEVER update the cache about staged/uncommitted code.
- NEVER rebuild the database to test changes. Wait for the user to do that.
