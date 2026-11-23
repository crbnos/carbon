# MES phone layout, round 2 — implementation plan

**Spec / source:** .ai/specs/2026-10-07-mes-phone-round-2.md
**Status:** approved
**Branch:** feat/mobile-redesign

## Progress
- [x] Task 1: Capture the baseline screenshots
- [x] Task 2: Add the shared TabBar to @carbon/react and point the ERP tab bar at it
- [x] Task 3: Export the queue list and add the origin helpers
- [x] Task 4: Fix the phone Navigation sheet
- [x] Task 5: Create MesAppBar
- [x] Task 6: Create MesTabBar, mount it, and turn on safe areas
- [x] Task 7: Move the 7 queue pages onto MesAppBar and rename 2 titles
- [x] Task 8: Pass the origin from every operation link
- [x] Task 9: Operation header: MesAppBar and Back to the origin
- [x] Task 10: Inspection, Assembly and Job detail headers on MesAppBar
- [x] Task 11: My Hours: app bar, bottom Clock bar and entry rows
- [x] Task 12: Board work cards in 2 columns
- [x] Task 13: List work cards in 2 columns with the right colours
- [x] Task 14: Schedule toolbar in 1 row
- [x] Task 15: Assigned, Active and Recent toolbars
- [x] Task 16: Board columns on phones
- [x] Task 17: Operation context row scrolls with the content
- [x] Task 18: Operation meters in 1 row and the grouped quantity card
- [x] Task 19: Operation dock: open on the running timer and show its labels
- [x] Task 20: Picking detail on phones
- [x] Task 21: Smaller fixes on Picking list, Jobs and Maintenance
- [x] Task 22: Inspection task screen on phones
- [x] Task 23: Operation materials as row cards on phones
- [x] Task 24: Job graph top to bottom on phones
- [x] Task 25: Maintenance dispatch: app bar, Complete button and confirmation
- [x] Task 26: Empty states on phones
- [x] Task 27: Extract strings, typecheck and Biome
- [x] Task 28: Verify in the browser at 393×852 and 1280×800

## Dependencies

Run Task 1 before any source edit. It records the "before" screenshots for acceptance criteria 16 and 17.

| Wave | Tasks (parallel inside a wave) | Needs |
|---|---|---|
| 1 | 2, 3, 4, 5, 16, 24 | Task 1 |
| 2 | 6, 7, 8, 9, 10, 20, 25 | 6 needs 2 and 3. 7, 20 and 25 need 5. 8 needs 3. 9 and 10 need 3 and 5. |
| 3 | 11, 12, 13, 14, 15, 17, 21, 22 | 11 needs 5 and 6. 12 and 13 need 8. 14, 15 and 21 need 7. 17 needs 9. 22 needs 10. |
| 4 | 18 | 17 |
| 5 | 19 | 18 |
| 6 | 23, 26 | 23 needs 19. 26 needs 14, 15 and 21. |
| 7 | 27 | 1–26 |
| 8 | 28 | 27 |

The tasks inside one wave touch disjoint files. These chains must stay in order because they edit the same file:

- `apps/mes/app/components/JobOperation/JobOperation.tsx` (about 3400 lines): 9 → 17 → 18 → 19 → 23. Never run 2 of these at the same time.
- `apps/mes/app/components/Inspection/InspectionView.tsx`: 10 → 22.
- `apps/mes/app/components/OperationsList.tsx`: 8 → 13. `ItemCard.tsx`: 8 → 12.
- `operations.tsx`: 7 → 14 → 26. `active.tsx`: 7 → 15 → 26. `jobs.tsx`, `maintenance.tsx`, `picking._index.tsx`: 7 → 21 → 26.

Notes for every task:

- 🛑 Never run `git commit`, `git stash` or `git reset`. The owner commits by hand.
- New files: the license fixer skips untracked files (it reads `git ls-files --cached`). Instead of running it, paste the 3-line AGPL header from the top of `apps/mes/app/components/MesAppBar.tsx` as the first lines of the new file.
- Line numbers come from the working tree on 2026-10-07, before this plan. After an earlier task edits the same file, find each snippet by its text.
- Phone-only styles use `max-md:`. The dock and toggle labels in Task 19 use `max-lg:`, because the spec says "below 1024px".
- At 768px and up, nothing may change except these 4 approved items:
  - the Back label and target (Tasks 8, 9);
  - the titles "Assigned" and "Jobs" (Task 7);
  - the timer toggle default (Task 19);
  - the dispatch Complete confirmation (Task 25).
- Every new user-facing string uses `useLingui().t` or `<Trans>` from `@lingui/react/macro`. Task 27 runs the extraction once.
- Never override Radix internals. Never change the green Start, the red Pause or the dock actions.
- **Correction to spec 1.5 (origin mechanism).** The spec says `state={{ from }}`. React Router drops `location.state` on every loader redirect: `startRedirectNavigation` builds the new location with only `{ _isRedirect: true }` (`node_modules/.pnpm/react-router@7.18.4_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/react-router/dist/development/chunk-OB3PAWPO.mjs:2967-2969`). The operation loader redirects to Assembly and Inspection (`apps/mes/app/routes/x+/operation.$operationId.tsx:164-169`) and adds `trackedEntityId` (`:296-298`). Each of these redirects keeps `url.search`. So this plan carries the origin in a `from` search parameter instead of `state`. The behaviour is the one the spec asks for, and it also survives a reload.

---
## Task 1: Capture the baseline screenshots

**Depends on:** none
**Files:**
- Create: `${TMPDIR:-/tmp}/mes-round2/before/*.png` and `${TMPDIR:-/tmp}/mes-round2/urls.txt` (scratch, outside the repo)
- Copy from (precedent): `.claude/skills/auth/SKILL.md`

**Steps:**
1. 🛑 Do this task before any source edit. If a source file already shows a change from this plan, STOP and report.
2. Read the URLs. Run `grep '^ERP_URL' .env.local` and `grep '^MES_URL' .env.local`.
3. If the MES URL does not answer (`curl -s -o /dev/null -w '%{http_code}' "$MES_URL/login"` is not 200), STOP and report.
4. Run `mkdir -p "${TMPDIR:-/tmp}/mes-round2/before"`.
5. Log in with `agent-browser`. Follow `.claude/skills/auth/SKILL.md` steps 2 to 4 exactly. Use one browser session only.
6. Run `agent-browser set viewport 1280 800 1`.
7. Open `${MES_URL}/x/operations`. Wait 3 seconds (`agent-browser wait 3000`). Run `agent-browser screenshot "${TMPDIR:-/tmp}/mes-round2/before/desktop-schedule.png"`.
8. Do step 7 again for `/x/assigned` (`desktop-assigned.png`) and `/x/jobs` (`desktop-jobs.png`).
9. Find an operation link on Schedule: `agent-browser eval '[...document.querySelectorAll("a[href*=\"/x/operation/\"]")].slice(0,15).map(a=>a.getAttribute("href"))'`.
10. Open the first link. Wait 3 seconds. Run `agent-browser eval 'location.pathname'`.
11. If the path starts with `/x/operation/`, save it as `OPERATION_URL`. Screenshot `desktop-operation.png`.
12. Open the next links one by one. Save the first one that lands on `/x/inspection/` as `INSPECTION_URL`. Screenshot `desktop-inspection.png`. If none of the 15 does, write `INSPECTION_URL=none` and continue.
13. Open `/x/picking`. Click the first card. Save the URL as `PICKING_URL`. Screenshot `desktop-picking-detail.png`.
14. Write the 3 URLs into `${TMPDIR:-/tmp}/mes-round2/urls.txt`, one `NAME=value` per line.
15. Run `agent-browser set viewport 393 852 1`. Open `${ERP_URL}/x`. Wait 3 seconds. Screenshot `erp-tabbar-393.png`.
16. Run `agent-browser close`.

**Verify:**
```bash
ls "${TMPDIR:-/tmp}/mes-round2/before" && cat "${TMPDIR:-/tmp}/mes-round2/urls.txt"
# Expected: desktop-schedule.png, desktop-assigned.png, desktop-jobs.png, desktop-operation.png,
# desktop-picking-detail.png, erp-tabbar-393.png (and desktop-inspection.png when found);
# urls.txt has OPERATION_URL, INSPECTION_URL and PICKING_URL lines.
```

**Out of scope:** Any source edit. Any second browser session.

---
## Task 2: Add the shared TabBar to @carbon/react and point the ERP tab bar at it

**Depends on:** 1
**Files:**
- Create: `packages/react/src/TabBar.tsx`
- Modify: `packages/react/src/index.tsx` — import and export `TabBar`, `TabBarItem`
- Modify: `apps/erp/app/components/Layout/Mobile/MobileTabBar.tsx` — use the shared parts
- Copy from (precedent): `apps/erp/app/components/Layout/Mobile/MobileTabBar.tsx:21-53` (`tabClassName`, `Tab`) and `:84-90` (the `<nav>` classes)

**Steps:**
1. Create `packages/react/src/TabBar.tsx` with this content (the SPDX header comes in step 6):
```tsx
import type { HTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "./utils/cn";

const tabBarItemClassName =
  "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium leading-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** The phone bottom tab bar. Hidden at md and up. */
export function TabBar({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <nav
      className={cn(
        "md:hidden flex shrink-0 items-stretch border-t border-border bg-card/92 px-1 pt-1 pb-safe backdrop-blur",
        className
      )}
      {...props}
    >
      {children}
    </nav>
  );
}

type TabBarItemProps = {
  icon: ReactNode;
  label: string;
  isActive?: boolean;
  /** A count on the icon. Hidden when 0 or missing. */
  count?: number;
  /** A pill behind the icon of the active tab. */
  pill?: boolean;
} & ({ to: string; onClick?: never } | { to?: never; onClick: () => void });

/** One tab: a link when `to` is set, else a button. */
export function TabBarItem({
  icon,
  label,
  isActive = false,
  count,
  pill = false,
  to,
  onClick
}: TabBarItemProps) {
  const content = (
    <>
      <span
        className={cn(
          "relative flex items-center justify-center [&>svg]:size-5",
          pill ? "h-7 w-12 rounded-full" : "size-6",
          pill && isActive && "bg-active",
          isActive ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {icon}
        {count ? (
          <span className="absolute -top-1 left-1/2 ml-1 h-4 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-medium leading-4 text-primary-foreground tabular-nums">
            {count}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "max-w-full truncate",
          isActive ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
      </span>
    </>
  );

  if (to !== undefined) {
    return (
      <Link
        to={to}
        className={tabBarItemClassName}
        aria-current={isActive ? "page" : undefined}
      >
        {content}
      </Link>
    );
  }

  return (
    <button type="button" className={tabBarItemClassName} onClick={onClick}>
      {content}
    </button>
  );
}
```
2. In `packages/react/src/index.tsx`, after line 352 (`import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";`), add `import { TabBar, TabBarItem } from "./TabBar";`.
3. In the same file, in the `export {` list, add `TabBar,` and `TabBarItem,` before `  Table,` (line 664).
4. In `MobileTabBar.tsx`, delete `tabClassName` and the `Tab` function (lines 21-53).
5. Change the imports of `MobileTabBar.tsx`:
   - `import { cn } from "@carbon/react";` → `import { cn, TabBar, TabBarItem } from "@carbon/react";`
   - Delete `import type { ReactNode } from "react";`.
   - `import { Link, useLocation } from "react-router";` → `import { useLocation } from "react-router";`
6. Replace the `<nav …>…</nav>` block (lines 84-144) with:
```tsx
      <TabBar aria-label={t`Main`} className={cn(hidden && "hidden")}>
        <TabBarItem
          to={path.to.authenticatedRoot}
          icon={<LuHouse />}
          label={t`Home`}
          isActive={isHome}
        />
        <TabBarItem
          icon={<LuSearch />}
          label={t`Search`}
          onClick={openSearchModal}
        />
        <TabBarItem
          icon={<LuSquarePen />}
          label={t`Create`}
          isActive={sheet === "create"}
          onClick={() => setSheet("create")}
        />
        <TabBarItem
          icon={<LuLayoutGrid />}
          label={t`Modules`}
          isActive={sheet === "modules"}
          onClick={() => setSheet("modules")}
        />
        <TabBarItem
          icon={
            <Avatar
              path={user.avatarUrl}
              name={`${user.firstName} ${user.lastName}`}
              size="xs"
            />
          }
          label={t`Profile`}
          isActive={sheet === "profile"}
          onClick={() => setSheet("profile")}
        />
      </TabBar>
```
7. Add the license header: `pnpm --filter @carbon/checks license-headers -- "$PWD/packages/react/src/TabBar.tsx"`.
8. Sort the imports: `pnpm exec biome check --write packages/react/src/index.tsx`.

**Verify:**
```bash
head -1 packages/react/src/TabBar.tsx
# Expected: // SPDX-License-Identifier: AGPL-3.0-only
pnpm exec turbo run typecheck --filter=@carbon/react --filter=erp
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check packages/react/src/TabBar.tsx packages/react/src/index.tsx apps/erp/app/components/Layout/Mobile/MobileTabBar.tsx
# Expected: "Checked 3 files" and no errors.
```

**Out of scope:** The ERP sheets (`CreateSheet`, `ModulesSheet`, `ProfileSheet`), `useAppBar`, `MobileBottomChrome`. The ERP tab bar must look the same as before (checked in Task 28).

---
## Task 3: Export the queue list and add the origin helpers

**Depends on:** 1
**Files:**
- Create: `apps/mes/app/utils/origin.ts`
- Modify: `apps/mes/app/components/AppSidebar.tsx` — export `QueueKey`, `QUEUES`, `queuePath`, `useQueueTitles`, `queueKeyForPath`, `useOrigin`; add the trailing ↗ to Displays
- Copy from (precedent): `apps/mes/app/components/AppSidebar.tsx:145-174` (the current `QUEUES`, `pathOf` and `titles`)

**Steps:**
1. Create `apps/mes/app/utils/origin.ts`:
```ts
/** The query parameter that carries the page an operation was opened from. */
export const ORIGIN_PARAM = "from";

/** `to` plus `?from=<the current page>`, so Back can return to that page. */
export function withOrigin(
  to: string,
  from: { pathname: string; search: string }
): string {
  const separator = to.includes("?") ? "&" : "?";
  const value = encodeURIComponent(`${from.pathname}${from.search}`);
  return `${to}${separator}${ORIGIN_PARAM}=${value}`;
}

/** The origin page, or null. Only MES paths (`/x/…`) count. */
export function readOrigin(searchParams: URLSearchParams): string | null {
  const from = searchParams.get(ORIGIN_PARAM);
  return from?.startsWith("/x/") ? from : null;
}
```
2. Add the license header: `pnpm --filter @carbon/checks license-headers -- "$PWD/apps/mes/app/utils/origin.ts"`.
3. In `AppSidebar.tsx`, change line 29 to `import { Await, useLocation, useNavigate, useSearchParams } from "react-router";`. Line 17 already imports `useMemo`.
4. Add `LuArrowUpRight` to the `react-icons/lu` import (lines 19-28).
5. Add `import { readOrigin } from "~/utils/origin";` after the `~/utils/path` import (line 33).
6. Replace lines 145-159 (`type QueueKey …` to `const pathOf …`) with:
```ts
export type QueueKey = keyof typeof MES_NAV_SHORTCUTS;

/** The task queues, in rail order; each one's ⌥-digit comes from its key. */
export const QUEUES: { key: QueueKey; icon: typeof LuActivity; to: string }[] =
  [
    { key: "operations", icon: LuCalendarDays, to: path.to.operations },
    { key: "assigned", icon: LuClipboardList, to: path.to.assigned },
    { key: "active", icon: LuActivity, to: path.to.active },
    { key: "recent", icon: LuHistory, to: path.to.recent },
    { key: "jobs", icon: LuCirclePlay, to: path.to.jobs },
    { key: "maintenance", icon: LuWrench, to: path.to.maintenance },
    { key: "picking", icon: LuPackageCheck, to: path.to.picking }
  ];

/** `path.to.operations` carries a `?saved=1` query; activity matches on paths. */
export const queuePath = (to: string) => to.split("?")[0];

/** The queue titles. The rail, the tab bar and Back labels share them. */
export function useQueueTitles(): Record<QueueKey, string> {
  const { t } = useLingui();
  return useMemo(
    () => ({
      operations: t`Schedule`,
      assigned: t`Assigned`,
      active: t`Active`,
      recent: t`Recent`,
      jobs: t`Jobs`,
      maintenance: t`Maintenance`,
      picking: t`Picking`
    }),
    [t]
  );
}

/** The queue a path belongs to. Job detail (`/x/job/:id`) belongs to Jobs. */
export function queueKeyForPath(pathname: string): QueueKey | undefined {
  const queue = QUEUES.find((q) => pathname.startsWith(queuePath(q.to)));
  if (queue) return queue.key;
  // generatePath drops a trailing slash, so add it back for the prefix test.
  return pathname.startsWith(`${path.to.jobDag("")}/`) ? "jobs" : undefined;
}

/** Back on Operation, Assembly and Inspection: the `from` page, else Schedule. */
export function useOrigin(): { to: string; label: string } {
  const [searchParams] = useSearchParams();
  const titles = useQueueTitles();
  const from = readOrigin(searchParams);
  if (!from) return { to: path.to.operations, label: titles.operations };
  const key = queueKeyForPath(queuePath(from));
  return { to: from, label: key ? titles[key] : titles.operations };
}
```
7. In `QueueLinks` (lines 161-201), delete `const { t } = useLingui();` and the `titles` object (lines 162 and 166-174). Add `const titles = useQueueTitles();` in their place.
8. In `QueueLinks`, change `isActive={pathname.startsWith(pathOf(queue.to))}` to `isActive={pathname.startsWith(queuePath(queue.to))}`.
9. In `DisplaysLink` (lines 208-221), add this prop to `NavRailLink`, after `rel="noreferrer"`:
```tsx
      trailing={
        <LuArrowUpRight className="hidden size-4 text-muted-foreground max-md:block" />
      }
```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check apps/mes/app/utils/origin.ts apps/mes/app/components/AppSidebar.tsx
# Expected: "Checked 2 files" and no errors.
head -1 apps/mes/app/utils/origin.ts
# Expected: // SPDX-License-Identifier: AGPL-3.0-only
```

**Out of scope:** The rail order, groups and shortcuts. `NavRail.tsx` (Task 4).

---
## Task 4: Fix the phone Navigation sheet

**Depends on:** 1
**Files:**
- Modify: `packages/react/src/NavRail.tsx` — phone branch only: pinned footer, inline count badge, ↗ on the brand row
- Copy from (precedent): `packages/react/src/NavRail.tsx:155-187` (the current phone branch)

**Steps:**
1. Add `import { LuArrowUpRight } from "react-icons/lu";` after line 18 (the `react` import).
2. Replace the phone branch (lines 167-187, `if (isMobile) { … }`) with:
```tsx
  if (isMobile) {
    // The footer (Clock In, My Hours, the user) stays pinned under the
    // scrolling groups, so it shows without a scroll.
    return (
      <Drawer open={openMobile} onOpenChange={setOpenMobile}>
        <DrawerContent
          position="left"
          size="content"
          className="w-[17rem] max-w-[85vw] p-0"
        >
          <DrawerTitle className="px-6 py-4">
            <Trans>Navigation</Trans>
          </DrawerTitle>
          <NavRailHoldContext.Provider value={hold}>
            <nav
              data-state="expanded"
              className="group min-h-0 flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent pb-4"
            >
              <VStack spacing={1} className="px-2">
                {header ? <div className="w-full pb-2">{header}</div> : null}
                {children}
              </VStack>
            </nav>
            {footer ? (
              <div
                data-state="expanded"
                className="group shrink-0 border-t border-border px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
              >
                <VStack spacing={1}>{footer}</VStack>
              </div>
            ) : null}
          </NavRailHoldContext.Provider>
        </DrawerContent>
      </Drawer>
    );
  }
```
3. In `NavRailItem`, change the tag span class (line 338) from
   `"absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-medium leading-4 text-center tabular-nums"`
   to
   `"absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-medium leading-4 text-center tabular-nums max-md:top-1/2 max-md:right-3 max-md:h-5 max-md:min-w-5 max-md:-translate-y-1/2 max-md:text-xs max-md:leading-5"`.
4. In `NavRailItem`, change the label row `cn(…)` (lines 345-349) to add one line, so a long label stops before the badge:
```tsx
          className={cn(
            "absolute left-7 right-3 min-w-32 group-data-[state=expanded]:left-12",
            "flex items-center gap-2",
            "opacity-0 group-data-[state=expanded]:opacity-100 max-md:opacity-100",
            tag ? "max-md:right-11" : null
          )}
```
5. In `NavRailBrand`, after the label `<span …>{label}</span>` (lines 435-440), add:
```tsx
      <LuArrowUpRight
        aria-hidden
        className="hidden size-4 shrink-0 text-muted-foreground max-md:block"
      />
```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/react
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check packages/react/src/NavRail.tsx
# Expected: "Checked 1 file" and no errors.
```

**Out of scope:** The desktop rail (lines 189-268), hover logic, the item order and the groups. The sheet keeps every desktop item.

---
## Task 5: Create MesAppBar

**Depends on:** 1
**Files:**
- Create: `apps/mes/app/components/MesAppBar.tsx`
- Copy from (precedent): `apps/erp/app/components/Layout/Mobile/MobileAppBar.tsx:61-104` (phone bar), `apps/mes/app/routes/x+/active.tsx:74-81` (today's desktop header)

**Steps:**
1. Create `apps/mes/app/components/MesAppBar.tsx`:
```tsx
import { Button, cn, Heading, SidebarTrigger } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuChevronLeft } from "react-icons/lu";
import { Link } from "react-router";

type MesAppBarProps = {
  kind: "root" | "pushed";
  title: ReactNode;
  /** Pushed pages: the parent page name, under the title. */
  subtitle?: ReactNode;
  /** Pushed pages: where Back goes. */
  back?: { to: string };
  /** Phones: at most 2 icon actions, each 44×44. */
  actions?: ReactNode;
  /**
   * The md+ header. Omit it for today's queue header (trigger + h4 title).
   * Pass `null` when the page renders its own md+ header, or none.
   */
  desktop?: ReactNode;
  /** Extra classes for the default md+ header. */
  desktopClassName?: string;
};

/**
 * The MES page header. Below md: one 52px bar with Back (pushed pages), a
 * 17px title and up to 2 actions. From md: the header each page had before.
 */
export function MesAppBar({
  kind,
  title,
  subtitle,
  back,
  actions,
  desktop,
  desktopClassName
}: MesAppBarProps) {
  const { t } = useLingui();

  const desktopHeader =
    desktop === undefined ? (
      <header
        className={cn(
          "sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center gap-2 border-b bg-card max-md:hidden",
          desktopClassName
        )}
      >
        <div className="flex items-center gap-2 px-2">
          <SidebarTrigger />
          <Heading size="h4">{title}</Heading>
        </div>
      </header>
    ) : (
      desktop
    );

  return (
    <>
      <header className="md:hidden sticky top-0 z-20 flex h-[calc(52px+env(safe-area-inset-top))] shrink-0 items-center gap-1 border-b border-border bg-card px-1 pt-safe">
        {kind === "pushed" && back ? (
          <Button
            asChild
            isIcon
            variant="ghost"
            size="lg"
            aria-label={t`Back`}
            className="shrink-0"
          >
            <Link to={back.to}>
              <LuChevronLeft className="size-6" />
            </Link>
          </Button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <span className="truncate text-[17px] font-semibold leading-tight text-foreground">
            {title}
          </span>
          {subtitle ? (
            <span className="truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center self-stretch">
            {actions}
          </div>
        ) : null}
      </header>
      {desktopHeader}
    </>
  );
}
```
2. Add the license header: `pnpm --filter @carbon/checks license-headers -- "$PWD/apps/mes/app/components/MesAppBar.tsx"`.

**Verify:**
```bash
head -1 apps/mes/app/components/MesAppBar.tsx
# Expected: // SPDX-License-Identifier: AGPL-3.0-only
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check apps/mes/app/components/MesAppBar.tsx
# Expected: "Checked 1 file" and no errors.
```

**Out of scope:** Using the component on a page (Tasks 7, 9, 10, 11, 20, 25). `apps/mes/app/components/index.ts`: import the file by its path.

---
## Task 6: Create MesTabBar, mount it, and turn on safe areas

**Depends on:** 2, 3
**Files:**
- Create: `apps/mes/app/components/MesTabBar.tsx`
- Modify: `apps/mes/app/root.tsx` — `viewport-fit=cover` (line 241)
- Modify: `apps/mes/app/routes/x+/_layout.tsx` — mount the bar, pad root pages
- Modify: `apps/mes/app/styles/tailwind.css` — toasts above the bar
- Copy from (precedent): `apps/erp/app/root.tsx:262-263` (viewport meta), `apps/erp/app/styles/tailwind.css:236-244` (toast offset), `apps/erp/app/routes/x+/_layout.tsx:550-554` (tab bar mount)

**Steps:**
1. In `apps/mes/app/root.tsx` line 241, change `content="width=device-width, initial-scale=1"` to `content="width=device-width, initial-scale=1, viewport-fit=cover"`.
2. Create `apps/mes/app/components/MesTabBar.tsx`:
```tsx
import {
  cn,
  isEditableTarget,
  TabBar,
  TabBarItem,
  useSidebar
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuMenu } from "react-icons/lu";
import { useLocation } from "react-router";
import { path } from "~/utils/path";
import type { QueueKey } from "./AppSidebar";
import { QUEUES, queuePath, useQueueTitles } from "./AppSidebar";

const TAB_KEYS: QueueKey[] = ["operations", "assigned", "active", "maintenance"];

// Root pages that the More tab stands for.
const MORE_PATHS = [
  path.to.recent,
  path.to.jobs,
  path.to.picking,
  path.to.timeCardPage
];

// Exact paths: `/x/picking/:id` shares the Picking prefix but is a pushed page.
const ROOT_PATHS = new Set([
  ...QUEUES.map((queue) => queuePath(queue.to)),
  path.to.timeCardPage
]);

const trimSlash = (pathname: string) => pathname.replace(/\/$/, "");

/** True on the root pages that show the tab bar. */
export function isTabBarPath(pathname: string) {
  return ROOT_PATHS.has(trimSlash(pathname));
}

const NON_TEXT_INPUTS = ["checkbox", "radio", "button", "submit", "reset"];

/**
 * Phones: Schedule · Assigned · Active · Maintenance · More, on root pages
 * only. More opens the Navigation sheet. Hidden while a text field has focus.
 */
export function MesTabBar({
  activeEvents,
  activeMaintenanceCount
}: {
  activeEvents: number;
  activeMaintenanceCount: number;
}) {
  const { t } = useLingui();
  const titles = useQueueTitles();
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      setIsTyping(
        isEditableTarget(target) &&
          !(
            target instanceof HTMLInputElement &&
            NON_TEXT_INPUTS.includes(target.type)
          )
      );
    };
    const onFocusOut = () => setIsTyping(false);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  if (!isTabBarPath(pathname)) return null;

  const current = trimSlash(pathname);
  const counts: Partial<Record<QueueKey, number>> = {
    active: activeEvents,
    maintenance: activeMaintenanceCount
  };

  return (
    <TabBar
      aria-label={t`Main`}
      data-mes-tab-bar=""
      data-visible={isTyping ? "false" : "true"}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 min-h-[calc(54px+env(safe-area-inset-bottom))]",
        isTyping && "hidden"
      )}
    >
      {QUEUES.filter((queue) => TAB_KEYS.includes(queue.key)).map((queue) => (
        <TabBarItem
          key={queue.key}
          to={queue.to}
          icon={<queue.icon />}
          label={titles[queue.key]}
          isActive={current === queuePath(queue.to)}
          count={counts[queue.key]}
          pill
        />
      ))}
      <TabBarItem
        icon={<LuMenu />}
        label={t`More`}
        isActive={MORE_PATHS.includes(current)}
        onClick={() => setOpenMobile(true)}
        pill
      />
    </TabBar>
  );
}
```
3. Add the license header: `pnpm --filter @carbon/checks license-headers -- "$PWD/apps/mes/app/components/MesTabBar.tsx"`.
4. In `_layout.tsx`, add `cn,` to the `@carbon/react` import (lines 33-43).
5. In `_layout.tsx`, add `useLocation,` to the `react-router` import (lines 61-68).
6. In `_layout.tsx`, add `import { isTabBarPath, MesTabBar } from "~/components/MesTabBar";` after line 70 (`ConsolePill` import).
7. After line 356 (`const navigate = useNavigate();`), add:
```tsx
  const { pathname } = useLocation();
  const showTabBar = isTabBarPath(pathname);
```
8. Replace the content column opening tag (line 530):
   - Before: `<div className="flex flex-1 flex-col min-w-0 overflow-hidden bg-card md:mt-2 md:mr-2 md:mb-2 md:rounded-2xl md:border md:border-border">`
   - After:
```tsx
                  <div
                    className={cn(
                      "flex flex-1 flex-col min-w-0 overflow-hidden bg-card md:mt-2 md:mr-2 md:mb-2 md:rounded-2xl md:border md:border-border",
                      showTabBar &&
                        "max-md:pb-[calc(54px+env(safe-area-inset-bottom))]"
                    )}
                  >
```
9. After that column's closing `</div>` (line 535), before `<ShortcutHelp />`, add:
```tsx
                  <MesTabBar
                    activeEvents={activeEvents}
                    activeMaintenanceCount={activeMaintenanceCount}
                  />
```
10. Append to `apps/mes/app/styles/tailwind.css`:
```css
/*
 * Phones (< 768px): toasts sit above the MES tab bar while it shows.
 * Sonner's own mobileOffset only applies up to 600px.
 */
@media (width < 48rem) {
  body:has([data-mes-tab-bar][data-visible="true"])
    [data-sonner-toaster][data-y-position="bottom"] {
    bottom: calc(54px + env(safe-area-inset-bottom) + 16px);
  }
}
```

**Verify:**
```bash
grep -n 'viewport-fit=cover' apps/mes/app/root.tsx
# Expected: one match on the viewport meta line.
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check apps/mes/app/components/MesTabBar.tsx apps/mes/app/routes/x+/_layout.tsx apps/mes/app/root.tsx
# Expected: "Checked 3 files" and no errors.
```

**Out of scope:** The shell scroll model (`_layout.tsx:489`). Per-user tab settings. The tab bar on pushed pages.

---
## Task 7: Move the 7 queue pages onto MesAppBar and rename 2 titles

**Depends on:** 5
**Files:**
- Modify: `apps/mes/app/routes/x+/operations.tsx` — header lines 571-578
- Modify: `apps/mes/app/routes/x+/assigned.tsx` — header lines 240-247, title "Assigned"
- Modify: `apps/mes/app/routes/x+/active.tsx` — header lines 74-81
- Modify: `apps/mes/app/routes/x+/recent.tsx` — header lines 74-81
- Modify: `apps/mes/app/routes/x+/jobs.tsx` — header lines 125-132, title "Jobs"
- Modify: `apps/mes/app/routes/x+/maintenance.tsx` — header lines 409-416
- Modify: `apps/mes/app/routes/x+/picking._index.tsx` — header lines 47-54
- Copy from (precedent): `apps/mes/app/components/MesAppBar.tsx` (Task 5)

**Steps:**
1. In each of the 7 files, add `import { MesAppBar } from "~/components/MesAppBar";` to the `~/components…` imports.
2. In each file, replace the whole `<header …>…</header>` block with one `MesAppBar` line from this table:

| File | Replacement |
|---|---|
| `operations.tsx` | `<MesAppBar kind="root" title={<Trans>Schedule</Trans>} />` |
| `assigned.tsx` | `<MesAppBar kind="root" title={<Trans>Assigned</Trans>} desktopClassName="overflow-y-scroll scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent" />` |
| `active.tsx` | `<MesAppBar kind="root" title={<Trans>Active</Trans>} />` |
| `recent.tsx` | `<MesAppBar kind="root" title={<Trans>Recent</Trans>} />` |
| `jobs.tsx` | `<MesAppBar kind="root" title={<Trans>Jobs</Trans>} />` |
| `maintenance.tsx` | `<MesAppBar kind="root" title={<Trans>Maintenance</Trans>} />` |
| `picking._index.tsx` | `<MesAppBar kind="root" title={<Trans>Picking</Trans>} />` |

3. In each of the 7 files, remove `Heading` and `SidebarTrigger` from the `@carbon/react` import. No other line in these files uses them (checked with `grep -c '<Heading'` and `grep -c '<SidebarTrigger'`: 1 each, the header).

**Verify:**
```bash
grep -n 'Assigned to Me\|Open Jobs' apps/mes/app/routes/x+/assigned.tsx apps/mes/app/routes/x+/jobs.tsx
# Expected: no output.
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check apps/mes/app/routes/x+/operations.tsx apps/mes/app/routes/x+/assigned.tsx apps/mes/app/routes/x+/active.tsx apps/mes/app/routes/x+/recent.tsx apps/mes/app/routes/x+/jobs.tsx apps/mes/app/routes/x+/maintenance.tsx apps/mes/app/routes/x+/picking._index.tsx
# Expected: "Checked 7 files" and no errors.
```

**Out of scope:** The toolbars (Tasks 14, 15) and the empty states (Task 26). The Maintenance tab label "Assigned to Me" (`maintenance.tsx:442`) is a tab, not a page title, so it stays.

---
## Task 8: Pass the origin from every operation link

**Depends on:** 3
**Files:**
- Modify: `apps/mes/app/components/OperationsList.tsx` — Link at lines 115-118
- Modify: `apps/mes/app/components/Kanban/components/ItemCard.tsx` — Link at lines 116-118
- Modify: `apps/mes/app/components/JobDag/JobOperationNode.tsx` — `navigate` at lines 52-54
- Modify: `apps/mes/app/routes/x+/batch.$batchId.tsx` — redirect at line 33 keeps the query
- Copy from (precedent): `apps/mes/app/routes/x+/operation.$operationId.tsx:164-169` (redirects that keep `url.search`)

**Steps:**
1. `OperationsList.tsx`: change `import { Link } from "react-router";` to `import { Link, useLocation } from "react-router";`. Add `import { withOrigin } from "~/utils/origin";`.
2. In `OperationCard`, after `const { formatRelativeTime } = useDateFormatter();` (line 100), add `const location = useLocation();`.
3. Change `to={path.to.operation(operation.id)}` (line 116) to `to={withOrigin(path.to.operation(operation.id), location)}`.
4. `ItemCard.tsx`: change `import { Link } from "react-router";` (line 37) to `import { Link, useLocation } from "react-router";`. Add `import { withOrigin } from "~/utils/origin";`.
5. In `ItemCard`, before `const isBatch = …` (line 113), add `const location = useLocation();`.
6. Change lines 116-118:
   - Before: `to={isBatch ? path.to.batch(item.batchId!) : path.to.operation(item.id)}`
   - After: `to={withOrigin(isBatch ? path.to.batch(item.batchId!) : path.to.operation(item.id), location)}`
7. `JobOperationNode.tsx`: change `import { useNavigate } from "react-router";` to `import { useLocation, useNavigate } from "react-router";`. Add `import { withOrigin } from "~/utils/origin";`.
8. After `const navigate = useNavigate();` (line 40), add `const location = useLocation();`.
9. Replace both `navigate(path.to.operation(d.id))` calls (lines 52 and 54) with `navigate(withOrigin(path.to.operation(d.id), location))`.
10. `batch.$batchId.tsx` line 33:
    - Before: `throw redirect(path.to.operation(firstMember.id));`
    - After: `throw redirect(path.to.operation(firstMember.id) + new URL(request.url).search);`

**Verify:**
```bash
grep -n 'withOrigin' apps/mes/app/components/OperationsList.tsx apps/mes/app/components/Kanban/components/ItemCard.tsx apps/mes/app/components/JobDag/JobOperationNode.tsx
# Expected: 1 import and at least 1 call per file.
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check apps/mes/app/components/OperationsList.tsx apps/mes/app/components/Kanban/components/ItemCard.tsx apps/mes/app/components/JobDag/JobOperationNode.tsx "apps/mes/app/routes/x+/batch.\$batchId.tsx"
# Expected: "Checked 4 files" and no errors.
```

**Out of scope:** The batch member links inside the Operation page (`?scope=job`). They keep no origin; Back then goes to Schedule.

---
## Task 9: Operation header: MesAppBar and Back to the origin

**Depends on:** 3, 5
**Files:**
- Modify: `apps/mes/app/components/JobOperation/JobOperation.tsx` — header lines 801-837
- Copy from (precedent): `apps/mes/app/components/MesAppBar.tsx`

**Steps:**
1. Add these imports after line 145 (`import ItemThumbnail from "../ItemThumbnail";`):
```tsx
import { useOrigin } from "../AppSidebar";
import { MesAppBar } from "../MesAppBar";
```
2. After line 321 (`const [params, setParams] = useUrlParams();`), add `const origin = useOrigin();`.
3. Replace lines 801-814 (from `<header className="[grid-area:header] …">` to the closing `</div>` of the Back group):
   - Before:
```tsx
        <header className="[grid-area:header] flex h-[var(--header-height)] shrink-0 items-center gap-2 border-b px-2 max-md:h-auto max-md:py-1">
          <HStack className="w-full justify-between max-md:flex-wrap max-md:gap-y-1">
            <div className="flex items-center gap-0">
              <SidebarTrigger />

              <Button
                variant="ghost"
                leftIcon={<LuChevronLeft />}
                onClick={() => navigate(path.to.operations)}
                className="pl-2"
              >
                <Trans>Schedule</Trans>
              </Button>
            </div>
```
   - After:
```tsx
        <div className="[grid-area:header] flex min-w-0 flex-col">
          <MesAppBar
            kind="pushed"
            title={
              scope === "batch" && batch
                ? batch.readableId
                : operation.jobReadableId
            }
            subtitle={origin.label}
            back={{ to: origin.to }}
            desktop={null}
          />
          <header className="flex h-[var(--header-height)] shrink-0 items-center gap-2 border-b px-2 max-md:h-auto max-md:py-1">
          <HStack className="w-full justify-between max-md:flex-wrap max-md:gap-y-1">
            <div className="flex items-center gap-0 max-md:hidden">
              <SidebarTrigger />

              <Button
                variant="ghost"
                leftIcon={<LuChevronLeft />}
                onClick={() => navigate(origin.to)}
                className="pl-2"
              >
                {origin.label}
              </Button>
            </div>
```
4. After the header's closing `</header>` (line 837), add `</div>` to close the new wrapper.
5. Leave the `TabsList` block (lines 815-835) as it is. On phones it is the row under the app bar.

**Verify:**
```bash
grep -c 'navigate(path.to.operations)' apps/mes/app/components/JobOperation/JobOperation.tsx
# Expected: 2 (was 3). The batch-completion call (line 395) and the serial-modal cancel (line 3342) stay.
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check apps/mes/app/components/JobOperation/JobOperation.tsx
# Expected: "Checked 1 file" and no errors (run `pnpm exec biome format --write` on the file if only formatting differs).
```

**Out of scope:** The context row (Task 17), the dock (Task 19), the tabs.

---
## Task 10: Inspection, Assembly and Job detail headers on MesAppBar

**Depends on:** 3, 5
**Files:**
- Modify: `apps/mes/app/components/Inspection/InspectionView.tsx` — header lines 617-723
- Modify: `apps/mes/app/components/AssemblyView.tsx` — header lines 1629-1702
- Modify: `apps/mes/app/routes/x+/job.$jobId.tsx` — header lines 72-83
- Copy from (precedent): `apps/mes/app/components/MesAppBar.tsx`, `apps/mes/app/components/JobOperation/JobOperation.tsx` (Task 9 result)

**Steps:**
1. `InspectionView.tsx`: add `import { useOrigin } from "~/components/AppSidebar";` and `import { MesAppBar } from "~/components/MesAppBar";` after line 57 (`import { useUser } from "~/hooks";`).
2. After line 176 (`const { t } = useLingui();`), add `const origin = useOrigin();`.
3. Change the header open tag (line 617) to `<header className="flex h-[52px] shrink-0 items-center bg-card border-b border-border max-md:hidden">`.
4. Before that header (after the `{/* ── HEADER ── */}` comment, line 616), add:
```tsx
      <MesAppBar
        kind="pushed"
        title={inspection.inspectionId}
        subtitle={origin.label}
        back={{ to: origin.to }}
        desktop={null}
        actions={
          <>
            <Badge variant={statusBadgeVariant} className="mr-1">
              {inspection.status}
            </Badge>
            <IconButton
              aria-label={t`More actions`}
              variant="ghost"
              size="lg"
              icon={<LuEllipsisVertical />}
              onClick={actionsSheet.onOpen}
            />
            {workTypes.map((wt) => (
              <TimerControl
                key={wt}
                operationId={operationId}
                workCenterId={operation.workCenterId ?? undefined}
                openEvent={openEventForWorkType(wt)}
                workType={wt}
              />
            ))}
          </>
        }
      />
```
5. `AssemblyView.tsx`: add `import { useOrigin } from "~/components/AppSidebar";` and `import { MesAppBar } from "~/components/MesAppBar";` after line 92 (`TrackingTypeIcon` import).
6. After line 542 (`const { t } = useLingui();` inside `AssemblyView`), add `const origin = useOrigin();`.
7. Cut lines 1668-1701 (the `{operation ? (<button … Complete …` block, the `{operation ? (<button aria-label="More actions" …` block and the `{operation ? headerWorkTypes.map(…TimerControl…) : null}` block). Paste them, unchanged, into a const before `return (` (line 1626):
```tsx
  // The header's actions; the md+ header and the phone app bar share them.
  const headerActions = (
    <>
      {/* paste the 3 cut blocks here, unchanged */}
    </>
  );
```
8. Where the 3 blocks were (after the `Flag issue` button), put `{headerActions}`.
9. Change the header open tag (line 1629) to `<header className="flex h-[52px] shrink-0 items-center bg-card border-b border-border max-md:hidden">`.
10. Before that header, add:
```tsx
      <MesAppBar
        kind="pushed"
        title={job?.itemReadableIdWithRevision ?? "—"}
        subtitle={origin.label}
        back={{ to: origin.to }}
        desktop={null}
        actions={headerActions}
      />
```
11. `job.$jobId.tsx`: add `import { Trans } from "@lingui/react/macro";` and `import { MesAppBar } from "~/components/MesAppBar";`.
12. Change the header open tag (line 72) to `<header className="sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center gap-2 border-b bg-card max-md:hidden">`.
13. Before that header, add:
```tsx
      <MesAppBar
        kind="pushed"
        title={readableId}
        subtitle={<Trans>Jobs</Trans>}
        back={{ to: path.to.jobs }}
        desktop={null}
      />
```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check apps/mes/app/components/Inspection/InspectionView.tsx apps/mes/app/components/AssemblyView.tsx "apps/mes/app/routes/x+/job.\$jobId.tsx"
# Expected: "Checked 3 files" and no errors.
```

**Out of scope:** The Inspection meta bar, matrix and bottom bar (Task 22). The 3D viewers. The Assembly steps bar. The hard-coded English "Complete"/"Done"/"Flag issue" in `AssemblyView.tsx` (existing strings, not new).

---
## Task 11: My Hours: app bar, bottom Clock bar and entry rows

**Depends on:** 5, 6
**Files:**
- Modify: `apps/mes/app/routes/x+/timecard.tsx` — render (lines 224-536)
- Copy from (precedent): `apps/mes/app/routes/x+/jobs.tsx:234-279` (phone list rows), `apps/mes/app/routes/x+/timecard.tsx:489-534` (modal), `packages/react/src/Card.tsx:237-258` (sticky footer classes)

**Steps:**
1. Add `import { MesAppBar } from "~/components/MesAppBar";`.
2. Before `return (` (line 224), add 3 render helpers. Move the existing JSX into them; do not change it:
```tsx
  const renderClockForm = (size: "md" | "lg", className?: string) =>
    openEntry ? (
      <fetcher.Form method="post" className={className}>
        <input type="hidden" name="intent" value="clockOut" />
        <Button
          variant="destructive"
          type="submit"
          size={size}
          className={className}
          disabled={fetcher.state !== "idle"}
        >
          <Trans>Clock Out</Trans>
        </Button>
      </fetcher.Form>
    ) : (
      <fetcher.Form method="post" className={className}>
        <input type="hidden" name="intent" value="clockIn" />
        <Button
          leftIcon={<LuPlay />}
          type="submit"
          size={size}
          className={className}
          disabled={fetcher.state !== "idle"}
        >
          <Trans>Clock In</Trans>
        </Button>
      </fetcher.Form>
    );
```
   - `renderSaveForm(entryId: string)`: move the `<fetcher.Form method="post">…</fetcher.Form>` of the edit row (lines 370-410). Replace `value={entry.id}` with `value={entryId}`.
   - `renderEntryMenu(entry: { id: string; clockIn: string; clockOut: string | null }, size: "md" | "lg")`: move the `<DropdownMenu>…</DropdownMenu>` (lines 441-471). Add `size={size}` to its `IconButton`.
3. Use the helpers in their old places:
   - `{renderClockForm("md")}` inside the header `HStack` (lines 233-257);
   - `{renderSaveForm(entry.id)}` in the table edit row;
   - `{renderEntryMenu(entry, "md")}` in the table row.
4. Wrap the page in a fragment and add the app bar. Change line 225:
   - Before: `<div className="flex flex-col h-full w-full overflow-y-auto p-4 md:p-6">`
   - After:
```tsx
    <>
      <MesAppBar kind="root" title={<Trans>My Hours</Trans>} desktop={null} />
      <div className="flex flex-col h-full w-full overflow-y-auto p-4 md:p-6 max-md:h-auto max-md:overflow-visible max-md:pb-24">
```
   Close the fragment after the final `</div>` (line 535): `</>`.
5. Hide the header Clock button on phones: change `<HStack className="gap-1">` (line 233) to `<HStack className="gap-1 max-md:hidden">`.
6. Week stepper (lines 269-304):
   - Prev: `leftIcon={<LuChevronLeft />}` → `leftIcon={<LuChevronLeft className="max-md:mr-0" />}`. Add `className="max-md:size-11 max-md:px-0"`. Wrap the label: `<span className="max-md:sr-only"><Trans>Prev</Trans></span>`.
   - Next: `rightIcon={<LuChevronRight />}` → `rightIcon={<LuChevronRight className="max-md:ml-0" />}`. Add `className="max-md:size-11 max-md:px-0"`. Wrap both `Next` labels in `<span className="max-md:sr-only">…</span>` (the `<span>` at line 295 gets the class).
   - The range `<span className="text-sm text-muted-foreground">` (line 275) → `<span className="text-sm text-muted-foreground max-md:whitespace-nowrap">`.
7. Change the table wrapper (line 306) from `<div className="max-md:overflow-x-auto max-md:-mx-6 max-md:px-6">` to `<div className="max-md:hidden">`. Remove ` max-md:min-w-[560px]` from `TableBase` (line 307).
8. After that wrapper's closing `</div>` (line 479), add the phone list:
```tsx
            {entries.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground md:hidden">
                <Trans>No time entries for this week</Trans>
              </p>
            ) : (
              <ul className="-mx-4 divide-y divide-border border-y border-border md:hidden">
                {entries.map((entry) =>
                  editingId === entry.id ? (
                    <li key={entry.id} className="flex flex-col gap-2 px-4 py-3">
                      <span className="text-sm font-medium">
                        {formatDay(entry.clockIn, locale)}
                      </span>
                      <Input
                        type="datetime-local"
                        aria-label={t`Clock In`}
                        value={editClockIn}
                        onChange={(e) => setEditClockIn(e.target.value)}
                        className="w-full"
                      />
                      <Input
                        type="datetime-local"
                        aria-label={t`Clock Out`}
                        value={editClockOut}
                        onChange={(e) => setEditClockOut(e.target.value)}
                        className="w-full"
                      />
                      <HStack className="justify-end">
                        {renderSaveForm(entry.id)}
                        <Button variant="ghost" onClick={() => setEditingId(null)}>
                          <Trans>Cancel</Trans>
                        </Button>
                      </HStack>
                    </li>
                  ) : (
                    <li key={entry.id} className="flex items-center gap-2 py-2 pl-4 pr-1">
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium">
                            {formatDay(entry.clockIn, locale)}
                          </span>
                          <span className="text-sm tabular-nums">
                            {formatDuration(entry.clockIn, entry.clockOut)}
                          </span>
                        </div>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <DateTime value={entry.clockIn} variant="time" />
                          <span aria-hidden>–</span>
                          {entry.clockOut ? (
                            <DateTime value={entry.clockOut} variant="time" />
                          ) : (
                            <Badge variant="green">
                              <Trans>Active</Trans>
                            </Badge>
                          )}
                        </span>
                      </div>
                      {renderEntryMenu(entry, "lg")}
                    </li>
                  )
                )}
              </ul>
            )}
```
9. Before the fragment's closing `</>`, add the phone Clock bar. It sits above the tab bar:
```tsx
      <div className="fixed inset-x-0 bottom-[calc(54px+env(safe-area-inset-bottom))] z-20 border-t border-border bg-card px-4 py-3 md:hidden">
        {renderClockForm("lg", "w-full")}
      </div>
```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check apps/mes/app/routes/x+/timecard.tsx
# Expected: "Checked 1 file" and no errors.
```

**Out of scope:** A Clock Out confirmation (owner decision: none). The loader and action. The "Clocked in since" badge stays where it is.

---
## Task 12: Board work cards in 2 columns

**Depends on:** 8
**Files:**
- Modify: `apps/mes/app/components/Kanban/components/ItemCard.tsx` — header progress (lines 168-222), content (225-337), footer (338-353)
- Copy from (precedent): `apps/mes/app/routes/x+/jobs.tsx:264-274` (phone meta row)

**Steps:**
1. Wrap the 2 progress blocks (lines 168-222, both `{showProgress && … (<HStack className="mt-2">…)}`) in one element:
```tsx
          <div className="contents max-md:grid max-md:grid-cols-2 max-md:gap-3 max-md:[&>*:only-child]:col-span-2">
            {/* the 2 existing progress blocks, unchanged */}
          </div>
```
2. Change the `CardContent` class (line 225):
   - Before: `className="gap-2 text-left whitespace-pre-wrap text-sm"`
   - After: `className="gap-2 text-left whitespace-pre-wrap text-sm max-md:grid max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-1.5 max-md:[&>*]:min-w-0"`
3. Add `max-md:col-span-2` to the class of the job `HStack` (line 235) and the description `HStack` (line 246).
4. Add `max-md:order-1` to the class of the active-employees `HStack` (line 311) and the scrapped `HStack` (line 330). Sales order and customer then pair up.
5. Before `</CardContent>` (line 337), add the phone assignee and tags:
```tsx
          {(item.assignee || (item.tags && item.tags.length > 0)) && (
            <div className="hidden flex-wrap items-center gap-1 text-xs max-md:order-2 max-md:col-span-2 max-md:flex">
              {item.assignee && (
                <EmployeeAvatar size="xs" employeeId={item.assignee} />
              )}
              {item.tags?.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="border dark:border-none dark:shadow-button-base"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          )}
```
6. Change the `CardFooter` class (line 339) to `className="items-center justify-start space-2 text-xs flex-wrap max-md:hidden"`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check apps/mes/app/components/Kanban/components/ItemCard.tsx
# Expected: "Checked 1 file" and no errors.
```

**Out of scope:** Removing any field. The desktop card. The drag behaviour.

---
## Task 13: List work cards in 2 columns with the right colours

**Depends on:** 8
**Files:**
- Modify: `apps/mes/app/components/OperationsList.tsx` — header (lines 134, 138), content (143-220), footer (221-237)
- Copy from (precedent): `apps/mes/app/components/Kanban/components/ItemCard.tsx` (Task 12 result), `ItemCard.tsx:143` and `:160` (`text-foreground`)

**Steps:**
1. Title span (line 134): `className="mr-auto font-semibold line-clamp-2 leading-tight"` → `className="mr-auto font-semibold line-clamp-2 leading-tight max-md:text-foreground"`.
2. Quantity heading (line 138): `className="text-muted-foreground/70"` → `className="text-muted-foreground/70 max-md:text-foreground max-md:tabular-nums"`.
3. `CardContent` (line 143): `className="gap-2 text-left whitespace-pre-wrap text-sm flex-grow"` → add ` max-md:grid max-md:grid-cols-2 max-md:content-start max-md:gap-x-3 max-md:gap-y-1.5 max-md:[&>*]:min-w-0`.
4. Add `max-md:col-span-2` to the job `HStack` (line 153) and the description `HStack` (line 161).
5. Before `</CardContent>` (line 220), add the phone assignee and tags block from Task 12 step 5. Replace `item.` with `operation.` and drop `max-md:order-2`.
6. `CardFooter` (line 223): add ` max-md:hidden` to its class.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check apps/mes/app/components/OperationsList.tsx
# Expected: "Checked 1 file" and no errors.
```

**Out of scope:** The `settings` object (line 43). Merging `OperationCard` and `ItemCard`.

---
## Task 14: Schedule toolbar in 1 row

**Depends on:** 7
**Files:**
- Modify: `apps/mes/app/routes/x+/operations.tsx` — toolbar lines 579-686, app bar actions
- Modify: `apps/mes/app/components/SearchFilter.tsx` — merge `className`, add `groupClassName`
- Modify: `apps/mes/app/components/Filter/Filter.tsx` — 40×40 icon button on phones
- Copy from (precedent): `apps/mes/app/routes/x+/operations.tsx:612-678` (Display popover), `apps/mes/app/routes/x+/maintenance.tsx:424` (`scrollbar-hide` row)

**Steps:**
1. `SearchFilter.tsx`: add `cn` to the `@carbon/react` import. Change the props type and body:
```tsx
type SearchFilterProps = InputProps & {
  param: string;
  /** Classes for the input group (the outer box). */
  groupClassName?: string;
};

const SearchFilter = ({
  param,
  size,
  className,
  groupClassName,
  ...props
}: SearchFilterProps) => {
```
   - `<InputGroup size={size}>` → `<InputGroup size={size} className={groupClassName}>`
   - `className="w-[100px] sm:w-[200px] text-sm"` → `className={cn("w-[100px] sm:w-[200px] text-sm", className)}`
2. `Filter.tsx`, "Clear Filters" button (lines 118-126): add `className="max-md:size-10 max-md:px-0"` before `{...props}`. Change `rightIcon={<LuX />}` to `rightIcon={<LuX className="max-md:ml-0" />}`. Wrap the label: `<span className="max-md:sr-only"><Trans>Clear Filters</Trans></span>`.
3. `Filter.tsx`, "Filter" button (lines 144-156): change `className={"!border-dashed border-border"}` to `className="!border-dashed border-border max-md:size-10 max-md:px-0"`. Change `rightIcon={<LuListFilter />}` to `rightIcon={<LuListFilter className="max-md:ml-0" />}`. Wrap the label: `<span className="max-md:sr-only"><Trans>Filter</Trans></span>`.
4. `operations.tsx`: add `cn` to the `@carbon/react` import (lines 11-29). The file already imports `IconButton`, `Popover`, `PopoverContent` and `PopoverTrigger`.
5. Before `return (` (line 569), add:
```tsx
  const showStationChip =
    !!peopleStation &&
    !currentFilters.some((filter) => filter.startsWith("workCenterId:"));

  const renderStationChip = (className?: string) =>
    showStationChip && peopleStation ? (
      <HStack
        spacing={0}
        className={cn("rounded-md border border-border bg-card", className)}
      >
        {/* the <span> and <IconButton> from lines 592-607, unchanged */}
      </HStack>
    ) : null;

  const displayPopoverContent = (
    <PopoverContent className="w-56">
      {/* the <VStack>…</VStack> from lines 623-676, unchanged */}
    </PopoverContent>
  );
```
6. Replace the toolbar (lines 580-686) with:
```tsx
        <HStack className="px-4 py-2 justify-between bg-card border-b border-border max-md:gap-2">
          <HStack className="max-md:min-w-0 max-md:flex-1">
            <SearchFilter
              param="search"
              size="sm"
              placeholder={t`Search`}
              groupClassName="max-md:min-w-0 max-md:flex-1"
              className="max-md:w-full"
            />
            <Filter filters={filters} />
            {renderStationChip("max-md:hidden")}
          </HStack>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                leftIcon={<LuSettings2 />}
                variant="secondary"
                className="border-dashed border-border max-md:hidden"
              >
                <Trans>Display</Trans>
              </Button>
            </PopoverTrigger>
            {displayPopoverContent}
          </Popover>
        </HStack>
        {(showStationChip || currentFilters.length > 0) && (
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide scroll-fade-x border-b border-border bg-card px-4 py-1.5 md:hidden [&>*]:shrink-0">
            {renderStationChip()}
            {currentFilters.length > 0 && <ActiveFilters filters={filters} />}
          </div>
        )}
        {currentFilters.length > 0 && (
          <HStack className="px-4 py-1.5 justify-between bg-card border-b border-border w-full max-md:hidden">
            <HStack>
              <ActiveFilters filters={filters} />
            </HStack>
          </HStack>
        )}
```
7. Add the Display action to the app bar (from Task 7). Replace `<MesAppBar kind="root" title={<Trans>Schedule</Trans>} />` with:
```tsx
      <MesAppBar
        kind="root"
        title={<Trans>Schedule</Trans>}
        actions={
          <Popover>
            <PopoverTrigger asChild>
              <IconButton
                aria-label={t`Display`}
                variant="ghost"
                size="lg"
                icon={<LuSettings2 />}
              />
            </PopoverTrigger>
            {displayPopoverContent}
          </Popover>
        }
      />
```
8. The chip × buttons need no change. `Button` renders `<HitArea />` (`packages/react/src/Button.tsx:255`), a 44×44 tap target below 768px (`packages/react/src/Viewport.tsx:91-96`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check apps/mes/app/routes/x+/operations.tsx apps/mes/app/components/SearchFilter.tsx apps/mes/app/components/Filter/Filter.tsx
# Expected: "Checked 3 files" and no errors.
```

**Out of scope:** The filter logic, the saved filters, the station override action. The Maintenance toolbar keeps its layout; it only gets the icon-only Filter from step 3.

---
## Task 15: Assigned, Active and Recent toolbars

**Depends on:** 7
**Files:**
- Modify: `apps/mes/app/routes/x+/assigned.tsx` — toolbar actions (lines 262-353), app bar actions
- Modify: `apps/mes/app/routes/x+/active.tsx` — toolbar (line 84), grid (line 100)
- Modify: `apps/mes/app/routes/x+/recent.tsx` — toolbar (line 84), grid (line 100)
- Copy from (precedent): `apps/mes/app/routes/x+/operations.tsx` (Task 14 result)

**Steps:**
1. `assigned.tsx`: add `IconButton` to the `@carbon/react` import.
2. Before `return (` (line 238), move the `<PopoverContent className="w-56">…</PopoverContent>` (lines 274-336) into `const displayPopoverContent = (…);`. Put `{displayPopoverContent}` in its old place.
3. Change the actions wrapper (line 262) from `<div className="flex items-center gap-2">` to `<div className="flex items-center gap-2 max-md:hidden">`.
4. Replace the `MesAppBar` line from Task 7 with:
```tsx
      <MesAppBar
        kind="root"
        title={<Trans>Assigned</Trans>}
        desktopClassName="overflow-y-scroll scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent"
        actions={
          <>
            {view === "board" && (
              <Popover>
                <PopoverTrigger asChild>
                  <IconButton
                    aria-label={t`Display`}
                    variant="ghost"
                    size="lg"
                    icon={<LuSettings2 />}
                  />
                </PopoverTrigger>
                {displayPopoverContent}
              </Popover>
            )}
            <IconButton
              aria-label={view === "board" ? t`List view` : t`Board view`}
              variant="ghost"
              size="lg"
              icon={view === "board" ? <LuList /> : <LuKanban />}
              onClick={() => setView(view === "board" ? "list" : "board")}
            />
          </>
        }
      />
```
5. `active.tsx` and `recent.tsx`, line 84: `<div className="w-full p-4 h-[var(--header-height)]">` → `<div className="w-full p-4 h-[var(--header-height)] max-md:h-auto max-md:pb-0">`.
6. `active.tsx` and `recent.tsx`, line 100: `<div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,330px),1fr))] p-4 gap-4">` → add ` max-md:pt-3`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check apps/mes/app/routes/x+/assigned.tsx apps/mes/app/routes/x+/active.tsx apps/mes/app/routes/x+/recent.tsx
# Expected: "Checked 3 files" and no errors.
```

**Out of scope:** The search logic. A Filter on these pages (they have none today).

---
## Task 16: Board columns on phones

**Depends on:** 1
**Files:**
- Modify: `apps/mes/app/components/Kanban/components/ColumnCard.tsx` — lines 85, 105-107, 112, 162, 205
- Copy from (precedent): the same file (round-1 `max-md:w-[300px]` at line 85)

**Steps:**
1. Line 85: in the `cva` base string, change `max-md:w-[300px]` to `max-md:w-[300px] max-md:only:w-full`.
2. Lines 105-107: add a third argument to the `cn(…)` call, after the height ternary: `"max-md:h-auto"`. The column then grows with its cards and the page scrolls once, instead of the `calc(100dvh - …)` box.
3. Line 112: change `"p-4 w-full font-semibold …"` to `"p-4 max-md:py-2 w-full font-semibold …"`.
4. Line 162 (grip `IconButton`): `className="cursor-grab relative"` → `className="cursor-grab relative max-md:hidden"`.
5. Line 205: `<ScrollBar orientation="horizontal" forceMount className="h-5" />` → `<ScrollBar orientation="horizontal" forceMount className="h-5 max-md:hidden" />`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check apps/mes/app/components/Kanban/components/ColumnCard.tsx
# Expected: "Checked 1 file" and no errors.
```

**Out of scope:** Drag and drop. Desktop column width and height.

---
## Task 17: Operation context row scrolls with the content

**Depends on:** 9
**Files:**
- Modify: `apps/mes/app/components/JobOperation/JobOperation.tsx` — context row (lines 839-1128), separator (1129), Details pane (1131-1135)
- Copy from (precedent): the same file

**Steps:**
1. Cut the context row element. It starts with `<div className="[grid-area:context] flex shrink-0 flex-wrap …">` (line 839) and ends at its `</div>` before `<Separator className="[grid-area:sep]" />` (line 1128).
2. Paste it into a render function before `return (` (line 787). Change only its opening tag:
```tsx
  // The job, customer, status and due row. Phones on the Details tab render
  // it inside the scrolling pane, so it scrolls away with the content.
  const renderContextRow = (className: string) => (
    <div
      className={cn(
        "flex shrink-0 flex-wrap lg:flex-nowrap items-center justify-start px-4 lg:pl-6 py-2 min-h-[var(--header-height)] bg-card gap-x-2 gap-y-1 md:gap-x-4 w-full min-w-0",
        className
      )}
    >
      {/* the pasted children, unchanged */}
    </div>
  );
```
3. Where the row was, add:
```tsx
        {renderContextRow(
          cn("[grid-area:context]", tab === "details" && "max-md:hidden")
        )}
```
4. Change the separator to `<Separator className={cn("[grid-area:sep]", tab === "details" && "max-md:hidden")} />`.
5. In the Details `TabsContent`, after `<div className="w-full min-w-0">` (line 1135), add `{renderContextRow("md:hidden border-b border-border")}`.
6. Order the items on phones. In the second `HStack` of the row (the one with `overflow-x-auto … scroll-fade-x`), add these classes to the `className` of each item `HStack`:

| Item (find by its icon) | Add |
|---|---|
| status (`OperationStatusIcon`, and the batch `LuLayers` "Released/Completing" item) | `max-md:order-1` |
| due (`DeadlineIcon`, both the batch and the job item) | `max-md:order-2` |
| customer (`LuSquareUser`, both items) | `max-md:order-3` |
| description (`LuClipboardCheck`) | `max-md:order-4` |
| duration (`LuTimer`) | `max-md:order-5` |

7. The job ⋮ `IconButton` (`aria-label="More options"`) needs no change. `Button` renders `<HitArea />` (`packages/react/src/Button.tsx:255`), a 44×44 tap target below 768px.

**Verify:**
```bash
grep -c 'renderContextRow(' apps/mes/app/components/JobOperation/JobOperation.tsx
# Expected: 3 (1 definition, 2 calls).
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check apps/mes/app/components/JobOperation/JobOperation.tsx
# Expected: "Checked 1 file" and no errors.
```

**Out of scope:** The grid template at line 799. The Model, Instructions and Chat panes (the row stays in its grid area there).

---
## Task 18: Operation meters in 1 row and the grouped quantity card

**Depends on:** 17
**Files:**
- Modify: `packages/react/src/BarProgress.tsx` — new `stackOnPhone` prop
- Modify: `apps/mes/app/components/JobOperation/components/Controls.tsx` — `Times` padding (line 98)
- Modify: `apps/mes/app/components/JobOperation/JobOperation.tsx` — meter grid (line 3056), quantity cards (lines 1263-1357)
- Copy from (precedent): `packages/react/src/Card.tsx:103-140` (`CardAttributes` phone rows)

**Steps:**
1. `BarProgress.tsx`: add to the props type and the destructure:
```tsx
  /** Phones: label above the bar, value under it, value not truncated. */
  stackOnPhone?: boolean;
```
   Default it to `false` in the destructure.
2. In the header `div` (line 161), keep the class. Change the label span class to `cn("shrink-0 text-sm font-medium text-foreground", stackOnPhone && "max-md:min-w-0 max-md:truncate max-md:text-xs")`.
3. Change the value span class to `cn("min-w-0 truncate text-xs font-mono tabular-nums text-muted-foreground", stackOnPhone && "max-md:hidden")`.
4. After the bars `div` (the one with `role="progressbar"`), add:
```tsx
      {stackOnPhone && value ? (
        <span className="mt-1 hidden break-words text-xs font-mono tabular-nums text-muted-foreground max-md:block">
          {value}
        </span>
      ) : null}
```
5. `Controls.tsx` line 98: `"min-w-0 border-t bg-background/95 px-4 py-2.5 …"` → `"min-w-0 border-t bg-background/95 px-4 py-2.5 max-md:py-1.5 …"`.
6. `JobOperation.tsx`, meter grid (line 3056):
   - Before: `<div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:gap-x-6 sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">`
   - After: `<div className="grid gap-y-2 max-md:grid-flow-col max-md:auto-cols-[minmax(0,1fr)] max-md:gap-x-2 md:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] md:gap-x-6">`
7. Add `stackOnPhone` to both `BarProgress` elements in that grid (work-type meters and the quantity meter).
8. Change the comment above the grid (lines 3054-3055) to: `{/* Labelled meters: 1 row of up to 4 on a phone, then as many columns as fit. */}`.
9. Quantity cards: change `<div className="grid gap-4 grid-cols-2 xl:grid-cols-3 w-full min-w-0">` (line 1264) to `<div className="grid gap-4 grid-cols-2 xl:grid-cols-3 w-full min-w-0 max-md:hidden">`.
10. After that grid's closing `</div>` (line 1356), add the phone grouped card:
```tsx
                  <Card className="md:hidden">
                    <CardContent className="max-md:rounded-xl max-md:border-0 max-md:py-1">
                      <CardAttributes className="divide-y divide-border">
                        <CardAttribute>
                          <CardAttributeLabel>
                            <Trans>Completed</Trans>
                          </CardAttributeLabel>
                          <CardAttributeValue className="tabular-nums">
                            <Trans>
                              {operation.quantityComplete} of{" "}
                              {operation.targetQuantity}
                            </Trans>
                          </CardAttributeValue>
                        </CardAttribute>
                        <CardAttribute>
                          <CardAttributeLabel>
                            <Trans>Scrapped</Trans>
                          </CardAttributeLabel>
                          <CardAttributeValue className="tabular-nums">
                            {operation.quantityScrapped}
                          </CardAttributeValue>
                        </CardAttribute>
                        <CardAttribute>
                          <CardAttributeLabel>
                            <Trans>Due Date</Trans>
                          </CardAttributeLabel>
                          <CardAttributeValue className="flex flex-col items-end text-right">
                            {/* a copy of the Due Date card's <VStack> children (lines 1307-1352); the md+ card keeps its own */}
                          </CardAttributeValue>
                        </CardAttribute>
                      </CardAttributes>
                    </CardContent>
                  </Card>
```
11. Add `CardAttribute`, `CardAttributeLabel`, `CardAttributes`, `CardAttributeValue` to the `@carbon/react` import of `JobOperation.tsx`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/react --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check packages/react/src/BarProgress.tsx apps/mes/app/components/JobOperation/components/Controls.tsx apps/mes/app/components/JobOperation/JobOperation.tsx
# Expected: "Checked 3 files" and no errors.
```

**Out of scope:** Removing a meter. The desktop cards. Other `BarProgress` callers (the prop defaults to `false`).

---
## Task 19: Operation dock: open on the running timer and show its labels

**Depends on:** 18
**Files:**
- Modify: `apps/mes/app/components/JobOperation/hooks/useOperation.tsx` — `eventType` default (lines 93-101)
- Modify: `apps/mes/app/components/JobOperation/JobOperation.tsx` — dock row (line 2898), running label (2960-2980), icon buttons (2981-3012)
- Copy from (precedent): `apps/mes/app/components/JobOperation/hooks/useOperation.tsx:209-223` (which events count as running)

**Steps:**
1. `useOperation.tsx`, replace lines 93-101:
```tsx
  // Opens on the timer that runs, so Pause shows for it. A Setup or Labor
  // timer counts only when it is this user's; Machine counts for anyone
  // (the same rule as `activeEvents` below). Else: Setup, Machine, Labor.
  const [eventType, setEventType] = useState(() => {
    const isRunning = (type: string) =>
      events.some(
        (e) =>
          e.type === type &&
          e.endTime === null &&
          (type === "Machine" || e.employeeId === user.id)
      );
    const running = (["Setup", "Machine", "Labor"] as const).find(isRunning);
    if (running) {
      return running;
    }
    if (operation.setupDuration > 0) {
      return "Setup";
    }
    if (operation.machineDuration > 0) {
      return "Machine";
    }
    return "Labor";
  });
```
2. If TypeScript then reports a type mismatch on `setEventType`, give the state an explicit type: `useState<string>(() => …)`.
3. `JobOperation.tsx`, dock row (line 2898): `<div className="flex w-full min-w-0 items-center gap-2 lg:flex-col lg:py-2">` → `<div className="flex w-full min-w-0 items-center gap-2 lg:flex-col lg:py-2 max-lg:flex-wrap max-lg:gap-y-1">`.
4. Running label (lines 2960-2980). Replace the wrapper class and the elapsed span:
```tsx
              <div
                className={cn(
                  "flex flex-col items-center gap-0.5 text-center lg:group-data-[collapsed=true]/dock:hidden",
                  // Below lg: one centred line over the controls, while a timer runs.
                  "max-lg:order-first max-lg:basis-full max-lg:flex-row max-lg:justify-center max-lg:gap-1",
                  !runningType && "max-lg:hidden"
                )}
              >
                {runningType ? (
                  <>
                    {/* the existing emerald label span, unchanged */}
                    <span aria-hidden className="hidden text-xs text-muted-foreground max-lg:inline">
                      ·
                    </span>
                    <span className="font-mono text-lg tabular-nums max-lg:text-xs">
                      {formatDurationMilliseconds(progress[runningType], {
                        style: "short"
                      })}
                    </span>
                  </>
                ) : (
                  /* the existing "Start …" span, unchanged */
                )}
              </div>
```
5. Captions for + and ⋮ (lines 2981-3012). Wrap each `IconButtonWithTooltip` in a column with a caption:
```tsx
                <div className="flex flex-col items-center gap-0.5">
                  {/* the existing IconButtonWithTooltip for Log completed, unchanged */}
                  <span className="whitespace-nowrap text-xs text-muted-foreground lg:hidden">
                    {isBatched ? (
                      <Trans>Complete batch</Trans>
                    ) : (
                      <Trans>Log completed</Trans>
                    )}
                  </span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  {/* the existing IconButtonWithTooltip for More Actions, unchanged */}
                  <span className="whitespace-nowrap text-xs text-muted-foreground lg:hidden">
                    <Trans>More</Trans>
                  </span>
                </div>
```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check apps/mes/app/components/JobOperation/hooks/useOperation.tsx apps/mes/app/components/JobOperation/JobOperation.tsx
# Expected: "Checked 2 files" and no errors.
```

**Out of scope:** `StartStopButton`, `WorkTypeToggle` and the green Start / red Pause colours. The dock actions. The `exclusive` flag. The dock on Instructions and Chat (it stays hidden there).

---
## Task 20: Picking detail on phones

**Depends on:** 5
**Files:**
- Modify: `apps/mes/app/routes/x+/picking.$pickingListId.tsx` — header (163-178), main (180-194), `PickingListControls` (207-294), kit card (416-418), line item (583-631, 781-799)
- Copy from (precedent): `packages/react/src/Card.tsx:243-252` (sticky footer classes), `apps/mes/app/components/MesAppBar.tsx`

**Steps:**
1. Add `import { MesAppBar } from "~/components/MesAppBar";`.
2. Change the header open tag (line 163) to `<header className="sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center justify-between gap-2 border-b bg-card max-md:hidden">`. Change line 169 to `<div className="flex items-center gap-3 px-3">`.
3. Before that header, add:
```tsx
      <MesAppBar
        kind="pushed"
        title={pickingList.pickingListId}
        subtitle={<Trans>Picking</Trans>}
        back={{ to: path.to.picking }}
        desktop={null}
      />
```
4. In `<main …>` (line 180), add ` max-md:pb-28` to its class. As the first child of `<VStack spacing={4} className="w-full">` (line 182), add the status row:
```tsx
            <div className="flex items-center gap-2 md:hidden">
              <PickingListStatus status={pickingList.status} />
            </div>
```
5. After `</main>` (line 194), add the bottom bar:
```tsx
      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
        <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground tabular-nums">
          {completedCount}/{lines.length} <Trans>lines</Trans>
        </span>
        <PickingListControls
          pickingListId={pickingList.id}
          status={pickingList.status}
          size="lg"
          className="min-w-0 flex-1 [&_button]:w-full"
        />
      </div>
```
6. `PickingListControls`: add 2 optional props, `size?: "md" | "lg"` (default `"md"`) and `className?: string`. Pass `size={size}` to both buttons (lines 262, 273). Change `<HStack spacing={2}>` (line 259) to `<HStack spacing={2} className={className}>`.
7. Kit card wrapper (line 418): `<div className="border rounded-lg">` → `<div className="border rounded-lg max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:border-b-0">`.
8. Neutral open-quantity badge: in both badges (lines 590 and 605) change the `"bg-red-600"` branch to `"bg-red-600 max-md:bg-muted max-md:text-foreground"`.
9. Thumbnail and name (lines 624-631):
   - `<HStack spacing={4} className="min-w-0 flex-1">` → `<HStack spacing={4} className="min-w-0 flex-1 max-md:space-x-3">`
   - Wrap the `ItemThumbnail` in `<div className="shrink-0 max-md:[&>*]:size-11 max-md:[&_svg]:size-7">…</div>`.
   - `<p className="w-full truncate text-base font-medium">` → `<p className="w-full truncate text-base font-medium max-md:line-clamp-2 max-md:whitespace-normal">`
10. Pick and Short (lines 781-799): add ` max-md:h-12` to the `className` of both buttons.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check "apps/mes/app/routes/x+/picking.\$pickingListId.tsx"
# Expected: "Checked 1 file" and no errors.
```

**Out of scope:** The finish and short-pick logic, `IncompletePickAcknowledgeModal`, the tracked picker. The emerald (picked) and orange (short) colours.

---
## Task 21: Smaller fixes on Picking list, Jobs and Maintenance

**Depends on:** 7
**Files:**
- Modify: `apps/mes/app/routes/x+/picking._index.tsx` — rows at lines 84, 91, 100
- Modify: `apps/mes/app/routes/x+/jobs.tsx` — phone row (lines 246-263)
- Modify: `apps/mes/app/routes/x+/maintenance.tsx` — card (241-276), tabs (422-424)
- Copy from (precedent): `apps/mes/app/routes/x+/jobs.tsx:234-279` (phone rows)

**Steps:**
1. `picking._index.tsx`: in the 3 label/value rows, change `<HStack className="justify-between text-sm">` to `<HStack className="justify-between text-sm max-md:w-full">`.
2. `jobs.tsx` line 250: `<span className="text-sm text-muted-foreground tabular-nums">` → `<span className="text-sm text-foreground tabular-nums">`.
3. `jobs.tsx` lines 254-263, replace with one line:
```tsx
                        <div className="flex min-w-0 gap-1 text-sm">
                          <span className="shrink-0">
                            {job.itemReadableIdWithRevision ?? "—"}
                          </span>
                          {job.name && (
                            <span className="truncate text-muted-foreground">
                              · {job.name}
                            </span>
                          )}
                        </div>
```
4. `maintenance.tsx`: change `import { useMemo, useState } from "react";` to `import { useEffect, useMemo, useRef, useState } from "react";`.
5. In `MaintenanceRoute`, after `const [activeTab, setActiveTab] = useState("all");` (line 318), add:
```tsx
  // Phones: the tab row scrolls sideways; keep the active tab in view.
  const tabsListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabsListRef.current
      ?.querySelector<HTMLElement>('[data-state="active"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTab]);
```
6. `TabsList` (line 424): add `ref={tabsListRef}` and add ` max-md:scroll-fade-x` to its class.
7. `MaintenanceCard`, header right side (lines 253-255). Replace `{getPriorityIcon(…)}` with:
```tsx
            <HStack spacing={2}>
              <div className="hidden items-center gap-2 max-md:flex">
                <Badge
                  variant={getOeeImpactColor(dispatch.oeeImpact ?? "No Impact")}
                >
                  {dispatch.oeeImpact ?? t`No Impact`}
                </Badge>
                {dispatch.assignee && (
                  <EmployeeAvatar employeeId={dispatch.assignee} />
                )}
              </div>
              {getPriorityIcon(
                dispatch.priority as (typeof maintenanceDispatchPriority)[number]
              )}
            </HStack>
```
8. `MaintenanceCard`, `<CardContent>` (line 262) → `<CardContent className="max-md:hidden">`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check apps/mes/app/routes/x+/picking._index.tsx apps/mes/app/routes/x+/jobs.tsx apps/mes/app/routes/x+/maintenance.tsx
# Expected: "Checked 3 files" and no errors.
```

**Out of scope:** The desktop Jobs table. The Maintenance filters and tab content. The empty states (Task 26).

---
## Task 22: Inspection task screen on phones

**Depends on:** 10
**Files:**
- Modify: `apps/mes/app/components/Inspection/InspectionMeasurementMatrix.tsx` — scroller (542), Characteristic (546, 583-616), Gauge (553-557, 618-633)
- Modify: `apps/mes/app/components/Inspection/InspectionView.tsx` — meta bar (726-749), frame (868), bottom bar (after 888), `CompletePassedButton` (1110-1144), `TimerControl` (1362)
- Copy from (precedent): `apps/mes/app/components/JobOperation/components/Controls.tsx:62` (bottom bar safe-area padding)

**Steps:**
1. Matrix scroller (line 542): `<div className="min-h-0 flex-1 overflow-auto">` → `<div className="min-h-0 flex-1 overflow-auto max-md:scroll-fade-x">`.
2. Characteristic `th` (line 546): change `min-w-[220px]` to `min-w-[220px] max-md:w-[150px] max-md:min-w-[150px]`.
3. Characteristic `td` (line 583): change `"sticky left-0 z-10 cursor-pointer border-b border-r border-border bg-card px-3 py-2 align-top"` to `"sticky left-0 z-10 cursor-pointer border-b border-r border-border bg-card px-3 py-2 align-top max-md:px-2"`. Change `<div className="flex items-start gap-3">` (line 592) to `<div className="flex items-start gap-3 max-md:gap-2">`.
4. After the `n … · Ac … · Re …` line (line 614, inside the `flex min-w-0 flex-col gap-1` div), add the phone gauge picker:
```tsx
                      {hasFeatures ? (
                        // Phones: the gauge sits under the characteristic.
                        // The click must not toggle the active row.
                        <div
                          className="-mx-2 -mb-2 mt-1 hidden border-t border-border max-md:block"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <InspectionGaugePicker
                            gauges={gauges}
                            characteristicLabel={row.label}
                            recentGaugeIds={recentGauges}
                            gaugeTypeId={row.gaugeTypeId}
                            gaugeTypeName={row.gaugeTypeName}
                            value={gaugeFor(row.featureId)}
                            isReadOnly={isReadOnly}
                            onChange={(gaugeId) =>
                              persistGauge(row.featureId, gaugeId)
                            }
                          />
                        </div>
                      ) : null}
```
5. If Biome flags the wrapper `div` for a missing role, add `role="presentation"`.
6. Gauge `th` (line 554) and gauge `td` (line 619): add ` max-md:hidden` to each class.
7. `InspectionView.tsx` meta bar (line 726): `"flex h-9 shrink-0 items-center gap-3 overflow-x-auto bg-card border-b border-border px-5 scrollbar-hide"` → add ` max-md:px-4 max-md:scroll-fade-x`.
8. Meta bar spacer (line 743): `<div className="flex-1" />` → `<div className="flex-1 max-md:hidden" />`.
9. Meta bar counts span (line 744): add ` max-md:order-first` to its class.
10. Frame (line 868): `"flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card"` → add ` max-md:flex-initial`.
11. `TimerControl` (line 1362): `<span className="hidden flex-col items-end leading-none sm:flex">` → `<span className="flex flex-col items-end leading-none">`. From 640px up it shows today, so md+ does not change.
12. `CompletePassedButton`: add the prop `variant?: "header" | "bar"` (default `"header"`). When `variant === "bar"`, render:
```tsx
    <fetcher.Form
      method="post"
      action={path.to.inspectionCompletePassed(inspectionId)}
      className="flex min-w-[calc(50%-0.25rem)] flex-1"
    >
      <input type="hidden" name="operationId" value={operationId} />
      <EventIdInputs eventIds={eventIds} />
      <Button
        type="submit"
        size="lg"
        variant="secondary"
        isDisabled={busy}
        leftIcon={<LuCheckCheck />}
        className="h-12 w-full text-emerald-600 dark:text-emerald-400"
      >
        <Trans>Complete passed</Trans> {count}
      </Button>
    </fetcher.Form>
```
   Keep today's markup for `"header"`.
13. After the BODY block (after line 888, before `{/* ── MODALS ── */}`), add the bottom action bar:
```tsx
      {/* Phones: the lot actions as labelled 48px buttons in thumb reach. */}
      <div className="flex shrink-0 flex-wrap gap-2 border-t border-border bg-card px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden [&>*]:min-w-[calc(50%-0.25rem)] [&>*]:flex-1">
        {!lotClosed && completablePassed > 0 ? (
          <CompletePassedButton
            inspectionId={inspection.id}
            operationId={operationId}
            count={completablePassed}
            eventIds={eventIds}
            variant="bar"
          />
        ) : null}
        <Button
          size="lg"
          variant="secondary"
          leftIcon={<LuX />}
          isDisabled={!canReject}
          onClick={rejectDisclosure.onOpen}
          className="h-12 text-red-600 dark:text-red-400"
        >
          <Trans>Reject</Trans>
        </Button>
        {canPartial ? (
          <Button
            size="lg"
            variant="secondary"
            leftIcon={<LuContrast />}
            onClick={partialDisclosure.onOpen}
            className="h-12 text-amber-600 dark:text-amber-400"
          >
            <Trans>Partial</Trans>
          </Button>
        ) : null}
        <Button
          size="lg"
          leftIcon={<LuCheck />}
          isDisabled={!canAccept}
          onClick={acceptDisclosure.onOpen}
          className="h-12"
        >
          <Trans>Accept</Trans>
        </Button>
      </div>
```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check apps/mes/app/components/Inspection/InspectionView.tsx apps/mes/app/components/Inspection/InspectionMeasurementMatrix.tsx
# Expected: "Checked 2 files" and no errors.
```

**Out of scope:** A card-per-characteristic stepper. The drawing pane branch (`showDrawing`). The modals and the save logic of the matrix.

---
## Task 23: Operation materials as row cards on phones

**Depends on:** 19
**Files:**
- Modify: `apps/mes/app/components/JobOperation/JobOperation.tsx` — module helpers (after `PickedBreakdown`, line 298), materials block (lines 1686-2196)
- Copy from (precedent): the table cells in the same block (lines 1747-1986 and 2006-2184), `apps/mes/app/routes/x+/jobs.tsx:234-279` (phone rows)

**Steps:**
1. After the `PickedBreakdown` function (ends at line 298), add 2 module helpers. They repeat the Estimated and Actual cell logic of the table:
```tsx
type PickFields = {
  quantityPicked?: number | null;
  quantityToPick?: number | null;
  pickedByItem?: {
    itemId: string;
    itemReadableId: string;
    quantityPicked: number;
    quantityToPick: number;
  }[];
  hasExpiredConsumed?: boolean;
};

function materialEstimated(
  material: JobMaterial,
  parentIsSerial?: boolean | null
) {
  return parentIsSerial &&
    (material.requiresBatchTracking || material.requiresSerialTracking)
    ? `${material.quantity ?? material.estimatedQuantity}/${
        material.estimatedQuantity ?? material.quantity
      }`
    : (material.estimatedQuantity ?? material.quantity);
}

function materialActual(
  material: JobMaterial,
  parentIsSerial?: boolean | null
) {
  if (
    material.methodType === "Make to Order" &&
    material.requiresBatchTracking === false &&
    material.requiresSerialTracking === false
  ) {
    return (
      <MethodIcon type="Make to Order" isKit={material.kit ?? false} />
    );
  }
  return parentIsSerial &&
    (material.requiresBatchTracking || material.requiresSerialTracking)
    ? `${material.quantityIssued}/${
        material.quantity ?? material.estimatedQuantity
      }`
    : material.quantityIssued;
}
```
2. In the materials block, change `<div className="w-full overflow-hidden rounded-lg border bg-card">` (line 1688) to `<div className="w-full overflow-hidden rounded-lg border bg-card max-md:hidden">`.
3. Inside the `Await` callback, before `return (`, add a row renderer. It uses the variables of the table rows:
```tsx
                          const renderMaterialRow = (
                            material: JobMaterial,
                            isKitChild: boolean
                          ) => {
                            const fields = material as JobMaterial & PickFields;
                            const isRelatedToOperation =
                              material.jobOperationId === operationId;
                            const someRelatedMaterialIsIssued =
                              baseMaterials.some(
                                (m) =>
                                  m.itemReadableIdWithoutRevision ===
                                    material.itemReadableIdWithoutRevision &&
                                  ((m.quantityIssued ?? 0) > 0 ||
                                    (material.quantityIssued ?? 0) > 0)
                              );
                            const isTracked =
                              material.requiresBatchTracking ||
                              material.requiresSerialTracking;
                            const openIssue = () => {
                              flushSync(() => {
                                setSelectedMaterial(material);
                              });
                              issueModal.onOpen();
                            };
                            const batchTotal =
                              isBatched && material.itemId
                                ? batchMaterialTotals?.[material.itemId]
                                : undefined;
                            return (
                              <li
                                key={`material-row-${material.id}`}
                                className={cn(
                                  "flex items-center gap-3 px-3 py-3",
                                  isKitChild && "pl-8",
                                  !isRelatedToOperation && "opacity-50"
                                )}
                              >
                                <div className="flex min-w-0 flex-1 flex-col gap-1">
                                  <div className="flex items-baseline justify-between gap-2">
                                    <span className="truncate font-semibold">
                                      {getItemReadableId(
                                        items,
                                        material.itemId ?? ""
                                      )}
                                    </span>
                                    <span className="flex shrink-0 items-center gap-1 text-sm tabular-nums text-muted-foreground">
                                      {materialActual(material, parentIsSerial)}
                                      <span aria-hidden>/</span>
                                      {materialEstimated(material, parentIsSerial)}
                                    </span>
                                  </div>
                                  {material.description ? (
                                    <span className="truncate text-sm text-muted-foreground">
                                      {material.description}
                                    </span>
                                  ) : null}
                                  <div className="flex flex-wrap items-center gap-1">
                                    {material.requiresBatchTracking ? (
                                      <Badge variant="secondary">
                                        <TrackingTypeIcon type="Batch" className="shrink-0" />
                                      </Badge>
                                    ) : material.requiresSerialTracking ? (
                                      <Badge variant="secondary">
                                        <TrackingTypeIcon type="Serial" className="shrink-0" />
                                      </Badge>
                                    ) : null}
                                    {fields.hasExpiredConsumed && (
                                      <Badge variant="red" className="gap-1 shrink-0">
                                        <LuTriangleAlert className="size-3" />
                                        <Trans>Consumed expired</Trans>
                                      </Badge>
                                    )}
                                    <PickedBadge
                                      quantityPicked={fields.quantityPicked}
                                      quantityToPick={fields.quantityToPick}
                                    />
                                  </div>
                                  <PickedBreakdown
                                    materialItemId={material.itemId}
                                    pickedByItem={fields.pickedByItem}
                                  />
                                  {batchTotal ? (
                                    <span className="text-xs text-muted-foreground">
                                      <Trans>Batch</Trans>: {batchTotal.issued} /{" "}
                                      {batchTotal.required}
                                    </span>
                                  ) : null}
                                </div>
                                {material.methodType !== "Make to Order" &&
                                !isTracked ? (
                                  <IconButton
                                    aria-label={t`Issue Material`}
                                    variant="secondary"
                                    size="lg"
                                    icon={<LuGitBranchPlus />}
                                    onClick={openIssue}
                                  />
                                ) : isTracked && isKitChild ? (
                                  <IconButton
                                    aria-label={t`Issue Material`}
                                    variant="secondary"
                                    size="lg"
                                    icon={<LuQrCode />}
                                    onClick={openIssue}
                                  />
                                ) : isTracked ? (
                                  <Button
                                    size="lg"
                                    className="shrink-0"
                                    variant={
                                      someRelatedMaterialIsIssued ||
                                      !isRelatedToOperation
                                        ? "secondary"
                                        : "primary"
                                    }
                                    leftIcon={<LuQrCode />}
                                    onClick={openIssue}
                                  >
                                    <Trans>Issue</Trans>
                                  </Button>
                                ) : null}
                              </li>
                            );
                          };
```
4. After the table wrapper's closing `</div>` (line 2194), before `{renderIssueModal(resolvedMaterials)}`, add the phone list:
```tsx
                              <ul className="w-full divide-y divide-border rounded-lg border bg-card md:hidden">
                                {baseMaterials.length === 0 ? (
                                  <li className="py-8 text-center text-muted-foreground">
                                    <Trans>No materials</Trans>
                                  </li>
                                ) : (
                                  baseMaterials.flatMap((material) => [
                                    renderMaterialRow(material, false),
                                    ...(material.id
                                      ? (kitMaterialsByParentId[material.id] ?? [])
                                      : []
                                    ).map((child) =>
                                      renderMaterialRow(child, true)
                                    )
                                  ])
                                )}
                              </ul>
```
5. If `kitMaterialsByParentId` can be `undefined` for TypeScript, use `kitMaterialsByParentId?.[material.id]`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check apps/mes/app/components/JobOperation/JobOperation.tsx
# Expected: "Checked 1 file" and no errors.
```

**Out of scope:** The desktop table (lines 1689-2193 stay as they are). `IssueMaterialModal`. The batch materials view (`BatchOverview`). The "Source" column (it stays desktop only).

---
## Task 24: Job graph top to bottom on phones

**Depends on:** 1
**Files:**
- Modify: `apps/mes/app/components/JobDag/JobDag.tsx` — direction (157), toolbar (184-214), minimap (234-239)
- Copy from (precedent): `packages/react/src/Viewport.tsx:65-84` (`useViewport`)

**Steps:**
1. Add `useViewport` to the `@carbon/react` import (lines 5-12). Add `import { useLingui } from "@lingui/react/macro";`.
2. In `JobDagInner`, after line 157 (`const [direction, setDirection] = useState<LayoutDirection>("LR");`), add:
```tsx
  const { t } = useLingui();
  const { isPhone } = useViewport();
  // MES has no server viewport hint, so the first render is desktop.
  // Switch a phone to top-to-bottom once, after hydration. The toggle stays.
  useEffect(() => {
    if (isPhone) setDirection("TB");
  }, [isPhone]);
```
3. Both toolbar buttons (lines 192 and 207): change `"h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1.5"` to `"h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1.5 max-md:h-11 max-md:px-3"`.
4. Line 201: replace `{direction === "LR" ? "Left to Right" : "Top to Bottom"}` with the code below. Keep 2 separate `t` calls. A ternary inside one `t` keeps the English words (`.ai/lessons.md:2216`).
```tsx
          {direction === "LR" ? t`Left to Right` : t`Top to Bottom`}
```
5. Line 212: replace the text `Fit` with:
```tsx
          {t`Fit`}
```
6. Minimap (line 238): `className="!bg-card !border-border"` → `className="!bg-card !border-border max-md:!hidden"`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check apps/mes/app/components/JobDag/JobDag.tsx
# Expected: "Checked 1 file" and no errors.
```

**Out of scope:** The layout algorithm, node size, `DagLegend`. The canvas stays a canvas.

---
## Task 25: Maintenance dispatch: app bar, Complete button and confirmation

**Depends on:** 5
**Files:**
- Modify: `apps/mes/app/routes/x+/dispatch.$dispatchId.tsx` — header (258-276), work centre card (281-302), description (305-324), controls (327-404)
- Copy from (precedent): `apps/mes/app/routes/x+/timecard.tsx:489-534` (confirmation `Modal`)

**Steps:**
1. Add `Modal`, `ModalBody`, `ModalContent`, `ModalFooter`, `ModalHeader`, `ModalOverlay`, `ModalTitle` to the `@carbon/react` import. Change `import { useMemo } from "react";` to `import { useMemo, useState } from "react";`. Add `import { MesAppBar } from "~/components/MesAppBar";`.
2. Add a module helper after `formatDuration` (line 188):
```tsx
/** True when a rich-text document holds any visible text. */
function hasText(node: JSONContent | undefined | null): boolean {
  if (!node) return false;
  if (typeof node.text === "string" && node.text.trim().length > 0) {
    return true;
  }
  return (node.content ?? []).some(hasText);
}
```
3. In the component, after `const addPartModal = useDisclosure();` (line 215), add `const [confirmComplete, setConfirmComplete] = useState(false);`.
4. Header (line 258): add ` max-md:hidden` to the `<header>` class. Before it, add:
```tsx
      <MesAppBar
        kind="pushed"
        title={dispatch.maintenanceDispatchId}
        subtitle={<Trans>Maintenance</Trans>}
        back={{ to: path.to.maintenance }}
        desktop={null}
      />
```
5. As the first child of `<VStack spacing={4} className="max-w-2xl mx-auto">` (line 279), add the phone status row:
```tsx
          <div className="flex w-full items-center justify-between md:hidden">
            <MaintenanceStatus status={dispatch.status} />
            {getPriorityIcon(
              dispatch.priority as (typeof maintenanceDispatchPriority)[number]
            )}
          </div>
```
6. Work centre card: `<CardHeader>` (line 282) → `<CardHeader className="max-md:hidden">`. Before `<span className="text-lg font-semibold">` (line 289), add:
```tsx
                <span className="hidden text-xs text-muted-foreground max-md:block">
                  <Trans>Work Center</Trans>
                </span>
```
7. Description card (line 307): `<Card className="w-full">` → `<Card className={cn("w-full", !hasText(dispatch.content as JSONContent) && "max-md:hidden")}>`. Add `cn` to the `@carbon/react` import.
8. Controls row (line 338): `<HStack spacing={4} className="justify-center w-full">` → `<HStack spacing={4} className="justify-center w-full max-md:flex-col max-md:space-x-0 max-md:gap-3">`.
9. Replace the Complete `ValidatedForm` (lines 378-399) with a button that opens the confirmation:
```tsx
                    <button
                      type="button"
                      aria-label={t`Complete`}
                      disabled={fetcher.state !== "idle"}
                      onClick={() => setConfirmComplete(true)}
                      className="group size-24 flex flex-row items-center gap-2 justify-center bg-accent rounded-full shadow-lg hover:cursor-pointer hover:shadow-xl hover:scale-105 transition-all text-accent-foreground text-3xl disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-30 max-md:hidden"
                    >
                      <FaCheck className="group-hover:scale-110" />
                    </button>
                    <Button
                      size="lg"
                      variant="secondary"
                      leftIcon={<LuCheck />}
                      isDisabled={fetcher.state !== "idle"}
                      onClick={() => setConfirmComplete(true)}
                      className="hidden w-full max-md:flex"
                    >
                      <Trans>Complete</Trans>
                    </Button>
```
10. Before the final closing `</div>` of the component's return, add the confirmation:
```tsx
      {confirmComplete && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setConfirmComplete(false);
          }}
        >
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>
              <ModalTitle>{t`Complete ${dispatch.maintenanceDispatchId}?`}</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Trans>This marks the dispatch as completed.</Trans>
            </ModalBody>
            <ModalFooter>
              <Button
                variant="secondary"
                onClick={() => setConfirmComplete(false)}
              >
                <Trans>Cancel</Trans>
              </Button>
              <Button
                isLoading={fetcher.state !== "idle"}
                onClick={() => {
                  const formData = new FormData();
                  formData.append("action", "Complete");
                  formData.append("dispatchId", dispatch.id);
                  formData.append("eventId", myActiveEvent?.id ?? "");
                  fetcher.submit(formData, {
                    method: "post",
                    action: path.to.maintenanceEvent
                  });
                  setConfirmComplete(false);
                }}
              >
                <Trans>Complete</Trans>
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
```
11. The removed form sent the same 3 fields (`action`, `dispatchId`, `eventId`), which `maintenance-event.tsx:30-33` reads. If `eventValidator` or `ValidatedForm` become unused, keep them (the Start form still uses both).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check "apps/mes/app/routes/x+/dispatch.\$dispatchId.tsx"
# Expected: "Checked 1 file" and no errors.
```

**Out of scope:** The Start/Pause round button (it stays big and round). The time entries and spare parts cards. `maintenance-event.tsx`.

---
## Task 26: Empty states on phones

**Depends on:** 14, 15, 21
**Files:**
- Create: `apps/mes/app/components/MesEmptyState.tsx`
- Modify: `apps/mes/app/routes/x+/active.tsx` (lines 103-124), `operations.tsx` (697-718), `jobs.tsx` (281-302), `picking._index.tsx` (115-124), `maintenance.tsx` (`EmptyState`, lines 279-301, and its 4 default calls)
- Copy from (precedent): `apps/mes/app/routes/x+/active.tsx:116-123` (today's empty markup)

**Steps:**
1. Create `apps/mes/app/components/MesEmptyState.tsx`:
```tsx
import { cn } from "@carbon/react";
import type { ReactNode } from "react";
import { LuInbox, LuTriangleAlert } from "react-icons/lu";

type MesEmptyStateProps = {
  title: ReactNode;
  action?: ReactNode;
  /** The page's container classes (height, padding). */
  className?: string;
};

/**
 * An empty list. From md up: today's dark round icon and mono caption.
 * Phones: a muted icon tile and a 17px title. No new text (owner rule).
 */
export function MesEmptyState({
  title,
  action,
  className
}: MesEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 max-md:h-auto max-md:gap-2 max-md:px-6 max-md:py-12 max-md:text-center",
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-background max-md:rounded-xl max-md:bg-muted max-md:text-muted-foreground">
        <LuTriangleAlert className="h-6 w-6 max-md:hidden" />
        <LuInbox className="hidden h-6 w-6 max-md:block" />
      </div>
      <span className="text-xs font-mono font-light text-foreground uppercase max-md:mt-2 max-md:font-sans max-md:text-[17px] max-md:font-semibold max-md:normal-case">
        {title}
      </span>
      {action}
    </div>
  );
}
```
2. Add the license header: `pnpm --filter @carbon/checks license-headers -- "$PWD/apps/mes/app/components/MesEmptyState.tsx"`.
3. In each page below, import `MesEmptyState` from `~/components/MesEmptyState`. Replace each empty block with the call in the table. `className` keeps the page's old container classes, so md+ stays the same.

| Page | Old block | New call |
|---|---|---|
| `active.tsx` | search empty (103-114) | `<MesEmptyState className="flex-1 w-full h-[calc(100%-var(--header-height)*2)]" title={<Trans>No results exist</Trans>} action={<Button onClick={() => setSearchTerm("")}><Trans>Clear Search</Trans></Button>} />` |
| `active.tsx` | default (116-123) | `<MesEmptyState className="flex-1 w-full h-[calc(100%-var(--header-height)*2)]" title={<Trans>No active operations</Trans>} />` |
| `operations.tsx` | filter empty (698-708) | `<MesEmptyState className="w-full h-full" title={<Trans>No results</Trans>} action={<Button onClick={clearFilters}><Trans>Clear Filters</Trans></Button>} />` |
| `operations.tsx` | default (710-717) | `<MesEmptyState className="w-full h-full" title={<Trans>No work centers exist</Trans>} />` |
| `jobs.tsx` | search empty (282-292) | `<MesEmptyState className="py-16" title={<Trans>No results</Trans>} action={<Button onClick={() => setSearchTerm("")}><Trans>Clear Search</Trans></Button>} />` |
| `jobs.tsx` | default (294-301) | `<MesEmptyState className="py-16" title={<Trans>No open jobs</Trans>} />` |
| `picking._index.tsx` | default (116-123) | `<MesEmptyState className="flex-1 w-full h-[calc(100%-var(--header-height))]" title={<Trans>No picking lists assigned</Trans>} />` |

4. `maintenance.tsx`: change the local `EmptyState` to render `MesEmptyState`:
```tsx
function EmptyState({
  message,
  onClear
}: {
  message: string;
  onClear?: () => void;
}) {
  return (
    <MesEmptyState
      className="flex-1 w-full h-[calc(100dvh-var(--header-height)*2-40px)]"
      title={message}
      action={
        onClear ? (
          <Button onClick={onClear}>
            <Trans>Clear Search</Trans>
          </Button>
        ) : undefined
      }
    />
  );
}
```
5. Leave the 4 default `EmptyState` calls in `maintenance.tsx` as they are. Do not add any new string (owner rule: keep the existing strings).
6. Remove `LuTriangleAlert` from a page's `react-icons/lu` import when no other line uses it.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
pnpm exec biome check apps/mes/app/components/MesEmptyState.tsx apps/mes/app/routes/x+/active.tsx apps/mes/app/routes/x+/operations.tsx apps/mes/app/routes/x+/jobs.tsx apps/mes/app/routes/x+/picking._index.tsx apps/mes/app/routes/x+/maintenance.tsx
# Expected: "Checked 6 files" and no errors.
```

**Out of scope:** Recent and Assigned empty states (not in spec 3.5). Any title string: each keeps its existing text.

---
## Task 27: Extract strings, typecheck and Biome

**Depends on:** 1–26
**Files:**
- Modify: `packages/locale/locales/*/mes.po`, `packages/locale/locales/*/erp.po` (written by the extractor)

**Steps:**
1. Run `pnpm lingui:extract`.
2. Run `pnpm lingui:clean`. It strips the origin comments and the creation date, so the `.po` diff stays small.
3. Run the typecheck below. If it fails, fix the error in the file it names. Then run it again.
4. Run Biome on the files this plan touched (the `FILES` list below). If it reports formatting only, run the same command with `--write`.
5. Check the license headers of the 5 new files.

**Verify:**
```bash
grep -c '^msgid "More"$' packages/locale/locales/en/mes.po
# Expected: 1
pnpm exec turbo run typecheck --filter=mes --filter=erp --filter=@carbon/react
# Expected: the "Tasks:" summary line says "successful"; no "error TS" lines.
FILES="packages/react/src/TabBar.tsx packages/react/src/index.tsx packages/react/src/NavRail.tsx packages/react/src/BarProgress.tsx
apps/erp/app/components/Layout/Mobile/MobileTabBar.tsx apps/mes/app/root.tsx apps/mes/app/utils/origin.ts apps/mes/app/styles/tailwind.css
apps/mes/app/components/AppSidebar.tsx apps/mes/app/components/MesAppBar.tsx apps/mes/app/components/MesTabBar.tsx apps/mes/app/components/MesEmptyState.tsx
apps/mes/app/components/OperationsList.tsx apps/mes/app/components/SearchFilter.tsx apps/mes/app/components/Filter/Filter.tsx apps/mes/app/components/AssemblyView.tsx
apps/mes/app/components/Kanban/components/ItemCard.tsx apps/mes/app/components/Kanban/components/ColumnCard.tsx
apps/mes/app/components/JobDag/JobDag.tsx apps/mes/app/components/JobDag/JobOperationNode.tsx
apps/mes/app/components/JobOperation/JobOperation.tsx apps/mes/app/components/JobOperation/components/Controls.tsx apps/mes/app/components/JobOperation/hooks/useOperation.tsx
apps/mes/app/components/Inspection/InspectionView.tsx apps/mes/app/components/Inspection/InspectionMeasurementMatrix.tsx
apps/mes/app/routes/x+/_layout.tsx apps/mes/app/routes/x+/operations.tsx apps/mes/app/routes/x+/assigned.tsx apps/mes/app/routes/x+/active.tsx
apps/mes/app/routes/x+/recent.tsx apps/mes/app/routes/x+/jobs.tsx apps/mes/app/routes/x+/maintenance.tsx apps/mes/app/routes/x+/picking._index.tsx
apps/mes/app/routes/x+/picking.\$pickingListId.tsx apps/mes/app/routes/x+/timecard.tsx apps/mes/app/routes/x+/job.\$jobId.tsx
apps/mes/app/routes/x+/dispatch.\$dispatchId.tsx apps/mes/app/routes/x+/batch.\$batchId.tsx"
pnpm exec biome check $FILES
# Expected: no errors.
head -1 packages/react/src/TabBar.tsx apps/mes/app/utils/origin.ts apps/mes/app/components/MesAppBar.tsx apps/mes/app/components/MesTabBar.tsx apps/mes/app/components/MesEmptyState.tsx
# Expected: each file's first line is // SPDX-License-Identifier: AGPL-3.0-only
```

**Out of scope:** `pnpm translate` (the owner runs it). A whole-repo `pnpm typecheck` (it runs out of memory).

---
## Task 28: Verify in the browser at 393×852 and 1280×800

**Depends on:** 27
**Files:**
- Create: `${TMPDIR:-/tmp}/mes-round2/after/*.png` (scratch)
- Copy from (precedent): `.claude/skills/auth/SKILL.md`, Task 1

**Steps:**
1. 🛑 Use one `agent-browser` session for the whole task. Close it at the end. If you pass 40 screenshots, close the session and log in again.
2. Run `mkdir -p "${TMPDIR:-/tmp}/mes-round2/after"`. Read `MES_URL` and `ERP_URL` from `.env.local` and the URLs from `${TMPDIR:-/tmp}/mes-round2/urls.txt`.
3. Log in with `.claude/skills/auth/SKILL.md` steps 2 to 4.
4. Run `agent-browser set viewport 393 852 1`.
5. On each screen below, do 3 things: wait 3 seconds, take `agent-browser screenshot "${TMPDIR:-/tmp}/mes-round2/after/<name>.png"`, and run `agent-browser eval 'document.documentElement.scrollWidth'`. The result must be `393` (AC 15).
6. Check each acceptance criterion. Record PASS or FAIL with the evidence (an eval result or a screenshot name):

| AC | Screen and check |
|---|---|
| 1 | On `/x/operations`, `/x/assigned`, `/x/active`, `/x/recent`, `/x/jobs`, `/x/maintenance`, `/x/picking`, `/x/timecard`: `agent-browser eval 'document.querySelectorAll("[data-mes-tab-bar] a, [data-mes-tab-bar] button").length'` is `5`. Tap Active: `location.pathname` is `/x/active` and the Active link has `aria-current="page"`. |
| 2 | The Maintenance tab badge shows the same number as the Maintenance row in the Navigation sheet. The Schedule tab shows no badge. |
| 3 | Tap More. The sheet lists Schedule, Assigned, Active, Recent, Jobs, Maintenance, Picking, Add Inventory, Remove Inventory, End Operations, Suggestion, Displays, in that order (`agent-browser snapshot -i`). The user row's `getBoundingClientRect().bottom` is ≤ 852. |
| 4 | On Operation, Assembly (open one if Schedule has one), Inspection, Job detail, Dispatch detail and Picking detail: `document.querySelector("[data-mes-tab-bar]")` is `null`. The `[aria-label="Back"]` element is 44×44 and its `left` is ≤ 8. |
| 5 | From `/x/active`, open an operation, tap Back: `location.pathname` is `/x/active`. Repeat at 1280×800: the header button reads "Active" and returns to `/x/active`. |
| 6 | `/x/timecard` shows the app bar, the tab bar and a full-width Clock In (or Clock Out) button above the tab bar. If the week has no entries, the whole "No time entries for this week" text is on screen. |
| 7 | On Schedule, filter to 1 work center. The column `getBoundingClientRect().width` is 393 (± 2). At least 2 cards end above y = 852 − 54. |
| 8 | On `OPERATION_URL`: if no Machine timer runs, choose Machine and tap Start, then reload. The toggle shows Machine selected, the round button is red Pause, and the dock text contains "Machine ·". Tap Pause afterwards. |
| 9 | On the Details tab: `document.querySelector('[role="tabpanel"][data-state="active"]').getBoundingClientRect().height / innerHeight` is ≥ 0.65. Scroll the pane: the job/status row moves up out of view. |
| 10 | On the Details tab, every Issue control in the phone material list is ≥ 44×44 and has `right` ≤ 393. |
| 11 | On `INSPECTION_URL` (skip if `none`): the first sample cell's `right` is ≤ 393 without a sideways scroll. Accept shows as a labelled button at the bottom. |
| 12 | On `PICKING_URL` with the list In Progress: Finish is a full-width button at the bottom. |
| 13 | On a dispatch: tap Complete. A dialog opens that names the dispatch. Tap Cancel: the dialog closes and the status is unchanged. |
| 14 | On a Job detail: the graph runs top to bottom and `.react-flow__minimap` is not visible. |
| 15 | Every screen in this table: `scrollWidth` is `393`. |
| 16 | Run `agent-browser set viewport 1280 800 1`. Screenshot Schedule, Assigned, Jobs, `OPERATION_URL`, `PICKING_URL`, `INSPECTION_URL` as `desktop-*.png`. Compare each with the same name in `before/` (`agent-browser diff screenshot --baseline "${TMPDIR:-/tmp}/mes-round2/before/desktop-<name>.png"`). Allowed differences: the titles "Assigned" and "Jobs", the Back label, live timer values. |
| 17 | Run `agent-browser set viewport 393 852 1`. Open `${ERP_URL}/x`. Compare with `before/erp-tabbar-393.png`. The tab bar must look the same. |
| 18 | Task 27 passed. |
| 19 | Not part of this plan. Keep the `after/` screenshots for the round-2 review. |

7. Run `agent-browser close`.
8. Write a short report: one line per AC with PASS or FAIL, and the screenshot folder path. If an AC fails, name the screen and the measured value. Do not change the shell scroll model to fix one.

**Verify:**
```bash
ls "${TMPDIR:-/tmp}/mes-round2/after" | wc -l
# Expected: at least 20 files.
agent-browser close 2>&1 | tail -1
# Expected: the session is already closed, or it closes now.
```

**Out of scope:** Any git commit. Any source change (report failures instead). A second browser session.
