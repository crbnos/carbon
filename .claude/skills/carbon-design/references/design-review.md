# Design-language review — run before calling any UI work done

This review is **mandatory** for every piece of UI designed or built with this skill. It is a
self-critique loop, not a formality: find the gaps, fix them, re-run until clean.

## How to run it

1. **Re-read the design brief** you wrote at the start (archetype, sibling exemplar, reuse /
   extend / create decisions).
2. **Open the sibling exemplar again** and compare side by side — structure, header, actions,
   states, copy. Differences must be intentional and justified.
3. **Walk the checklist below.** For every item answer PASS / FIX / N/A. Every FIX gets changed
   now, not listed as a follow-up.
4. **Grep your diff** for the mechanical red flags (§3).
5. **Render it and use it in a real browser (§4).** Not optional when a dev server can run.
   Walk the states: empty, one row, many rows, long text, locked, no permission, error, dark
   mode, 1440 / 1024 / 390 px (ERP) or tablet (MES). Perform every capability in the brief.
6. Repeat 3–5 until everything is PASS or a justified N/A. Then write the review summary (§5).

## 1. The eight questions (answer in one line each)

0. **Can a user do their job here?** Walk the capability table from the brief: can each job
   be done on this screen, the way the sibling page lets them? Anything read-only that the
   sibling lets them change is a FIX.
1. **Does this feel like Carbon?** Put it next to the sibling screen: would a user notice a
   different hand?
2. **Is the information hierarchy consistent?** Identity first; one primary; metadata recedes;
   structure / work / metadata in their zones.
3. **Did we introduce a new pattern unnecessarily?** For each new component or layout: which
   existing one was rejected, and why?
4. **Could an existing Carbon pattern solve this better?** (archetype, overlay, list shape,
   Status, Enumerable, Empty, BarProgress, ConfirmDelete…)
5. **Are spacing, typography, icons, controls and states consistent?**
6. **Does the interaction behave the way a Carbon user expects?** URL state, keyboard, where
   create opens, where actions live, save model, destructive flow.
7. **Did any generic SaaS reflex slip in?** Check `anti-patterns.md` §1 line by line.

## 2. Checklist

### Functionality
- [ ] Every row of the archetype contract in `functionality.md` is implemented or skipped with a reason
- [ ] Values users change (qty, price, dates, customer, terms) are editable where shown — line form card, Properties autosave, or form card
- [ ] Every control posts to a real, verified endpoint; no disabled placeholders or dead buttons
- [ ] Locks use the domain helper on the client and the route's guard on the server
- [ ] After each mutation the screen reflects it (revalidation or optimistic state) and errors toast
- [ ] Each capability was exercised once in the browser

### Layout robustness
- [ ] Flex rows: text column `flex-1 min-w-0`, text `truncate`/`line-clamp-1` on `w-full` children, fixed parts `shrink-0`
- [ ] Trailing hover actions absolutely positioned over a `pr-*` reserve; nothing overlaps text
- [ ] IDs and money never wrap (`whitespace-nowrap`); long descriptions truncate with `TruncatedTooltipText`
- [ ] Tables in cards don't clip columns; the card never grows wider than its pane
- [ ] Full-width buttons stay full width (wrappers like Tooltip triggers don't break `w-full`)
- [ ] No `Hyperlink` inside a tight flex row or card header — it reserves width for its hidden hover "Open" button; use a plain `Link` there, `Hyperlink` in table cells
- [ ] Wide tables inside narrow panes get a `min-w-[…]` so the `Table` primitive scrolls horizontally instead of squashing columns into each other
- [ ] Grids/rows inside workspace panes use container queries (`@container` + `@md:`…), not viewport `md:`/`lg:` — panes resize independently of the screen
- [ ] Screenshots at 1440 / 1024 / 390 px checked, with the longest real names in the data

### Structure
- [ ] Correct archetype (`page-archetypes.md`) and matches its exemplar's shape
- [ ] Identity (readable ID / thumbnail / avatar) visible, copyable where the sibling allows, linked
- [ ] Meaningful view state lives in the URL (route or search params)
- [ ] Create opens where the rule says (full page / route drawer / modal / no form)
- [ ] Secondary things are hidden only in standard places (⋯, Properties, hidden columns, row menu)
- [ ] Breadcrumbs via route `handle`; paths via `path.to.*`; module registered in submodules / search / Create menu when applicable

### Actions
- [ ] Exactly one primary per surface; in headers it's the next lifecycle step
- [ ] Destructive actions are last in a menu, `destructive`, confirmed with `ConfirmDelete`/`Confirm`
- [ ] Permission-gated controls disabled, not hidden; locked states disable in place
- [ ] Footer button order matches the container (modal `[Cancel][Primary]`, drawer `[Save][Cancel solid]`, card `[Save]`)
- [ ] Icon-only actions are `IconButton` with explicit `variant` and translated `aria-label` (+ Tooltip)
- [ ] Shortcuts use named constants; ⌘↵ saves; no bare letters in MES

### Visual
- [ ] Tokens only — no raw grays, no hex, no arbitrary sizes; hue only for meaning
- [ ] Type roles right: serif only for page titles; `text-sm` body; `text-xs` muted labels; `font-medium` emphasis
- [ ] Spacing on the 4/8/16 rhythm; content widths capped like siblings
- [ ] Primitives own shadows/radius; app boxes `rounded-lg border`; no double edges; `Card > CardContent`
- [ ] Icons are `Lu*`, sized by context, colored only when meaningful; reuse the shared icon vocabulary
- [ ] Works in dark mode and a non-zinc theme

### Grounding
- [ ] Every import, prop, `path.to.*` helper, hook and schema column used was opened and confirmed in source
- [ ] Every "same as / copied from X" claim is an import of X or an exact quote of it
- [ ] Domain special cases are handled with the domain's own predicates (deadline types, lock helpers, nullable dates, multi-currency), and each has a designed rendering

### Data
- [ ] Lists use the shared `Table` with icons on every column, Title Case translated headers, identity column pinned
- [ ] Record lists inside drawers/modals/cards are tables (`TableBase` primitives or compact `Table`), not div stacks — with Hyperlink IDs and the entity's Status wrapper
- [ ] Comparison tables put the things being chosen in rows and the criteria in sortable columns
- [ ] Trends/deltas are `Badge green|red`; numbers inside sentences are not colored; magnitude grids use discrete bands (sibling's exact bands if one exists)
- [ ] Every value uses its semantic renderer (Status, Enumerable, EmployeeAvatar, DateTime, currency formatter, BarProgress)
- [ ] Numbers `tabular-nums`, left-aligned in lists, with context ("x of y")
- [ ] Status colors from `status-colors.ts`, chosen by lifecycle position; wrapper translates labels

### States
- [ ] Empty (lifecycle vs no results), loading (skeleton of real shape / `isLoading`), error (toast / inline), locked, no permission, plan-gated — each designed and honest
- [ ] Nothing can be mistaken for another state (empty vs failed, editable vs read-only, pending vs done)
- [ ] Every overlay/panel that fetches on open has loading (skeleton), error, and empty states — and never shows stale rows from a previous selection
- [ ] One user action = one submission; overlays stay open while submitting and close on success
- [ ] Hover reveals also reveal on focus; focus visible everywhere

### Forms
- [ ] Right container for the record's rank; one form component with swappable shell
- [ ] Layout: drawer single column; card grid 2→3 cols; custom fields last; long text below
- [ ] Optional tag (no asterisks), `termId` for jargon, helperText for constraints
- [ ] Explicit Save vs autosave per the rule

### Copy
- [ ] Title Case names things; sentence case says things
- [ ] Patterns match `content-and-copy.md` (Add X, New/Edit X, Failed to…, No X yet, This cannot be undone.)
- [ ] Every string (incl. aria-labels, toasts, tooltips, placeholders) through Lingui, whole sentences, `<Plural>` for plurals
- [ ] User's words, not table names

### Motion & a11y
- [ ] Property-scoped transitions 150–200ms, press not hover, `initial={false}`, `motion-reduce` fallback
- [ ] Keyboard path through the main flow; drag & drop has a keyboard sensor
- [ ] MES: ≥44px targets, nothing hover-only, one dominant action

## 3. Mechanical red flags (grep your changed files)

```bash
# run from the repo root; replace FILES with your changed .tsx files
FILES=$(git diff --name-only --diff-filter=AM -- '*.tsx')
grep -nE 'text-(gray|slate|zinc|neutral)-[0-9]|text-\[[0-9]+px\]|#[0-9a-fA-F]{3,6}\b' $FILES
grep -nE 'text-(green|emerald|amber|yellow)-[0-9]+' $FILES      # ok on icons/dots only, never on prose
grep -nE 'transition-all|hover:scale|shadow-(lg|xl|2xl)|rounded-(2xl|3xl)' $FILES
grep -nE 'from "react-icons/(?!lu)|<svg' $FILES
grep -nE 'window\.confirm|addEventListener\("keydown"|toLocale(Date)?String|toFixed\(' $FILES
grep -nE '<IconButton' $FILES | grep -v 'variant='                # every IconButton sets a variant
grep -nE 'aria-label="[A-Za-z]' $FILES                             # literal aria-labels → t``
grep -nE '>\s*[A-Z][a-z]+( [A-Za-z]+)*\s*<' $FILES                 # bare JSX text → <Trans>
grep -nE '\(s\)' $FILES                                            # plurals → <Plural>
grep -nE ' title=\{?["`t]' $FILES                                  # native title= → Tooltip
grep -nE 'size="sm"' $FILES                                        # MES files: every operator action is lg
grep -nE '<div[^>]*(divide-y|grid-cols-\[)' $FILES                 # record list as divs? → TableBase
grep -nE 'font-headline|size="h[123]"' $FILES                      # serif only for the page title
grep -nE 'isDisabled(\s|>|$)|isDisabled=\{true\}' $FILES           # hard-disabled controls → wired action or a real lock condition
```
(`grep -P` may be needed for the lookahead on some systems; if unavailable, grep
`react-icons/` and inspect.) Every hit is either fixed or justified in the summary.

## 4. Browser verification (how)

```bash
grep '^ERP_URL' .env.local                        # per-worktree URL; never assume
agent-browser open "$ERP_URL/login"               # then follow the `auth` skill (DEV_BYPASS_EMAIL)
agent-browser set viewport 1440 900
agent-browser open "$ERP_URL/x/<your route>" && sleep 4
agent-browser screenshot <scratchpad>/1440.png     # then Read the png and look at it
agent-browser set viewport 1024 800 && agent-browser screenshot <scratchpad>/1024.png
agent-browser set viewport 390 844  && agent-browser screenshot <scratchpad>/390.png
agent-browser snapshot -i                          # refs for clicking/filling to exercise capabilities
```
To change a number in a react-aria field, `click` it, `press Meta+a`, then `type` — `fill`
can append to the existing value (3 → "34"). Re-read the field from `snapshot -i` before saving,
and confirm the saved value in the database or the reloaded page. Revert every test edit.
Pick records with the longest names, the most lines and a locked status. After each
capability (edit qty, change a date, add/delete a line, transition), re-screenshot and confirm
the page reflects it. Fix, re-render, re-look. Include what you exercised in the summary.

## 5. Review summary (write this at the end)

```
Design-language review
- Archetype: <A–I or MES> — exemplar: <path>
- Reused: <components/patterns>
- Extended: <what + why> (or none)
- New: <component/pattern + why no existing one fits + how it follows Carbon's language> (or none)
- Deviations from the exemplar: <each with a reason> (or none)
- Capabilities exercised in the browser: <job → result> (one line each)
- Screenshots reviewed: <widths + records used>
- States covered: empty / loading / error / locked / no-permission / dark / mobile|tablet
- Open questions for the team: <e.g. drift items touched> (or none)
- Props audit: <Component — props used — file:line of its props type> (one line each)
- Checklist: all PASS (N/A: …)
```
