---
name: error
description: Capture a screenshot plus element snapshot of the current browser page when an error appears during e2e testing, saved to gitignored .ai/scratch/e2e/. Use whenever an agent-browser snapshot shows "Something went wrong", an auth error, a blank page, or an unexpected redirect. Building block — it captures and returns; the caller decides whether to continue.
---

# error — capture browser failure diagnostics

Capture artifacts when the browser shows a failure, then hand control back to
the calling skill. Never stops the calling run by itself.

## When to invoke

Any `agent-browser snapshot` that reveals:

- a "Something went wrong" heading
- "Authentication Error" or similar
- a blank page or unexpected redirect
- any content indicating the page failed to render

## Steps

### 1. Resolve the slug

Use `CARBON_WORKTREE` from `.env.local` if present; otherwise the current
branch name:

```bash
SLUG=$(grep '^CARBON_WORKTREE' .env.local | cut -d= -f2)
[ -z "$SLUG" ] && SLUG=$(git branch --show-current | tr '/' '-')
```

### 2. Capture both artifacts

Save to `.ai/scratch/e2e/` — it is gitignored (`.ai/scratch/` in `.gitignore`).
Never save captures under `docs/` (that's the documentation app, and it is
tracked).

```bash
mkdir -p .ai/scratch/e2e/${SLUG}
STAMP=$(date +%Y%m%d-%H%M%S)
agent-browser screenshot .ai/scratch/e2e/${SLUG}/${module}-${STAMP}.png
agent-browser snapshot -i > .ai/scratch/e2e/${SLUG}/${module}-${STAMP}.txt
```

`${module}` = a short name for the route/feature under test (e.g. `accounting`).
The `.txt` snapshot lets you debug element structure without reopening a browser.

### 3. Report and return

Log both file paths and **continue** — the caller decides whether to abort.
Include the paths in the caller's final report so a human can open them.

## Output

- `.ai/scratch/e2e/{slug}/{module}-{timestamp}.png` — screenshot
- `.ai/scratch/e2e/{slug}/{module}-{timestamp}.txt` — element snapshot
