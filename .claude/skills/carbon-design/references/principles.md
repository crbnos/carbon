# Carbon design principles — how a Carbon designer thinks

This is the core of the skill. Everything else (tokens, components, page shapes) is these
principles applied. When you face a situation no reference covers, reason from here.

Each principle has: the rule, **why** Carbon does it, how it shows up, and a **test question**
you can ask of your own design.

## Contents
1. Who Carbon is for (the premise)
2. The 20 principles
3. Carbon vs generic SaaS — the contrast table
4. How to decide when principles pull in different directions

---

## 1. The premise

Carbon is an ERP + MES for manufacturers. Its users are planners, buyers, accountants,
quality engineers, and machine operators. They are in the tool **all day**, doing repetitive
work on many records, often under time pressure, often with a customer or a machine waiting.

So Carbon is a **working tool, not a showcase**. It optimises for:
- scanning many records quickly (dense, calm, consistent),
- knowing exactly where a record is in its lifecycle and what to do next,
- never losing your place (URL state, panels, back button),
- trusting what the screen says (honest states, one color meaning per color),
- doing it with the keyboard on a desk, or with gloves on a tablet on the floor.

The named aesthetic reference in commits and rules is **"Vercel/Geist"**: neutral base,
monochrome chrome, thin edges, sparse semantic color, quick motion. On top of that Carbon has
its own voice only at the edges: serif page titles, the animated Carbon mark loader, the
"VOID//SYS" error screen, "Looks empty here 👀".

---

## 2. The principles

### P1. Quiet chrome, loud data — color is spent only on meaning
The UI frame is monochrome (tokens: `background`, `card`, `muted`, `accent`, `foreground`,
`muted-foreground`). The primary button is **ink** (near-black in light, white in dark in the
default `zinc` theme), not a brand color. Saturated color appears in only four places:
status chips, categorical type/entity icons, signed or threshold data (negative, overdue,
failed), and charts.
- **Why:** a dense ERP screen already carries a lot of information. Color works as a signal
  only while it is rare. The team has repeatedly *removed* color: amber text became a red badge
  only when late (`c10513d5c9`), a loud amber Alert became a calm Card with one amber icon
  (`b15cb4e9f2`), solid badges became dot + label pills (`e984069683`).
- **Shows up as:** `text-muted-foreground` (≈2,500 uses) vs `text-gray-*` (8); no green or amber
  *prose* (`.ai/ds-rules.md` Color Rules); success toasts are blue, not green.
- **Test:** *If I removed every hue from this screen, would anything lose meaning? If not, the
  hue is decoration — remove it. If yes, is each hue the one Carbon uses for that meaning?*

### P2. The record's identity comes first
Every record has a human **readable ID** (`SO-000123`, `J-0042`, `P-1001.A`). It is the
headline of the detail page (`Heading size="h4"` in the header, linkable, with `<Copy>`), the
first column of every list (a `Hyperlink`, pinned left, `LuBookMarked` header icon), the last
breadcrumb, and the thing people say out loud. Items are identified by thumbnail + ID over a
muted name; people by avatar + name; customers/suppliers by their avatar components.
- **Why:** users find, discuss and cross-reference records by ID. Making it prominent,
  copyable and clickable everywhere is what makes navigation fast.
- **Test:** *Can the user see, copy and click the identity of every record on this screen?
  Is anything shown as a raw UUID or raw foreign-key id?*

### P3. Lifecycle drives the UI
Most Carbon records are state machines (Draft → Released → Completed…). The UI makes the
current state and the next step obvious:
- status is a `Status` pill right next to the identity;
- the button for the **next valid step is the only primary** on the header
  (`variant={status === "Draft" ? "primary" : "secondary"}`); everything else is secondary;
- a status that forbids editing **locks the record in place** (`is{Entity}Locked(status)` →
  `isDisabled`, server-enforced by `requireUnlocked`), and the way back is a "Reopen" item in
  the ⋯ menu — no banner.
- **Why:** the most common question is "where is this and what do I do now?". A single primary
  answers the second half; the status pill answers the first.
- **Test:** *Is there exactly one primary action, and is it the next step for this status?
  What happens to editing when the status moves on?*

### P4. Structure left, work center, metadata right
A document workspace is always: fixed 50px header strip (identity left, lifecycle right) →
**Explorer** (lines/tree, resizable, left) | **content** (cards stacked, center) |
**Properties** (inline-autosaving fields, fixed width, right). The code calls it the
"Standard 3-pane detail workspace". Secondary metadata lives in Properties, never mixed into
the main form.
- **Why:** the structure you navigate, the thing you work on, and the facts about it have
  different reading patterns. Fixed places mean users never hunt.
- **Test:** *For each piece of information: is it structure, work, or metadata — and is it in
  that zone?*

### P5. The URL is the state
Tabs on detail pages are routes. Drawers are nested routes rendered through the list's
`<Outlet/>`. Filters, sort, search, pagination and saved views are search params. Opening a
drawer preserves the list's query string.
- **Why:** deep links, back button, refresh and sharing all just work; loaders fetch on the
  server; nothing is lost when a user is interrupted.
- **Test:** *If the user refreshes or pastes this URL to a colleague, do they see the same
  thing? Is any meaningful view state held only in `useState`?*

### P6. One shared component per concept — then everyone uses it
When a concept appears twice, Carbon makes one component or one map and sweeps the call sites:
status colors (`packages/utils/src/status-colors.ts`), dates (`DateTime`), eyebrow labels
(`Subheading`), empty selector states (`useEmptyState`), shortcuts (`SHORTCUTS`), lookup chips
(`Enumerable`). Similar things must *look and behave* the same everywhere: the same status word
has one color; the same header column has the same icon; the same value has the same
Enumerable color (hash of the string).
- **Why:** consistency is what makes a 50-module product learnable. Every divergence is a
  thing users must relearn.
- **Test:** *Does this concept already have a component, map or constant? Am I creating a
  second way to show the same thing?*

### P7. Reuse the sibling's shape before inventing
Before designing a screen, find the nearest existing screen of the same **kind** and match its
shape exactly. Counterpart entities are mirrored (CustomerForm and SupplierForm differ only in
nouns). New modules copy the canonical list + 3-pane pattern (the newest, RMAs, copies it
exactly). Review feedback on the Returns PR asked for "house UI patterns": an attribute card is
"a master-data pattern", documents get a `…Summary`.
- **Why:** Carbon's consistency is not in a style guide — it is in its siblings.
- **Test:** *Which existing screen is this most like? What would a user expect, having used
  that screen?*

### P8. Progressive disclosure through fixed places, not modes
Carbon hides secondary things in **known places**: rare/destructive record actions in the ⋯
menu next to the ID; metadata in the collapsible Properties panel; audit columns hidden by
default in tables (not removed); row actions in right-click + ⋮; line details behind a chevron
in the Explorer; related documents behind one "Shipments ▾" button. There is no global
"edit mode" toggle for a document — editing is always on until status locks it.
- **Why:** hiding in a predictable place keeps screens calm without making things undiscoverable.
- **Test:** *Is every hidden thing in one of Carbon's standard hiding places? Could the user
  guess where it is?*

### P9. Disable, don't hide — for permissions and locks
Without permission or when locked, controls render **disabled**, not removed (menu items use
`disabled={!permissions.can(...)}`; forms get `isDisabled`). Exceptions: empty-state CTAs are
hidden without permission, and the newest headers render only the lifecycle transitions valid
for the current status (the next step always remains visible).
- **Why:** users learn the layout once; a disabled control explains that the action exists and
  is currently unavailable.
- **Test:** *For a read-only user, does the screen keep its shape?*

### P10. Dense, not cramped — ERP is a desk tool
Body text is `text-sm` (14px), labels and metadata `text-xs` (12px), default button `h-8`,
inputs `h-10`, table rows 44px, spacing mostly 4/8/16px. Weight is `font-medium` for emphasis,
never bold for UI text. Whitespace grows only at page and empty-state level, and detail pages
use `p-4` with `spacing={4}` between cards (`8aa53b0439`).
- **Why:** users scan many rows; a roomy marketing layout would push data below the fold.
- **Test:** *Would a planner looking at 50 of these rows see them without scrolling past
  decoration? Is anything bigger or bolder than its importance?*

### P11. Hierarchy by size, weight and tone — not by boxes and color
Hierarchy comes from: serif `Heading` for page titles only; `text-base font-medium` for
card/modal/drawer titles; `text-sm` content; `text-xs text-muted-foreground` for labels and
secondary metadata; `Subheading` for eyebrow labels. Secondary metadata is visually
subordinate to the entity and never competes with the main action.
- **Why:** calm, editorial hierarchy survives density; boxes-in-boxes and colored headings
  do not.
- **Test:** *Squint: is the most important thing the most prominent, and does metadata recede?*

### P12. Surfaces are layered by tone; the primitive owns the edge
Gray chrome (`bg-background`), white content (`bg-card`), `Card` = gray tray with a white
`CardContent`. Depth comes from tone plus a hairline edge, not big shadows. Shadow recipes
(`shadow-button-base`) live inside primitives; app code uses a 1px `border` and `rounded-lg`
for inner boxes, and never stacks a border on top of a primitive's shadow edge.
- **Why:** flat calm surfaces for long sessions; one edge per surface avoids "blurry double
  lines".
- **Test:** *Am I adding a shadow, radius or border that a primitive already provides?*

### P13. Quiet by default, honest always
Empty states are small and calm ("invitation, not an error"). Loading shows a skeleton of the
real shape, delayed ~300ms so fast loads don't flash. The team treats a misleading state as a
bug: "pending no longer lies" (`daaddf5a85`), read-only cells don't show an edit ring
(`6ea9142601`), stale timestamps removed (`1824cbfe7c`), a failed load must not read as
"no data".
- **Test:** *Could any state on this screen be mistaken for a different state? (Empty vs
  failed, loading vs nothing, editable vs read-only, saved vs pending.)*

### P14. Status is color + icon + words, from one map
`<Status color>` = tinted uppercase pill + a fixed icon per color + tooltip. Colors come from
`packages/utils/src/status-colors.ts`; choose by lifecycle *position* (not started gray,
waiting yellow, released/with another party blue, being worked orange, done green, dead/failed
red, special purple).
- **Test:** *Is status readable in grayscale? Is its color the one its lifecycle position gets
  everywhere else?*

### P15. Keyboard-first, but deliberate
⌘/Ctrl+Enter saves forms (`Submit` does it), `n` creates on a list with one Add button, ⌘K
searches, `g` + letter goes to a module, ⌘⇧L adds a line. Every combo is a named constant.
Enter is the shortcut only on one-obvious-action screens; keycap badges are hidden on trivial
screens.
- **Test:** *Can a power user complete the main flow without the mouse? Did I add a combo
  literal instead of a constant?*

### P16. Words are the user's words, translated from day one
Name things by the user's mental model ("Instructions" not "Procedure" for operators,
`019fcf0a46`). Title Case names things (headers, labels, buttons, menu items, titles); sentence
case says things (toasts, empty states, descriptions, confirmations). Terse,
consequence-first copy ("Failed to update quote", "This cannot be undone."). Every string goes
through Lingui (`t`, `<Trans>`, `msg`), including aria-labels and toasts. Domain jargon gets a
glossary `termId`.
- **Test:** *Would an operator or buyer use these words? Is every string translatable as a
  whole sentence?*

### P17. Desk and floor are different contexts of the same language
MES (shop floor) uses the same tokens, primitives, status colors and copy rules, but changes
the *ergonomics*: `size="lg"` controls, hero Start/Pause, actions always visible (no hover
reveal, no context menus, no bulk), no bare-letter shortcuts (barcode scanners type), task
queues instead of modules, cards instead of wide tables.
- **Test:** *Who is holding the device and what are their hands doing?*

### P18. Build on what's there; remove what misleads
Improve an existing design rather than stripping it down ("BatchItemCard was a stripped-down
card… It now carries them forward", `7775cd66bd`). Remove things users don't need or that
mislead (banners, stale data, duplicate breadcrumbs, extra buttons).
- **Test:** *Did I add anything a user doesn't need to finish the task? Did I drop anything
  the sibling screen gives users?*

### P19. Grounded in the real model — never a plausible-looking API
A Carbon screen is built on Carbon's actual components, props, routes and schema, and on the
domain's own rules (deadline types, lock predicates, OEE impact, multi-currency). A design that
*looks* right but calls a prop that doesn't exist, links to a route helper that doesn't exist,
or treats "no deadline" jobs like dated ones is not Carbon — it's a mock-up. Carbon extends
existing domain machinery (an existing record type, status map, bulk-update route or lock
helper) rather than building a parallel system that answers the same question differently.
- **Test:** *Did I open the source for every component, prop, path helper and column I used?
  Does every special value the domain models have a designed rendering?*

### P20. Worked on, not looked at
Every Carbon screen is a place where work happens. The value a user reads is the value they
can change, in the same place: a line opens into its editable form card, a header fact
autosaves in Properties, a status moves with one primary click, a stock figure has its
adjustment modal. All of it runs through the record's existing route actions, so the domain
rules (sales rules, lock guards, price resolution, MRP) come along for free.
- **Why:** users open a sales order to *change* it — the customer called about quantity,
  price, a date. A beautiful read-only page sends them hunting for "the real one".
- **Shows up as:** `ModalCard` line forms, per-field autosave Properties, status routes,
  `is{Entity}Locked` + `requireUnlocked` (`references/functionality.md`).
- **Test:** *Pick the three most common reasons a user opens this screen. Can they finish
  each one here without leaving? Did I click through each one in a browser?*

---

## 3. Carbon vs generic SaaS

Use this table when a design "works" but feels generic.

| Generic SaaS reflex | What Carbon does instead |
|---|---|
| Brand-colored primary buttons, colorful icons everywhere | Ink primary; icons inherit text color or `text-muted-foreground`; hue only for meaning |
| Big hero header with title, subtitle, illustration | List pages: `Table` title (serif h2) + one "Add X" button. Detail: 50px header strip |
| Cards with big shadows, `rounded-2xl`/`3xl`, gradients | `Card` primitive (tray + white content), inner boxes `rounded-lg border` |
| Green "Success!" text, amber warning paragraphs | Status pills / red badge only when late; muted text + `Lu*` icon for inline notes |
| Page-level client tabs | Route tabs (`DetailsTopbar`) or Explorer sections |
| Edit button → edit mode → Save | Always-editable; Properties autosave per field; locked by status |
| Separate "Actions" buttons per row | `renderContextMenu` → right-click + ⋮ column, Edit first, Delete last |
| Modal for everything | Route drawer for config rows, full page for documents, modal for confirms/transitions and inline create |
| Toast "Saved successfully! 🎉" | "Updated quote", "Customer created", "Failed to update quote" |
| "Are you sure?" with OK/Cancel | `ConfirmDelete`: "Delete {name}", "Are you sure you want to delete {name}? This cannot be undone." Cancel left, destructive right, ⌘↵ |
| Required-field asterisks | "Optional" tag inferred from the zod schema |
| Custom tooltips explaining fields | Glossary `termId` → `LabelWithHelp` |
| Friendly illustrations for empty states | Small dashed-circle icon, `text-xs` muted line, at most one secondary "Add X" |
| Spinner in the middle of the page | Skeleton of the real shape, NProgress bar for navigation, `Button isLoading` for actions |
| Numbers right-aligned with bold totals | Left-aligned list cells with `tabular-nums`; right alignment only in label→amount summaries; totals `font-semibold` |
| Undo snackbars | Confirm first; soft delete where reversible ("Deactivate", "Move to Trash") |
| Floating "+" action button | "Add X" primary in the table title bar (desk); FAB only in MES operation dock |
| Read-only "view" pages with an Edit button elsewhere | The page you read is the page you edit; locks disable in place |
| Hover-scale animations, bouncy springs | Press `active:scale-[0.96]`, 150–200ms ease-out, property-scoped transitions |
| Wide-screen dashboards with many widgets | Content capped (`max-w-4xl` create, `max-w-5xl` posting docs, `max-w-[60rem]` settings); dashboards only on module landing pages |

---

## 4. When principles conflict

1. **Consistency with the nearest sibling beats local optimisation** (P6, P7). If the sibling
   screen does X, do X, even if Y is marginally nicer — then raise Y as a system-wide proposal.
2. **Honesty beats calm** (P13 over P1). A real problem gets a red badge or Alert.
3. **The operator's hands beat density** in MES (P17 over P10).
4. **Translation beats convenience** (P16): never ship an English literal "for now".
5. **When Carbon itself is inconsistent**, follow in this order: the majority pattern in the
   code → the newest canonical module (Sales Return Orders, 2026-09-10) → the written rule.
   Never copy a pattern listed in `anti-patterns.md` just because a sibling has it.
