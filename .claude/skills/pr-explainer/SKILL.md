---
name: pr-explainer
description: Build a self-contained HTML review aid at .pr-review/{branch}.html that teaches a reviewer what a PR changes and why — problem, system context, before/after flow, focused diffs, verification evidence, takeaway. Use when asked to explain a PR, help reviewers understand a complex change, or produce a review page for a branch. Do not use it as a substitute for review itself (/self-review) or instead of a PR description.
---

# pr-explainer — teach the PR in one HTML page

Output: one self-contained HTML file in `.pr-review/` (gitignored) that a
reviewer can open locally and understand the PR without GitHub. It supplements
the real diff review; it never replaces it.

**Announce at start:** "Using the pr-explainer skill — building the review page
for {branch}."

## Step 1: Gather the facts (before writing any HTML)

```bash
BASE=$(git merge-base origin/main HEAD)
git status --short                      # current state
git log --oneline $BASE..HEAD           # the commits
git diff $BASE...HEAD --stat            # scope + the metrics numbers
git diff $BASE...HEAD                   # read the whole diff
gh pr view --json number,title,url 2>/dev/null   # if a PR exists
```

Also collect: verification already performed this session (test runs, browser
checks, screenshots) — the page must report real evidence, not aspirations.

## Step 2: Classify files and find the teaching order

Classify every changed file: **core behavior** · plumbing/integration · tests ·
metadata/release · incidental noise. Only core behavior and load-bearing
plumbing get walkthrough sections; the rest gets at most one line.

Teach in this order (never raw diff order): problem → system context →
before/after flow → key code changes → verification → reviewer takeaway.

## Step 3: Fill the template

```bash
mkdir -p .pr-review
cp .claude/skills/pr-explainer/assets/template.html .pr-review/{branch}.html
```

The template has one section per teaching step, styled and ready — every spot
to fill is marked with a `<!-- FILL: ... -->` comment. Work top to bottom:

1. **Header**: PR number/title/branch/link; metrics from `--stat` (real numbers).
2. **Problem**: previous behavior and why it was wrong/missing/risky, with a
   concrete example.
3. **System context**: upstream callers, downstream effects, why this layer;
   name what is intentionally unchanged.
4. **Before → after flow**: duplicate the `.flow` rows, mark changed nodes with
   `class="node hot"`. Delete the section if the PR changes no flow. Put the
   one counterintuitive fact in the callout.
5. **Code walkthrough**: one `.diff` block per important file — only the lines
   that matter (`.add` / `.del` / `.ctx` spans), each followed by a short
   paragraph: what it accomplishes and how it connects to the story.
6. **Tests & verification**: exact commands run and their results. If a check
   was not run, say so and list the recommended command — never imply
   verification that didn't happen.
7. **Reviewer takeaway**: the shortest useful mental model + what to focus on
   in the real diff.

Writing rules: plain language; define repo-specific terms at first use; small
focused snippets over full patches; delete any template section that doesn't
apply (empty sections are noise).

## Step 4: Check and hand off

- [ ] Every `<!-- FILL -->` comment is either filled or its section deleted
- [ ] Metrics match `git diff $BASE...HEAD --stat`
- [ ] Every claim in Verification corresponds to a command actually run
- [ ] File opens standalone (no external assets) — it's one HTML file
- [ ] `.pr-review/` stays untracked (`git status` shows nothing staged from it)

Report: the output path, the PR story covered, and any verification gaps the
page discloses.
