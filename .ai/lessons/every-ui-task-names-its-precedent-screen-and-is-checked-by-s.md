---
paths: []
triggers: []
promoted: null
---
# Every UI task names its precedent screen and is checked by screenshot against it

**Context:** The Projects, Field Service, project billing and government contracting UI (2026-10-07 to 10-11), built by autonomous executors from plans whose UI tasks said what each screen shows but not which existing Carbon screen it copies. Brad reviewed the result on 2026-10-12: "completely over the top, incoherent, and overly complicated". The rebuild plan is `.ai/plans/2026-10-12-projects-service-ui-rebuild.md`; the rejected patterns are `.ai/scratch/ui-reference/bad-*.jpg`.

**Problem:** With no precedent named, each executor invented its own layout. Typecheck, Biome and the tests all passed, and every screen "worked", but the screens did not look like Carbon: an 8-tab strip and about 28 header controls on the project, two header rows, a panel inside a panel for an element, boxed number inputs in a timesheet table, dashed empty cards, striped progress bars, several primary buttons per screen, a `Subheading` on every section, and collapsible sidebar groups. Nothing in the gates looks at a screen, so nothing stopped it.

**Rule:** Every UI task in a plan or spec names its precedent: the existing screen it copies (a route or component path, for example Settings → Inventory, the inventory count grid, `IssueProperties`, the Revenue Recognition runs list) and a screenshot of that screen. The executor screenshots the new screen at 1440 px with the same data, puts it next to the precedent, and answers the seven questions of the plan's *screenshot check* (one toolbar row, at most one primary action, no input box in a table, secondary actions in a ⋯ or row menu, advanced fields collapsed or hidden). A "no" is a failed task, the same as a failed test. When no Carbon screen fits, the executor stops and asks; it does not invent a layout. Before a UI task, read `.claude/skills/carbon-design/SKILL.md`.

**Applies to:** every plan, spec and autonomous run (`/execute`, `/conductor`, overnight executors) that adds or changes UI in `apps/erp`, `apps/mes`, `packages/react` or `packages/form`.
