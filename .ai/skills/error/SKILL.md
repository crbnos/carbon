---
name: error
description: Capture a screenshot and snapshot of the current browser page when an error is encountered during e2e testing. Saves to docs/e2e/<slug>/screenshots/.
---

# Error Capture

Capture diagnostic artifacts when the browser shows an error during e2e testing. This skill is a building block — other skills (e.g. `/smoke-test`) invoke it when they detect a failure.

## When to Use

Call this whenever an `agent-browser snapshot` reveals:
- "Something went wrong" heading
- "Authentication Error" or similar error message
- A blank page or unexpected redirect
- Any content that indicates the page failed to render

## Procedure

### 1. Determine the worktree slug

Read `.env.local` in the project root and extract the `CARBON_WORKTREE` value.

### 2. Ensure the output directory exists

```bash
mkdir -p docs/e2e/${CARBON_WORKTREE}/screenshots
```

### 3. Capture the screenshot

Use a descriptive filename with the module/route name and a timestamp:

```bash
agent-browser screenshot docs/e2e/${CARBON_WORKTREE}/screenshots/${module}-$(date +%Y%m%d-%H%M%S).png
```

For example: `docs/e2e/my-worktree/screenshots/accounting-20260606-143022.png`

### 4. Capture the snapshot text

Save the element snapshot alongside the screenshot for debugging without a browser:

```bash
agent-browser snapshot -i > docs/e2e/${CARBON_WORKTREE}/screenshots/${module}-$(date +%Y%m%d-%H%M%S).txt
```

### 5. Report

After capturing, log the file paths and continue — do **not** stop the calling skill. The caller decides whether to abort or continue.

## Output

Two files saved to `docs/e2e/<slug>/screenshots/`:
- `{module}-{timestamp}.png` — visual screenshot
- `{module}-{timestamp}.txt` — element snapshot text

These paths are gitignored (`docs/e2e` in `.gitignore`).
