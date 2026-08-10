import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuArrowLeft, LuChevronRight, LuInfo } from "react-icons/lu";
import { INITIAL_NAV, type NavState, navigate, rowsAt } from "./menuNav";
import type { VariableMenuItem, VariableTreeNode } from "./variableMenu";

const ITEM_HEIGHT = 44;
const MAX_VISIBLE_ITEMS = 6;

export type VariableTreeMenuProps = {
  tree: VariableTreeNode[];
  /** The flat search index — `variableMenuItems()` output, unfiltered. */
  flat: VariableMenuItem[];
  query: string;
  onSelect: (item: VariableMenuItem) => void;
  /** Popover host only: Backspace on an empty query pops a level. */
  backspacePops?: boolean;
  /** Shown instead of the generic empty text when the tree is empty because the
   * field only accepts one type. */
  emptyReason?: string;
};

/** One level of the variable tree at a time, with search that cuts across every level.
 * Every key is decided by `menuNav.ts`, so both hosts behave identically. */
export function VariableTreeMenu({
  tree,
  flat,
  query,
  onSelect,
  backspacePops,
  emptyReason
}: VariableTreeMenuProps) {
  const { t } = useLingui();
  const [nav, setNav] = useState<NavState>(INITIAL_NAV);
  const rootRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;

  // Search abandons the tree: matches come from every level, each row keeping the full
  // `Step › output › property` label so the source is still obvious.
  const searchRows = useMemo<VariableTreeNode[]>(
    () =>
      searching
        ? flat
            .filter((i) => i.label.toLowerCase().includes(needle))
            .map((i) => ({
              key: i.id,
              label: i.label,
              helper: i.helper,
              item: i
            }))
        : [],
    [searching, needle, flat]
  );

  // `nav.path` survives a search so clearing the query returns to the open level.
  const activeTree = searching ? searchRows : tree;
  const rows = searching ? searchRows : rowsAt(tree, nav.path);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the highlight, not the level
  useEffect(() => setNav((n) => ({ ...n, index: 0 })), [needle]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 5
  });

  useEffect(() => {
    virtualizer.scrollToIndex(nav.index, { align: "auto" });
  }, [nav.index, virtualizer]);

  const apply = (key: string) => {
    const result = navigate(key, nav, activeTree, {
      backspacePops: backspacePops ?? false,
      queryEmpty: !searching
    });
    if (!result.handled) return false;
    if ("select" in result) {
      onSelect(result.select);
      return true;
    }
    if ("state" in result) setNav(result.state);
    return true;
  };

  // Keys come straight off the document in the capture phase, never handed over by the
  // host: focus stays in the field so search-as-you-type keeps working, but the field
  // never gets to treat an arrow as caret movement.
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape belongs to the host: it is what dismisses the popup around us.
      if (event.key === "Escape") return;
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // The editor's popup is hidden on dismissal, not unmounted — a menu nobody can see
      // must not go on eating arrow keys.
      const root = rootRef.current;
      if (!root?.isConnected || root.getClientRects().length === 0) return;
      if (getComputedStyle(root).visibility === "hidden") return;
      if (!applyRef.current(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const breadcrumb = useMemo(() => {
    const parts: string[] = [];
    let level = tree;
    for (const key of nav.path) {
      const node = level.find((r) => r.key === key);
      if (!node) break;
      parts.push(node.label);
      level = node.children ?? [];
    }
    return parts.join(" › ");
  }, [tree, nav.path]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={rootRef}
      className="min-w-[280px] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
    >
      {!searching && nav.path.length > 0 && (
        <button
          type="button"
          className="flex w-full items-center gap-1.5 border-b border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => apply("ArrowLeft")}
        >
          <LuArrowLeft className="h-3 w-3 shrink-0" />
          <span className="truncate">{breadcrumb}</span>
        </button>
      )}

      {rows.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          {searching
            ? t`No variable matches ${query}`
            : (emptyReason ?? t`No variables available`)}
        </div>
      ) : (
        <div
          ref={parentRef}
          className="overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
          style={{
            height: `${Math.min(rows.length, MAX_VISIBLE_ITEMS) * ITEM_HEIGHT}px`
          }}
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          <div
            role="listbox"
            aria-label={t`Variables`}
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative"
            }}
          >
            {virtualItems.map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              const drillable = Boolean(row.children?.length);
              const usable = Boolean(row.item) || drillable;
              const selected = virtualRow.index === nav.index;

              return (
                <button
                  // The node key, never the array index — rows re-order on every keystroke.
                  key={row.key}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={!usable}
                  className={cn(
                    "absolute left-0 top-0 flex w-full items-center gap-2 px-3 text-left text-sm",
                    // Reads as the focused row even though focus stays in the field.
                    selected &&
                      "bg-accent text-accent-foreground ring-2 ring-inset ring-ring",
                    !usable && "opacity-50"
                  )}
                  style={{
                    height: `${ITEM_HEIGHT}px`,
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                  // Click and Enter go through the same reducer so they cannot diverge.
                  onClick={() => {
                    setNav((n) => ({ ...n, index: virtualRow.index }));
                    const result = navigate(
                      "Enter",
                      { ...nav, index: virtualRow.index },
                      activeTree,
                      {
                        backspacePops: backspacePops ?? false,
                        queryEmpty: !searching
                      }
                    );
                    if (!result.handled) return;
                    if ("select" in result) onSelect(result.select);
                    else if ("state" in result) setNav(result.state);
                  }}
                  onMouseEnter={() =>
                    setNav((n) => ({ ...n, index: virtualRow.index }))
                  }
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1 leading-tight">
                      <span className="truncate">{row.label}</span>
                      {row.description && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            {/* span — not the SVG — so Radix can attach its ref and
                                pointer handlers (react-icons SVGs don't forward refs).
                                tabIndex={-1} keeps it out of tab order inside the listbox.
                                preventDefault on mousedown stops the icon click from
                                blurring the search field. stopPropagation keeps it from
                                triggering the row button's own select handler. */}
                            <span
                              tabIndex={-1}
                              className="inline-flex shrink-0 cursor-default text-muted-foreground"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <LuInfo className="h-3 w-3" />
                            </span>
                          </TooltipTrigger>
                          {/* elevated — this menu is itself a popover, so the
                              default tooltip layer would paint underneath it. */}
                          <TooltipContent
                            elevated
                            className="max-w-xs whitespace-pre-wrap"
                          >
                            {row.description}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </span>
                    {row.helper && (
                      <span className="truncate text-xs leading-tight text-muted-foreground">
                        {row.helper}
                      </span>
                    )}
                  </span>
                  {drillable && (
                    <LuChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
