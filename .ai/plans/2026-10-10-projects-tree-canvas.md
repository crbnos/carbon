# Projects Tree layout as a box canvas — implementation plan

**Spec:** none. Brad set the scope on 2026-10-10 (see *Decisions*).
**Research:** Flow Engineering's requirements tool, frames `/tmp/recframes/f002.jpg`, `f006.jpg`, `f008.jpg`.
**Branch:** projects-wbs-research-spec

## Scope of this plan

Make the Tree layout of the project Elements page look and work like Flow's tree:
1. **Sibling boxes.** One tinted box per parent holds its children as compact cards. One curved edge runs from a card to the box of its children. Boxes flow left to right.
2. **Type colours and a richer card.** Each element type has one colour for the box tint, the icon and the type label. A card shows the type, the readable id, the name, the state, the verification, the comment count, the owner and the suspect badge.
3. **Breadcrumb root.** `?root=<elementId>` shows one subtree. A breadcrumb above the canvas shows the path to it.
4. **Type filter as a lens.** The type filter hides cards of other types, but the boxes stay. A link count on a card highlights its links.
5. **Change request picker.** A "Live plan" picker opens a change request the way the app opens one today (`?cr=`).

## Decisions

| # | Decision | Reason |
|---|---|---|
| 1 | Scope is items 1–5 above. No schema change, no migration, no new link type, no interface edge label, no new layout, no agent. | Brad, 2026-10-10. |
| 2 | Dagre places the boxes, not the cards. Cards stack in their box at fixed offsets. | Brad. |
| 3 | The layout maths is one pure function, `layoutElementTree`, with a vitest file. | Brad. |
| 4 | The Tree layout reads left to right only. The LR/TB toggle and `direction` in `graph/store.ts` go. | Brad allowed TB only if it stays simple. With boxes, TB needs a second set of handle and chevron positions. Flow is left to right only. |
| 5 | Type colours: Requirement blue, System orange, Test Case teal, Function violet, Parameter emerald, Folder and Task neutral. They live once, in `elementTypeColors` in `ElementTypeIcon.tsx`. | Brad set the first three. The rest follow the carbon-design hue recipe (green is emerald, purple is violet). Amber stays free for suspect links. |
| 6 | The new icon colours show on every layout, not only on the Tree. | One component per concept (carbon-design law 6). |
| 7 | The top box holds the root-level elements and has the project name as its label. With `?root=`, the top box holds the root's children and has the root's name as its label. | Brad. Flow's breadcrumb root shows the root's children. |
| 8 | An element whose parent is not in the loaded list sits in the top box. | The same rule as today. The state, owner, milestone, label and search filters still filter on the server. |
| 9 | Only the `type` filter is a lens on the Tree layout. The loader ignores `type` for the Tree and the canvas applies it. | Brad named the type filter. |
| 10 | A box renders when one of its cards, or a card in a box below it, matches the lens. A box label shows the parent's name, whatever its type. | Brad. |
| 11 | When the lens hides the card that owns a box, the edge starts at the box that holds the hidden card. | The tree stays connected. |
| 12 | A collapsed card's box shows "N items". N counts the descendants that match the lens. | N is what an expand would show. |
| 13 | `layoutElementTree` ignores the root element's own collapse flag while it is the root. | Focus must always show something. |
| 14 | A box header has a Focus button. The top box has none. | Brad. The breadcrumb goes up. |
| 15 | A Requirement card shows "N tests" (incoming `verifies`). A System or Function card shows "N reqs" (outgoing `satisfies`). A count of 0 shows nothing. | Brad. The verification status already shows an untested Requirement. |
| 16 | The link highlight is component state, not URL state. A pane click or Escape clears it. Boxes never dim. | Brad. A highlight is a short-lived look, not a page state. |
| 17 | The change request picker sits in the Elements header, next to **Views**, on every layout. | `?cr=` applies to the whole Elements page. A Tree-only control would hide a page-wide state. |
| 18 | "Open" change requests are Draft, In Review and Approved (`openChangeRequestStatuses`). | Applied, Rejected and Cancelled take no edits and need no overlay. |
| 19 | Comment counts come from one paged read of `projectElement` with an embedded `count` of `projectElementComment`. | No N+1 and no new RPC. |
| 20 | Choosing a saved view drops `root`, the same way it drops `cr` today (`displayStateToParams`). | The code already works this way. Not in scope. |
| 21 | The picker says "Live plan", not "Base". | The banner and the docs already say "live plan". "Base" reads like "baseline". Brad accepted decisions 4, 5 and 17 on 2026-10-10. |

## Rules for the executor

- Read 3 lessons in `.ai/lessons.md`:
  1. *Never hand-measure React Flow handle positions; and never `stopPropagation` inside a node*.
  2. *Lingui: a ternary inside t\`\` bakes the English words as runtime values*.
  3. *Lingui: `plural()` inside a `memo(…)` component calls the global i18n*.
- Read `.claude/rules/projects-system.md` → *Layouts, views and the Reader PDF* and *Baselines, change requests and the plan lock*.
- Read `.claude/skills/carbon-design/SKILL.md` before Tasks 4, 6 and 7.
- 🛑 Never switch branches. Never stash. Commit only the files of the current task.
- 🛑 Before Task 3, run `git status --short`. If `apps/erp/app/modules/projects/projects.models.ts` or `projects.service.ts` shows as modified, STOP and report. Another task owns those edits.
- Never use JavaScript `Date`. Never query in a loop. Never build a DB client in a service file.
- Mark every new UI string with `t` or `<Trans>`. Write every count-dependent phrase with `<Plural>` from `@lingui/react/macro`.
- Never call `stopPropagation` inside a React Flow node. Give an in-node button the `nodrag` class and the `data-graph-action` attribute. The canvas `onNodeClick` skips a click whose target is inside `[data-graph-action]`.
- Write each Tailwind class as a whole literal string. Never build a class name from parts: Tailwind cannot see it.
- Start each new source file by running `pnpm --filter @carbon/checks license-headers`. Never type the header by hand.
- If a quoted code line does not match the file, search for it. If you cannot find it, STOP and report.

## Progress

- [x] Task 1: Add the pure tree layout and trace-link helpers with tests
- [x] Task 2: Define the type colours once
- [x] Task 3: Load the full list, the comment counts and the open change requests
- [x] Task 4: Add the card node and the box node
- [ ] Task 5: Draw the Tree layout as boxes
- [ ] Task 6: Add the breadcrumb root
- [ ] Task 7: Add the change request picker
- [ ] Task 8: Update the rules, AGENTS.md and the docs page
- [ ] Task 9: Verify in the browser

## Dependencies

- Tasks 1, 2 and 3 are independent. Run them in any order or in parallel.
- Task 4 needs Tasks 1 and 2. Task 5 needs Tasks 3 and 4. Task 6 needs Task 5.
- Task 7 needs Task 3. Task 8 needs Tasks 5, 6 and 7. Task 9 runs last.

---

## Task 1: Add the pure tree layout and trace-link helpers with tests

**Depends on:** none
**Files:**
- Create: `apps/erp/app/modules/projects/ui/Elements/graph/tree-layout.ts`
- Create: `apps/erp/app/modules/projects/ui/Elements/graph/tree-layout.test.ts`
- Copy from (precedent): `apps/erp/app/modules/projects/ui/Elements/graph/layout.ts` (dagre call), `apps/erp/app/modules/projects/move-action-pegs.test.ts` (vitest style)

**Steps:**
1. Create `tree-layout.ts`. Run `pnpm --filter @carbon/checks license-headers`.
2. Import dagre as `layout.ts` does (`import Dagre from "@dagrejs/dagre"`). Import `ProjectElementType` and `ProjectElementLinkType` from `../../../projects.models` with `import type` only.
3. Export these constants:

```ts
export const CARD_WIDTH = 256;
export const CARD_HEIGHT = 88;
export const CARD_GAP = 8;
export const BOX_PADDING = 8;
export const BOX_HEADER_HEIGHT = 32;
/** The one-line note of a collapsed or lens-empty box. */
export const BOX_NOTE_HEIGHT = 36;
export const BOX_WIDTH = CARD_WIDTH + 2 * BOX_PADDING;
```

4. Export these types:

```ts
export type TreeElement = {
  id: string;
  parentId: string | null;
  type: ProjectElementType;
  name: string;
};

export type TreeBox = {
  /** "box:root" for the project, else "box:<ownerId>". */
  id: string;
  /** The element whose children the box holds; null for the project. */
  ownerId: string | null;
  /** The cards the lens shows, in input order. Empty when collapsed. */
  cardIds: string[];
  /** The descendants of a collapsed owner that match the lens, else null. */
  collapsedCount: number | null;
  /** The children in this box that the lens hides. */
  hiddenCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TreeCard = {
  id: string;
  boxId: string;
  /** Relative to the box. */
  x: number;
  y: number;
  /** The descendants that match the lens. A card with 0 has no box. */
  descendantCount: number;
  isCollapsed: boolean;
};

export type TreeEdge = {
  id: string;
  source: string;
  sourceHandle: "children" | "out";
  target: string;
};

export type ElementTreeLayout = {
  /** The root in use: null when `rootId` was null or unknown. */
  rootId: string | null;
  boxes: TreeBox[];
  cards: TreeCard[];
  edges: TreeEdge[];
};

export type TraceLink = {
  id: string;
  fromElementId: string;
  toElementId: string;
  linkType: ProjectElementLinkType;
};

export type TraceHighlight = {
  elementId: string;
  linkType: "verifies" | "satisfies";
};
```

5. Write `export function layoutElementTree(input: { elements: readonly TreeElement[]; rootId: string | null; collapsed: ReadonlySet<string>; type: ProjectElementType | null }): ElementTreeLayout`. Follow these steps in the body:
   1. Build `byId`. Build `children: Map<string, string[]>` in input order, only for elements whose `parentId` is in `byId`.
   2. Put every element whose `parentId` is null or not in `byId` into `topLevel`, in input order.
   3. Set `rootId` to the input `rootId` when `byId` has it, else null.
   4. Define `matches(id)`: true when `type` is null or the element's type equals `type`.
   5. Define `matchingDescendants(id)`: the count of descendants of `id`, not `id` itself, where `matches` is true. Memoize it in a `Map`. Keep a `seen` set so a bad `parentId` cycle cannot loop.
   6. Build the top box. Its id is `box:root` and its owner is null when `rootId` is null. Else its id is `box:<rootId>` and its owner is `rootId`. Its children are `topLevel`, or `children.get(rootId)` when there is a root. The top box always renders, and it ignores the collapse flag.
   7. Fill a box with `fillBox(box, childIds)`:
      - `cardIds` = the `childIds` where `matches` is true. `hiddenCount` = the other `childIds`.
      - Place card `i` at `x = BOX_PADDING`, `y = BOX_HEADER_HEIGHT + BOX_PADDING + i * (CARD_HEIGHT + CARD_GAP)`.
      - Set each card's `descendantCount` to `matchingDescendants(id)` and `isCollapsed` to `collapsed.has(id)`.
      - For each child `c` in `childIds` with `matchingDescendants(c) > 0`, add a child box `box:<c>` with owner `c`.
      - If `matches(c)`, add the edge `{ id: "tree:box:<c>", source: c, sourceHandle: "children", target: "box:<c>" }`. Else add the edge with `source` = the current box id and `sourceHandle: "out"`.
      - If `collapsed.has(c)`, the child box gets `cardIds: []`, `hiddenCount: 0` and `collapsedCount: matchingDescendants(c)`. Do not visit below it.
      - Else call `fillBox` on the child box with `children.get(c)`.
   8. Size each box. `width` is `BOX_WIDTH`. If `cardIds.length > 0`, `height = BOX_HEADER_HEIGHT + 2 * BOX_PADDING + n * CARD_HEIGHT + (n - 1) * CARD_GAP`. Else `height = BOX_HEADER_HEIGHT + 2 * BOX_PADDING + BOX_NOTE_HEIGHT`.
   9. Run dagre with `rankdir: "LR"`, `nodesep: 32`, `ranksep: 96`, `marginx: 24`, `marginy: 24`. Add one dagre node per box with its size, in visit order. Add one dagre edge per child box, from the box that added it to the child box. Set each box's `x`/`y` to the dagre centre minus half its size.
   10. Return the boxes in visit order (parents before children), the cards, the edges and `rootId`.
6. Write `export function elementTreePath(elements: readonly TreeElement[], rootId: string | null): TreeElement[]`. Return the ancestors of `rootId` from the top down, then the root. Return `[]` when `rootId` is null or unknown. Stop at a repeated id.
7. Write `export function countTraceLinks(links: readonly TraceLink[]): Map<string, { tests: number; reqs: number }>`. `tests` counts the `verifies` links into an element. `reqs` counts the `satisfies` links out of an element.
8. Write `export function highlightTraceLinks(links: readonly TraceLink[], highlight: TraceHighlight): { linkIds: Set<string>; elementIds: Set<string> }`:
   - For `verifies`, take the `verifies` links whose `toElementId` is `highlight.elementId`. `elementIds` = the element and each `fromElementId`.
   - For `satisfies`, take the `satisfies` links whose `fromElementId` is `highlight.elementId`. `elementIds` = the element and each `toElementId`.
9. Create `tree-layout.test.ts`. Run `pnpm --filter @carbon/checks license-headers`. Use this fixture (`type` and `name` as shown):

```
P   Folder      parent null      "Vehicle"
S1  System      parent P         "Powertrain"
R1  Requirement parent S1
R2  Requirement parent S1
S2  System      parent S1        "Motor"
R3  Requirement parent S2
T1  Test Case   parent P
F2  Folder      parent null      (no children)
O1  Requirement parent "missing" (an orphan)
```

10. Write one `it` per case. Use `new Set()` for an empty `collapsed`.

| Case | Input | Expect |
|---|---|---|
| Boxes per parent | no root, no type, nothing collapsed | box ids `["box:root","box:P","box:S1","box:S2"]`; `box:root.cardIds` = `["P","F2","O1"]`; `box:P.cardIds` = `["S1","T1"]`; 3 edges, each with `sourceHandle: "children"` (P→box:P, S1→box:S1, S2→box:S2) |
| Sizes and offsets | same | `box:P` width 272, height 232; card S1 at (8, 40); card T1 at (8, 136); `box:S1` height 328 |
| Left to right | same | `box:P.x > box:root.x + box:root.width`; `box:S1.x > box:P.x + 272` |
| Collapsed | collapsed `{S1}` | no `box:S2`; `box:S1.cardIds` = `[]`; `collapsedCount` 4; height 84; card S1 `isCollapsed` true, `descendantCount` 4 |
| Root | root `S1` | top box id `box:S1`, owner `S1`, `cardIds` `["R1","R2","S2"]`; box ids `["box:S1","box:S2"]`; no card P, F2 or O1 |
| Unknown root | root `"nope"` | `rootId` null; same boxes as case 1 |
| Requirement lens | type `Requirement` | `box:root.cardIds` `["O1"]`, `hiddenCount` 2; `box:P.cardIds` `[]`, `hiddenCount` 2, height 84; `box:S1.cardIds` `["R1","R2"]`; `box:S2.cardIds` `["R3"]`; edges into box:P, box:S1, box:S2 start at box:root, box:P, box:S1 with `sourceHandle: "out"`; no `box:F2` |
| Test Case lens | type `Test Case` | `box:root.cardIds` `[]`, `hiddenCount` 3; `box:P.cardIds` `["T1"]`; no `box:S1` |
| Lens and collapse | type `Requirement`, collapsed `{S1}` | `box:S1.collapsedCount` 3 |
| Path | `elementTreePath(…, "S2")`, `null`, `"nope"` | ids `["P","S1","S2"]`, `[]`, `[]` |
| Counts | links T1→R1 verifies, T9→R1 verifies, S1→R1 satisfies, S1→R2 satisfies, P→R1 relates to | R1 `tests` 2; S1 `reqs` 2; no entry for P |
| Highlight | `{ elementId: "R1", linkType: "verifies" }`, then `{ elementId: "S1", linkType: "satisfies" }` | 2 link ids and elements `{R1,T1,T9}`; 2 link ids and elements `{S1,R1,R2}` |

**Verify:**
```bash
(cd apps/erp && pnpm exec vitest run app/modules/projects/ui/Elements/graph/tree-layout.test.ts)
# Expected: "Test Files  1 passed (1)", at least 12 tests passed, 0 failed
pnpm exec biome check --write apps/erp/app/modules/projects/ui/Elements/graph/tree-layout.ts apps/erp/app/modules/projects/ui/Elements/graph/tree-layout.test.ts
# Expected: no errors
grep -n "new Date\|Date.now" apps/erp/app/modules/projects/ui/Elements/graph/tree-layout.ts
# Expected: no output
```

**Out of scope:** `ElementGraph.tsx`, `layout.ts` and `store.ts`. Task 5 changes them.

---

## Task 2: Define the type colours once

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Elements/ElementTypeIcon.tsx` — replace the private `colors` record with an exported `elementTypeColors`.
- Copy from (precedent): the hue recipe in `.claude/skills/carbon-design/references/foundations.md` §2 rule 7.

**Steps:**
1. Delete the `colors` record.
2. Add this export above `ElementTypeIcon`:

```ts
/**
 * The colour of each element type: the icon, the type label and the tint of
 * the Tree layout's box. The type is meaning, so each has a hue.
 */
export const elementTypeColors: Record<
  ProjectElementType,
  { icon: string; label: string; box: string }
> = {
  Requirement: {
    icon: "text-blue-500",
    label: "text-blue-700 dark:text-blue-400",
    box: "border-blue-500/20 bg-blue-500/5 dark:bg-blue-500/10"
  },
  System: {
    icon: "text-orange-500",
    label: "text-orange-700 dark:text-orange-400",
    box: "border-orange-500/20 bg-orange-500/5 dark:bg-orange-500/10"
  },
  "Test Case": {
    icon: "text-teal-500",
    label: "text-teal-700 dark:text-teal-400",
    box: "border-teal-500/20 bg-teal-500/5 dark:bg-teal-500/10"
  },
  Function: {
    icon: "text-violet-500",
    label: "text-violet-700 dark:text-violet-400",
    box: "border-violet-500/20 bg-violet-500/5 dark:bg-violet-500/10"
  },
  Parameter: {
    icon: "text-emerald-500",
    label: "text-emerald-700 dark:text-emerald-400",
    box: "border-emerald-500/20 bg-emerald-500/5 dark:bg-emerald-500/10"
  },
  Folder: {
    icon: "text-muted-foreground",
    label: "text-muted-foreground",
    box: "border-border bg-muted/40"
  },
  Task: {
    icon: "text-muted-foreground",
    label: "text-muted-foreground",
    box: "border-border bg-muted/40"
  }
};
```

3. In `ElementTypeIcon`, replace `colors[type]` with `elementTypeColors[type]?.icon`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: the erp typecheck task succeeds, no "error TS"
pnpm exec biome check --write apps/erp/app/modules/projects/ui/Elements/ElementTypeIcon.tsx
# Expected: no errors
```

**Out of scope:** the icons themselves, `useElementTypeLabels`, and every caller of `ElementTypeIcon`.

---

## Task 3: Load the full list, the comment counts and the open change requests

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.models.ts` — add `openChangeRequestStatuses`.
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — add `getProjectElementCommentCounts`.
- Modify: `apps/erp/app/routes/x+/project+/$projectId.elements.tsx` — the loader and the `ElementGraph` call.
- Copy from (precedent): `getProjectElementLinks` in `projects.service.ts` (a `fetchAll` read), `PROJECT_CHANGE_REQUEST_LIST_COLUMNS` (an embedded `count`).

**Steps:**
1. 🛑 Run `git status --short`. If `projects.models.ts` or `projects.service.ts` shows as modified, STOP and report.
2. In `projects.models.ts`, after `projectChangeRequestIntentFrom`, add:

```ts
/** The change requests the Elements page can open: they still take edits or a decision. */
export const openChangeRequestStatuses = [
  "Draft",
  "In Review",
  "Approved"
] as const satisfies readonly ProjectChangeRequestStatus[];
```

3. In `projects.service.ts`, after `getProjectElementDescriptions`, add this function. Give it no `@mcp` tag: it is a page helper, not an API tool.

```ts
/**
 * The comment count of each element of a project that has comments. One
 * paged read: each element row embeds the count of its comments.
 */
export async function getProjectElementCommentCounts(
  client: Client,
  projectId: string,
  companyId: string
) {
  const rows = await fetchAll<{ id: string; comments: { count: number }[] }>(
    () =>
      client
        .from("projectElement")
        .select(
          "id, comments:projectElementComment!projectElementComment_element_fkey(count)"
        )
        .eq("projectId", projectId)
        .eq("companyId", companyId)
        .order("id", { ascending: true })
  );
  if (rows.error) return { data: null, error: rows.error };
  return {
    data: (rows.data ?? [])
      .map((row) => ({ id: row.id, count: row.comments[0]?.count ?? 0 }))
      .filter((row) => row.count > 0),
    error: null
  };
}
```

4. In the route loader, after `parseElementFilters(searchParams)`, add:

```ts
// The Tree layout applies the type filter on the canvas, so it loads every
// type: a box must still show the parent of a matching card.
const queryFilters =
  layout === "tree" ? { ...elementFilters, type: null } : elementFilters;
const isQueryFiltered = Object.values(queryFilters).some(
  (value) => value !== null
);
```

5. Pass `queryFilters` to `getProjectElements`, not `elementFilters`.
6. Add 2 reads to the existing `Promise.all`. Name the results `commentCounts` and `changeRequests`:
   - `layout === "tree" ? getProjectElementCommentCounts(client, projectId, companyId) : Promise.resolve({ data: [], error: null })`
   - `getProjectChangeRequests(client, projectId, companyId)`
7. Log an error for each read that fails, the same way the loader logs `descriptions.error`.
8. In the `getProjectVerification` call, replace `isFiltered` with `isQueryFiltered`. Delete `isFiltered` from the destructure if nothing else reads it.
9. Add 2 fields to the loader's return value:

```ts
commentCounts: Object.fromEntries(
  (commentCounts.data ?? []).map((row) => [row.id, row.count])
) as Record<string, number>,
openChangeRequests: (changeRequests.data ?? [])
  .filter((cr) =>
    (openChangeRequestStatuses as readonly string[]).includes(cr.status)
  )
  .map((cr) => ({
    id: cr.id,
    readableId: cr.readableId,
    title: cr.title,
    status: cr.status
  })),
```

10. Import `getProjectChangeRequests`, `getProjectElementCommentCounts` and `openChangeRequestStatuses` from `~/modules/projects`.
11. Keep today's Tree behaviour until Task 5. Pass `elements={type ? elements.filter((element) => element.type === type) : elements}` to `ElementGraph`.
12. Pass the header count the same way: `count={layout === "tree" && type ? elements.filter((element) => element.type === type).length : elements.length}`.

If the embed hint `projectElementComment_element_fkey` fails the typecheck, STOP and report. Do not replace it with a loop.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: the erp typecheck task succeeds, no "error TS"
pnpm exec biome check --write apps/erp/app/modules/projects/projects.models.ts apps/erp/app/modules/projects/projects.service.ts "apps/erp/app/routes/x+/project+/\$projectId.elements.tsx"
# Expected: no errors
grep -n "getProjectElementCommentCounts" apps/erp/app/modules/projects/projects.service.ts
# Expected: 1 line (the function), and no "@mcp" in its doc comment
```

**Out of scope:** the Reader PDF route, which reads `parseElementFilters` on its own. Every layout other than the Tree.

---

## Task 4: Add the card node and the box node

**Depends on:** Tasks 1, 2
**Files:**
- Create: `apps/erp/app/modules/projects/ui/Elements/graph/ElementCardNode.tsx`
- Create: `apps/erp/app/modules/projects/ui/Elements/graph/ElementBoxNode.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Elements/graph/LinkEdge.tsx` — add `isDimmed`.
- Copy from (precedent): `graph/ElementNode.tsx` (memo, handles, the toggle button), `ElementProperties.tsx` `StatePill` (StateIcon + state name), `ElementTable.tsx` line 323 (`EmployeeAvatar` at `size="xxs"`).

**Steps:**
1. Create both node files. Run `pnpm --filter @carbon/checks license-headers`.
2. In `ElementCardNode.tsx`, export this data type and node type:

```ts
export type ElementCardData = {
  readableId: string;
  name: string;
  type: ProjectElementType;
  state: { name: string; group: ProjectStateGroup; color: string } | null;
  ownerId: string | null;
  status: RequirementStatus | null;
  commentCount: number;
  linkCount: { kind: "tests" | "reqs"; count: number } | null;
  isSuspect: boolean;
  isOpen: boolean;
  isDimmed: boolean;
  isHighlighted: boolean;
  hasChildren: boolean;
  isCollapsed: boolean;
  onToggle: (id: string) => void;
  onHighlight: (id: string) => void;
};
export type ElementCardGraphNode = Node<ElementCardData, "card">;
```

3. Import `CARD_WIDTH` and `CARD_HEIGHT` from `./tree-layout`.
4. Write `function ElementCardNodeImpl({ id, data }: NodeProps<ElementCardGraphNode>)` as a function declaration. Export `ElementCardNode = memo(ElementCardNodeImpl)`.
5. Make the card root a `div` with `style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}` and these classes:
   - always `relative flex flex-col justify-between rounded-md border bg-card px-2.5 py-2 text-sm transition-[opacity,background-color] hover:bg-accent/40`;
   - `border-amber-500` when `isSuspect`, else `border-border`;
   - `ring-2 ring-primary/50` when `isOpen`;
   - `opacity-40` when `isDimmed`.
6. Put `<Handle type="target" id="link-in" position={Position.Left} className={handleClass()} />` in the card root.
7. Write row 1 as `relative -mx-2.5 flex min-w-0 items-center gap-1.5 px-2.5`. It holds, in order:
   1. `ElementTypeIcon` at `size-3.5`.
   2. The type label: `typeLabels[type]` in `text-xs font-medium` plus `elementTypeColors[type].label`.
   3. The readable id: `whitespace-nowrap font-mono text-xs text-muted-foreground`.
   4. A `flex-1` spacer.
   5. When `commentCount > 0`: `LuMessageSquare` at `size-3` and the count in `text-xs tabular-nums text-muted-foreground`. Give it an `aria-label` from `<Plural>`: one "# comment", other "# comments".
   6. `EmployeeAvatar` with `employeeId={ownerId}`, `withName={false}`, `size="xxs"`.
   7. `<Handle type="source" id="link-out" position={Position.Right} className={handleClass()} />`. The relative row anchors it.
8. Write row 2: the name in `line-clamp-1 font-semibold`.
9. Write row 3 as `flex min-w-0 items-center gap-1.5`. It holds, in order:
   1. When `state` is set: a chip `inline-flex h-5 min-w-0 items-center gap-1 rounded border border-border px-1.5 text-xs` with `StateIcon` and the state name in `truncate`.
   2. `<VerificationStatus status={status} iconOnly />`.
   3. `<SuspectBadge />` when `isSuspect`.
   4. A `flex-1` spacer.
   5. When `linkCount` is set and `linkCount.count > 0`: a `button` with `type="button"`, `data-graph-action`, `aria-pressed={isHighlighted}`, the class `nodrag inline-flex h-5 shrink-0 items-center rounded px-1.5 text-xs tabular-nums text-muted-foreground hover:bg-accent`, plus `bg-accent text-foreground` when `isHighlighted`. Its `onClick` calls `data.onHighlight(id)`. Its text is `<Plural value={count} one="# test" other="# tests" />` for `tests` and `<Plural value={count} one="# req" other="# reqs" />` for `reqs`.
10. When `hasChildren`, add the child anchor and the chevron to the card root:
   1. `<Handle type="source" id="children" position={Position.Right} isConnectable={false} className="!opacity-0" />`.
   2. A `button` with `type="button"`, `data-graph-action`, and an `aria-label`: ``t`Expand` `` when collapsed, else ``t`Collapse` ``.
   3. Give it the class `nodrag absolute -right-2.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-accent`.
   4. Its `onClick` calls `data.onToggle(id)`. Its icon is `LuChevronRight` at `size-3`.
11. In `ElementBoxNode.tsx`, export:

```ts
export type ElementBoxData = {
  ownerId: string | null;
  label: string;
  /** The owner's type; null for the project. */
  type: ProjectElementType | null;
  isTop: boolean;
  cardCount: number;
  collapsedCount: number | null;
  hiddenCount: number;
  /** The text of an empty top box. */
  emptyText: string | null;
  onFocus: (ownerId: string) => void;
  onExpand: (ownerId: string) => void;
};
export type ElementBoxGraphNode = Node<ElementBoxData, "box">;
```

12. Write `ElementBoxNodeImpl` as a function declaration. Export `ElementBoxNode = memo(ElementBoxNodeImpl)`.
13. Make the box root `relative h-full w-full rounded-lg border`, plus `elementTypeColors[type].box` when `type` is set, else `border-border bg-muted/30`.
14. Add `<Handle type="target" id="in" position={Position.Left} isConnectable={false} className="!opacity-0" />`.
15. Add `<Handle type="source" id="out" position={Position.Right} isConnectable={false} className="!opacity-0" />`.
16. Write the header as `flex h-8 items-center gap-1.5 px-2`. It holds:
    1. `ElementTypeIcon` at `size-3.5` when `type` is set.
    2. The label in `min-w-0 flex-1 truncate text-xs font-medium`.
    3. When `!isTop` and `ownerId` is set: `IconButton` with `size="sm"`, `variant="ghost"`, `icon={<LuFocus />}`, an `aria-label` of ``t`Focus on ${label}` ``, `className="nodrag"`, `data-graph-action`. Its `onClick` calls `data.onFocus(ownerId)`.
17. When `collapsedCount !== null` and `ownerId` is set, render the note: a `button` with `type="button"`, `data-graph-action` and the class `nodrag mx-2 flex h-9 w-[calc(100%-1rem)] items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground hover:bg-accent/40`. Its `onClick` calls `data.onExpand(ownerId)`. Its text is `<Plural value={collapsedCount} one="# item" other="# items" />`.
18. When `collapsedCount === null`, `cardCount === 0` and `hiddenCount > 0`, render a muted note `mx-2 flex h-9 items-center justify-center text-xs text-muted-foreground` with `<Plural value={hiddenCount} one="# hidden by the type filter" other="# hidden by the type filter" />`.
19. When `cardCount === 0`, `hiddenCount === 0` and `emptyText` is set, render `emptyText` in the same muted note.
20. In `LinkEdge.tsx`, add `isDimmed?: boolean` to `LinkEdgeData`. Add `opacity: data?.isDimmed ? 0.15 : 1` to the `BaseEdge` style. Hide the label when `isDimmed`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: the erp typecheck task succeeds, no "error TS"
pnpm exec biome check --write apps/erp/app/modules/projects/ui/Elements/graph/ElementCardNode.tsx apps/erp/app/modules/projects/ui/Elements/graph/ElementBoxNode.tsx apps/erp/app/modules/projects/ui/Elements/graph/LinkEdge.tsx
# Expected: no errors
grep -n "stopPropagation\|plural(" apps/erp/app/modules/projects/ui/Elements/graph/ElementCardNode.tsx apps/erp/app/modules/projects/ui/Elements/graph/ElementBoxNode.tsx
# Expected: no output
```

**Out of scope:** `ElementGraph.tsx`. Task 5 wires the new nodes. Leave `graph/ElementNode.tsx` in place until Task 5.

---

## Task 5: Draw the Tree layout as boxes

**Depends on:** Tasks 3, 4
**Files:**
- Modify: `apps/erp/app/modules/projects/ui/Elements/ElementGraph.tsx` — build the nodes and edges from `layoutElementTree`.
- Modify: `apps/erp/app/modules/projects/ui/Elements/graph/store.ts` — remove `direction` and `setDirection`.
- Modify: `apps/erp/app/routes/x+/project+/$projectId.elements.tsx` — pass the new props.
- Delete: `apps/erp/app/modules/projects/ui/Elements/graph/ElementNode.tsx`
- Delete: `apps/erp/app/modules/projects/ui/Elements/graph/layout.ts`
- Copy from (precedent): the current `ElementGraph.tsx` (search, drag-to-link, legend, fit view).

**Steps:**
1. In `store.ts`, remove `GraphDirection`, `direction` and `setDirection` from the type, the state and `partialize`. Keep `collapsed` and `toggleCollapsed`.
2. Change `ElementGraphProps` to:

```ts
type ElementGraphProps = {
  projectId: string;
  projectName: string;
  /** Every element: on this layout the type filter is a lens. */
  elements: ProjectElementListItem[];
  type: ProjectElementType | null;
  links: ProjectElementLink[];
  requirementStatus: Record<string, RequirementStatus>;
  commentCounts: Record<string, number>;
  canUpdate: boolean;
};
```

3. Set `nodeTypes` to `{ box: ElementBoxNode, card: ElementCardNode }`.
4. Read `rootId` from `searchParams.get("root")`. Take `setSearchParams` from `useSearchParams()` too.
5. Write `setRoot(id: string | null)`. It copies `searchParams`, sets or deletes `root`, and calls `setSearchParams`.
6. Add `const [highlight, setHighlight] = useState<TraceHighlight | null>(null)`.
7. Compute in one `useMemo`:
   1. `layout = layoutElementTree({ elements, rootId, collapsed: new Set(collapsed), type })`.
   2. `counts = countTraceLinks(links)`.
   3. `lit = highlight ? highlightTraceLinks(links, highlight) : null`.
   4. `suspect` = the ends of every link with `suspectSince`, as today.
   5. `boxById` = the boxes by id. `visibleCards` = the set of card ids.
8. Build one box node per `layout.boxes` entry, before any card node:
   - `id`, `type: "box"`, `position: { x: box.x, y: box.y }`, `width: box.width`, `height: box.height`, `selectable: false`, `draggable: false`, `connectable: false`.
   - `label`: the owner's name, else `projectName`. `type`: the owner's type, else null. `isTop`: `box.id === layout.boxes[0].id`.
   - `cardCount: box.cardIds.length`, `collapsedCount`, `hiddenCount`.
   - `emptyText`: for the top box only. Use ``t`No child elements` `` when `layout.rootId` is set, else ``t`No elements yet` ``.
   - `onFocus: setRoot`. `onExpand: toggleCollapsed`.
9. Build one card node per `layout.cards` entry:
   - `id`, `type: "card"`, `parentId: card.boxId`, `extent: "parent"`, `position: { x: card.x, y: card.y }`, `draggable: false`.
   - Fill `ElementCardData` from the element row: `readableId`, `name`, `type`, `state`, `ownerId`.
   - `status`: `requirementStatus[id]` for a Requirement, else null.
   - `commentCount`: `commentCounts[id] ?? 0`.
   - `linkCount`: `{ kind: "tests", count: counts.get(id)?.tests ?? 0 }` for a Requirement; `{ kind: "reqs", count: counts.get(id)?.reqs ?? 0 }` for a System or a Function; else null.
   - `isSuspect`, and `isOpen` (`id === openElementId`).
   - `isDimmed: !!lit && !lit.elementIds.has(id)`. `isHighlighted: highlight?.elementId === id`.
   - `hasChildren: card.descendantCount > 0`, `isCollapsed: card.isCollapsed`.
   - `onToggle: toggleCollapsed`, `onHighlight: toggleHighlight`.
10. Write `toggleHighlight(id)`. If `highlight?.elementId === id`, set null. Else set `{ elementId: id, linkType }`, where `linkType` is `"verifies"` for a Requirement and `"satisfies"` for a System or a Function.
11. Build the tree edges from `layout.edges`: `id`, `source`, `sourceHandle`, `target`, `targetHandle: "in"`, `type: "default"`, `selectable: false`, `zIndex: 1`, `style: { stroke: "hsl(var(--border))", strokeWidth: 1.5, opacity: lit ? 0.3 : 1 }`.
12. Build the trace link edges as today, but:
    - keep a link only when `visibleCards` has both ends;
    - add `sourceHandle: "link-out"`, `targetHandle: "link-in"` and `zIndex: 1`;
    - add `isDimmed: !!lit && !lit.linkIds.has(link.id)` to `data`.
13. Change `onNodeClick`. Skip the click when the target is inside `[data-graph-action]`. Open the element only when `node.type === "card"`.
14. Add `onPaneClick={() => setHighlight(null)}` to `ReactFlow`.
15. Pass an `onKeyDown` handler to `ReactFlow` (its props take the `div` attributes). If `event.key === "Escape"`, call `setHighlight(null)`. This copies the local Escape handler in `ui/Element/ElementView.tsx`.
16. Change the fit-view signature to `` `${layout.rootId}:${type}:${nodes.length}` ``.
17. Remove the direction `IconButton` and the `LuArrowDown` / `LuArrowRight` imports.
18. In the search dialog, list the card nodes only. Centre on `box.x + card.x + CARD_WIDTH / 2`, `box.y + card.y + CARD_HEIGHT / 2`. Take `box` from `boxById.get(card.boxId)`.
19. Keep the pending-link panel, `addLink`, `isValidConnection` and `LinkLegend` as they are. `linkTypesFor` returns `[]` for a box id, because `byId` has no `box:` id.
20. Delete `graph/ElementNode.tsx` and `graph/layout.ts`. Run `grep -rn 'graph/ElementNode\|graph/layout"' apps/erp/app` and fix each import it finds.
21. In the route, pass to `ElementGraph`: the full `elements`, `type`, `projectName={routeData?.project?.name ?? ""}`, `commentCounts` and the props it passes today. Remove the Task 3 filter from the `elements` prop. Keep the header count from Task 3.

If React Flow draws the tree edges under the box tint, STOP and report. Do not hand-place the edges.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: the erp typecheck task succeeds, no "error TS"
(cd apps/erp && pnpm exec vitest run app/modules/projects/ui/Elements/graph/tree-layout.test.ts)
# Expected: at least 12 tests passed, 0 failed
pnpm exec biome check --write apps/erp/app/modules/projects/ui/Elements/ElementGraph.tsx apps/erp/app/modules/projects/ui/Elements/graph/store.ts "apps/erp/app/routes/x+/project+/\$projectId.elements.tsx"
# Expected: no errors
grep -rn "stopPropagation\|direction" apps/erp/app/modules/projects/ui/Elements/ElementGraph.tsx apps/erp/app/modules/projects/ui/Elements/graph/
# Expected: no output
```

**Out of scope:** the breadcrumb (Task 6). The change request picker (Task 7). Change-operation badges on cards.

---

## Task 6: Add the breadcrumb root

**Depends on:** Task 5
**Files:**
- Create: `apps/erp/app/modules/projects/ui/Elements/graph/TreeBreadcrumb.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Elements/ElementGraph.tsx` — render the breadcrumb above the canvas.
- Modify: `apps/erp/app/routes/x+/project+/$projectId.elements.tsx` — skip the reload when only `root` changes.
- Copy from (precedent): `apps/erp/app/components/Breadcrumb.tsx` and its use in `apps/erp/app/routes/share+/customer.$id.tsx` line 371.

**Steps:**
1. Create `TreeBreadcrumb.tsx`. Run `pnpm --filter @carbon/checks license-headers`.
2. Export `TreeBreadcrumb({ projectName, path }: { projectName: string; path: TreeElement[] })`.
3. Build each link target from `useSearchParams()`. Copy the params, set or delete `root`, and return `` `?${next}` ``.
4. Render `Breadcrumbs` from `~/components`. Put one `BreadcrumbItem` + `BreadcrumbLink` per crumb:
   1. The project name. Its target deletes `root`.
   2. Each element of `path` with its `ElementTypeIcon` at `size-3.5`. Its target sets `root` to its id.
5. Set `isCurrentPage` on the last crumb. With an empty `path`, the project crumb is the last crumb.
6. Give each `BreadcrumbLink` `className="h-7 max-w-48 gap-1.5 px-1.5 text-sm"`. Put the name in a `truncate` span.
7. In `ElementGraph.tsx`, make the wrapper `flex h-full w-full flex-col`.
8. Above `ReactFlow`, add a row `flex h-9 shrink-0 items-center border-b border-border px-2`. Put `<TreeBreadcrumb projectName={projectName} path={elementTreePath(elements, layout.rootId)} />` in it.
9. Wrap `ReactFlow` in `<div className="min-h-0 flex-1">`.
10. In the route's `shouldRevalidate`, add the arguments `currentUrl`, `nextUrl` and `formMethod`. Before `return defaultShouldRevalidate`, add:

```ts
// `root` changes only what the Tree layout draws: skip the reload.
if (!formMethod && currentUrl.pathname === nextUrl.pathname) {
  const withoutRoot = (url: URL) => {
    const params = new URLSearchParams(url.search);
    params.delete("root");
    params.sort();
    return params.toString();
  };
  if (
    currentUrl.search !== nextUrl.search &&
    withoutRoot(currentUrl) === withoutRoot(nextUrl)
  ) {
    return false;
  }
}
```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: the erp typecheck task succeeds, no "error TS"
pnpm exec biome check --write apps/erp/app/modules/projects/ui/Elements/graph/TreeBreadcrumb.tsx apps/erp/app/modules/projects/ui/Elements/ElementGraph.tsx "apps/erp/app/routes/x+/project+/\$projectId.elements.tsx"
# Expected: no errors
```

**Out of scope:** saved views and preferences. `root` stays in the URL only (Decision 20).

---

## Task 7: Add the change request picker

**Depends on:** Task 3
**Files:**
- Create: `apps/erp/app/modules/projects/ui/ChangeRequests/ChangeRequestPicker.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Elements/ElementsHeader.tsx` — render the picker before `ElementViewsMenu`.
- Modify: `apps/erp/app/routes/x+/project+/$projectId.elements.tsx` — pass the open change requests and the active one.
- Copy from (precedent): `ElementViewsMenu` in `ElementsHeader.tsx` (a radio `DropdownMenu` in the header), `ChangeRequestBanner.tsx` (`ActiveChangeRequest`, the icon), `ChangeRequestStatus.tsx`.

**Steps:**
1. Create `ChangeRequestPicker.tsx`. Run `pnpm --filter @carbon/checks license-headers`.
2. Export `ChangeRequestPicker({ projectId, changeRequests, active }: { projectId: string; changeRequests: ActiveChangeRequest[]; active: ActiveChangeRequest | null })`.
3. Take `setParams` from `useUrlParams()` (`~/hooks`). It merges into the current params, so `layout`, `type`, `root` and the filters stay.
4. Render a `DropdownMenu`. The trigger is a `Button` with:
   - `variant={active ? "active" : "secondary"}`, `leftIcon={<LuGitPullRequestArrow />}`, `rightIcon={<LuChevronDown />}`, `className="max-w-48"`;
   - the text `active.readableId` in a `truncate` span, else `<Trans>Live plan</Trans>`.
5. In `DropdownMenuContent align="end" className="w-72"`, add a `DropdownMenuRadioGroup` with `value={active?.id ?? "base"}`:
   1. A radio item `"base"`: `<Trans>Live plan</Trans>` and a muted `<Trans>No change request</Trans>`.
   2. A `DropdownMenuLabel`: `<Trans>Open change requests</Trans>`.
   3. One radio item per change request: the readable id in `font-mono text-xs`, the title in `truncate`, then `ChangeRequestStatus`.
   4. With no change request, a disabled `DropdownMenuItem`: `<Trans>No open change requests</Trans>`.
6. On a value change, call `setParams({ cr: value === "base" ? null : value })`.
7. After a `DropdownMenuSeparator`, add a `DropdownMenuItem asChild` with a `Link` to `path.to.projectChangeRequests(projectId)`: `<Trans>All change requests</Trans>`.
8. In `ElementsHeader.tsx`, add 2 props: `changeRequests: ActiveChangeRequest[]` and `activeChangeRequest: ActiveChangeRequest | null`. Render `<ChangeRequestPicker projectId={projectId} changeRequests={changeRequests} active={activeChangeRequest} />` before `ElementViewsMenu`.
9. In the route, pass `changeRequests={openChangeRequests}` and `activeChangeRequest={changeRequest}` to `ElementsHeader`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: the erp typecheck task succeeds, no "error TS"
pnpm exec biome check --write apps/erp/app/modules/projects/ui/ChangeRequests/ChangeRequestPicker.tsx apps/erp/app/modules/projects/ui/Elements/ElementsHeader.tsx "apps/erp/app/routes/x+/project+/\$projectId.elements.tsx"
# Expected: no errors
pnpm lingui:extract
# Expected: exits 0; the erp catalogs list the new strings ("Live plan", "Focus on {label}", "# items")
# Commit the changed .po files with this task. check-and-commit runs /translate for the other locales.
```

**Out of scope:** `ChangeRequestBanner`, which stays as it is. Creating a change request from the picker.

---

## Task 8: Update the rules, AGENTS.md and the docs page

**Depends on:** Tasks 5, 6, 7
**Files:**
- Modify: `.claude/rules/projects-system.md` — add a *Tree layout* paragraph under *Layouts, views and the Reader PDF*.
- Modify: `apps/erp/app/modules/projects/AGENTS.md` — add `getProjectElementCommentCounts` to *Key Service Functions*.
- Modify: `docs/content/docs/reference/projects.mdx` — the Tree bullet and the change request picker.

**Steps:**
1. In `projects-system.md`, change "Tree (React Flow + dagre)" to "Tree (React Flow boxes + dagre)".
2. After that paragraph, add a paragraph in STE-80 that states these facts:
   - `layoutElementTree` (`graph/tree-layout.ts`, pure, tested) gives one box per parent with matching descendants. Dagre places the boxes, left to right only.
   - The type filter is a lens on the Tree. The loader drops `type` for the Tree. A box stays while a card below it matches.
   - `?root=` shows one subtree. The loader skips the reload when only `root` changes.
   - `countTraceLinks` / `highlightTraceLinks` drive the "N tests" and "N reqs" highlight.
   - `elementTypeColors` (`ElementTypeIcon.tsx`) is the one colour map of the types.
   - `getProjectElementCommentCounts` reads the comment counts in one paged read.
   - `ChangeRequestPicker` lists `openChangeRequestStatuses` and sets `?cr=`.
3. In `AGENTS.md`, add this bullet to *Key Service Functions*:
   > `getProjectElementCommentCounts` — the comment count per element for the Tree layout's cards (one paged read; no `@mcp` tag).
4. Load the `carbon-docs` skill for the docs edits.
5. In `projects.mdx`, replace the Tree bullet with this text:
   > **Tree** groups the children of each element in one box and draws the trace links between them. Drag from one element to another to add a link. **Focus** on a box shows only that part of the tree, and the breadcrumb goes back up. The type filter keeps the boxes, so the tree holds together. Click **N tests** or **N reqs** on a card to highlight its links.
6. In the *Change requests* section of `projects.mdx`, find "The live plan does not change." Add this sentence after it:
   > To open another change request, or to go back to the live plan, use the picker next to **Views** on the Elements tab.
7. Do the STE-80 review pass on the new rule paragraph (`.claude/rules/writing-ste.md`).

**Verify:**
```bash
grep -n "layoutElementTree\|ChangeRequestPicker" .claude/rules/projects-system.md
# Expected: at least 2 lines
grep -n "getProjectElementCommentCounts" apps/erp/app/modules/projects/AGENTS.md
# Expected: 1 line
pnpm --filter docs typecheck
# Expected: exits 0
```

**Out of scope:** the changelog. The spec `.ai/specs/2026-10-03-projects.md`.

---

## Task 9: Verify in the browser

**Depends on:** Tasks 1–8
**Files:** none

**Steps:**
1. Run `grep ^ERP_URL .env.local`. If no dev server answers at that URL, skip this task. Report "browser verification deferred: no dev server".
2. Run the `/test` skill on this branch. It logs in with `/auth`.
3. Open a project with nested elements. Choose the **Tree** layout. Check these 12 points, at 1440 px and 1024 px wide:
   1. Each parent's children sit in one tinted box. The box has the parent's name as its label.
   2. One curved edge runs from a card's chevron to its children's box.
   3. A card shows the type label and the icon in the type's colour. It also shows the readable id, the bold name, the state chip, the comment count and the owner avatar.
   4. Collapse a card. Its box shows "N items". Click the note to expand it.
   5. Click **Focus** on a box. The URL gets `root=`. The breadcrumb shows the project, the ancestors and the root. The page does not reload (no loader request in the network log).
   6. Click the project crumb. The whole tree comes back.
   7. Choose the **Requirement** type. Only Requirement cards show. The boxes of their parents stay, with their names.
   8. On a Requirement card, click "N tests". Its `verifies` links and Test Case cards stay bright and the rest dims. Press Escape. The highlight clears.
   9. On a System card, click "N reqs". Click the canvas background. The highlight clears.
   10. Drag from a Test Case's right handle to a Requirement. The link panel offers **verifies**. Add it.
   11. A card with a suspect link has an amber outline. The open element has a ring.
   12. Open the **Live plan** picker. Choose an open change request. The banner shows it and `cr=` is in the URL. Choose **Live plan**. The banner goes.
4. Screenshot each point. Fix each defect, then run the matching task's Verify again.

**Verify:**
```bash
ls .ai/playbooks/ | grep -i tree
# Expected: the /test skill saved a playbook for the Tree layout, or the task reports the deferral
```

**Out of scope:** the List, Board, Table, Timeline and Reader layouts, except a check that the new type colours look right.

## Execution notes

- Task 1: `layoutElementTree` also keeps a set of visited boxes, so a bad `parentId` cycle under a `?root=` cannot recurse forever (the plan named the guard for `matchingDescendants` only). The 13 cases pass. The license fixer only sees git-tracked files, so each new file is staged with `git add -N` before the fixer runs.
- Task 4 (deviation): an `aria-label` takes a string, and `<Plural>` renders an element. So the comment count's accessible name is a `sr-only` span with the `<Plural>` ("# comment" / "# comments"), and the visible icon and number are `aria-hidden`.
