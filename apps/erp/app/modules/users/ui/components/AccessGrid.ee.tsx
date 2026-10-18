// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { TermId } from "@carbon/content/glossary";
import {
  LEVELS,
  type Level,
  moduleOf,
  PAGES,
  type Page
} from "@carbon/database/access";
import {
  cn,
  IconButton,
  LabelWithHelp,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  useViewport
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuChevronRight, LuUndo2 } from "react-icons/lu";
import { capitalize } from "~/utils/string";

/** One grant as the grid edits it. `module` is the `module` enum value. */
export type AccessGrant = { module: string; page: string | null; level: Level };

type AccessGridProps = {
  pages?: readonly Page[];
  value: AccessGrant[];
  /** Per module or page id, what the row resolves to with no grant here: a
   *  person's role. Missing is None. */
  inherited?: Record<string, Level>;
  /** What clearing a row returns to: "Inherit", or "Role default" on a person. */
  inheritLabel?: string;
  /** Rows without a grant follow `inherited`. Off where it differs per row
   *  owner, as in a bulk edit: there a row without a grant is "no change". */
  showInherited?: boolean;
  onChange: (grants: AccessGrant[]) => void;
  /** Where inherited levels come from, such as the person's role: shown in a
   *  "From" column. */
  inheritsFrom?: string;
  /** A note per module or page id, such as access that grew in the conversion. */
  notes?: Record<string, string>;
  label?: string;
  termId?: TermId;
  isDisabled?: boolean;
};

/** The bar's segments; segment N is the level LEVELS[N]. */
const SEGMENTS = [1, 2, 3, 4] as const;

const index = (level: Level) => LEVELS.indexOf(level);

const lower = (a: Level, b: Level) => (index(a) <= index(b) ? a : b);

/** Clicking segment N sets level N; clicking the top filled segment steps down. */
const target = (current: number, segment: number) =>
  segment === current ? segment - 1 : segment;

/** A row of the grid: a module (`page` null) or one of its pages. */
type Row = { page: string | null; label: string; max: Level };

const AccessGrid = ({
  pages = PAGES,
  value,
  inherited = {},
  inheritLabel,
  showInherited = true,
  inheritsFrom,
  notes = {},
  onChange,
  label,
  termId,
  isDisabled
}: AccessGridProps) => {
  const { t } = useLingui();
  const { isPhone } = useViewport();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The row and segment under the pointer: the bar previews the click.
  const [hover, setHover] = useState<{ key: string; segment: number } | null>(
    null
  );

  const segmentLabel: Record<(typeof SEGMENTS)[number], string> = {
    1: t`View`,
    2: t`Create`,
    3: t`Update`,
    4: t`Delete`
  };

  const modules = [...new Set(pages.map((page) => moduleOf(page.id)))].map(
    (id) => {
      const page = pages.find((p) => p.id === id);
      return {
        id,
        enumValue: capitalize(id),
        row: {
          page: null,
          label: page?.label ?? capitalize(id),
          max: page?.maxLevel ?? "Full"
        } satisfies Row,
        pages: pages
          .filter((p) => p.id !== id && moduleOf(p.id) === id)
          .map((p) => ({ page: p.id, label: p.label, max: p.maxLevel }))
      };
    }
  );
  type Module = (typeof modules)[number];

  const grantFor = (module: string, page: string | null) =>
    value.find((g) => g.module === module && g.page === page);

  /** What a row shows with no grant of its own. */
  const fallback = (module: Module, row: Row): Level => {
    if (!showInherited) return "None";
    if (row.page === null) return inherited[module.id] ?? "None";
    return (
      grantFor(module.enumValue, null)?.level ??
      inherited[row.page] ??
      inherited[module.id] ??
      "None"
    );
  };

  const effective = (module: Module, row: Row): Level =>
    lower(
      grantFor(module.enumValue, row.page)?.level ?? fallback(module, row),
      row.max
    );

  const without = (module: string, page: string | null) =>
    value.filter((g) => g.module !== module || g.page !== page);

  const setLevel = (module: Module, row: Row, level: Level) => {
    const rest = without(module.enumValue, row.page);
    // A level equal to what the row inherits needs no grant of its own.
    onChange(
      showInherited && level === fallback(module, row)
        ? rest
        : [...rest, { module: module.enumValue, page: row.page, level }]
    );
  };

  const toggleExpanded = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Only a person's rows inherit: a role or a key row simply clears.
  const inherits = showInherited && inheritsFrom !== undefined;
  // A row can go back to something only on a person (the type) or in a bulk
  // edit (no change); a role or a key row just steps down.
  const resettable = inherits || !showInherited;
  const resetLabel = inheritLabel ?? (inherits ? t`Inherit` : t`Clear`);

  const bar = (module: Module, row: Row) => {
    const key = `${module.id}:${row.page ?? ""}`;
    const own = grantFor(module.enumValue, row.page);
    const level = index(effective(module, row));
    const max = index(row.max);
    const preview =
      hover?.key === key ? target(level, hover.segment) : undefined;
    // In a bulk edit a row with no grant is "no change", not None.
    const unset = !own && !showInherited;
    return (
      <>
        {SEGMENTS.map((segment) => {
          const filled = segment <= level;
          const willFill = preview !== undefined && segment <= preview;
          const capped = segment > max;
          const blocked = isDisabled || capped;
          return (
            <Td key={segment} className="px-0.5 py-1">
              {/* The button is the click target; the bar inside is the meter. */}
              <button
                type="button"
                aria-label={`${row.label}: ${segmentLabel[segment]}`}
                aria-pressed={filled}
                disabled={blocked}
                onClick={() =>
                  setLevel(module, row, LEVELS[target(level, segment)]!)
                }
                onPointerEnter={() => setHover({ key, segment })}
                onPointerLeave={() => setHover(null)}
                className={cn(
                  "group flex h-8 w-full items-center rounded-md px-1",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  blocked ? "cursor-not-allowed" : "cursor-pointer"
                )}
              >
                <span
                  className={cn(
                    "block h-2 w-full rounded-full transition-[background-color,opacity,transform] duration-100 ease-out motion-reduce:transition-none",
                    // What is stored: solid for the row's own grant, light when inherited.
                    filled
                      ? own || !showInherited
                        ? "bg-primary"
                        : "bg-primary/40"
                      : unset
                        ? "border border-dashed border-muted-foreground/50"
                        : "bg-foreground/10",
                    // What a click would store.
                    preview !== undefined &&
                      (willFill
                        ? !filled && "bg-primary/30"
                        : filled && "opacity-40"),
                    capped && "opacity-30",
                    !blocked && "group-active:scale-y-150"
                  )}
                />
              </button>
            </Td>
          );
        })}
        {inherits ? (
          <Td className="truncate text-xs text-muted-foreground">
            {own ? (
              <span className="font-medium text-foreground">
                <Trans>Override</Trans>
              </span>
            ) : level > 0 ? (
              inheritsFrom
            ) : (
              "—"
            )}
          </Td>
        ) : null}
        <Td className="px-1 text-center">
          {own && resettable ? (
            <IconButton
              aria-label={resetLabel}
              title={resetLabel}
              icon={<LuUndo2 />}
              variant="ghost"
              size="sm"
              isDisabled={isDisabled}
              onClick={() => onChange(without(module.enumValue, row.page))}
            />
          ) : null}
        </Td>
      </>
    );
  };

  /** A small amber mark beside a row's name, with its note on hover. */
  const note = (id: string) =>
    notes[id] ? (
      <Tooltip>
        <TooltipTrigger>
          <span
            role="img"
            aria-label={notes[id]}
            className="ml-2 inline-block size-1.5 rounded-full bg-amber-500 align-middle"
          />
        </TooltipTrigger>
        <TooltipContent>{notes[id]}</TooltipContent>
      </Tooltip>
    ) : null;

  const sticky =
    "max-md:sticky max-md:left-0 max-md:z-10 max-md:bg-card text-left";

  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium leading-none mb-1">
          <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
        </label>
      )}
      {/* A key to the bar, where a row can be in more than one state. */}
      {resettable ? (
        <div className="mb-2 flex flex-wrap justify-end gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-4 rounded-full bg-primary" />
            {inherits ? <Trans>Override</Trans> : <Trans>Granted</Trans>}
          </span>
          {inherits ? (
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-4 rounded-full bg-primary/40" />
              {inheritsFrom}
            </span>
          ) : null}
          {!showInherited ? (
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-4 rounded-full border border-dashed border-muted-foreground/50" />
              <Trans>No change</Trans>
            </span>
          ) : null}
        </div>
      ) : null}
      {/* Compact: this div scrolls sideways and the module column stays pinned. */}
      <div className="rounded-lg border overflow-hidden max-md:overflow-x-auto max-md:scroll-fade-x">
        <Table full={isPhone} className="table-fixed">
          <Thead>
            <Tr>
              <Th
                className={cn(
                  sticky,
                  "w-[180px] md:w-auto text-xs font-medium uppercase tracking-wide"
                )}
              >
                <Trans>Module</Trans>
              </Th>
              {SEGMENTS.map((segment) => (
                <Th
                  key={segment}
                  className="w-[76px] px-0.5 text-center text-xs font-medium uppercase tracking-wide"
                >
                  {segmentLabel[segment]}
                </Th>
              ))}
              {inherits ? (
                <Th className="w-[120px] text-xs font-medium uppercase tracking-wide">
                  <Trans>From</Trans>
                </Th>
              ) : null}
              <Th className="w-[44px]" />
            </Tr>
          </Thead>
          <Tbody>
            {modules.map((module) => {
              const isOpen = expanded.has(module.id);
              const granted = module.pages.filter(
                (row) => effective(module, row) !== "None"
              ).length;
              return [
                <Tr key={module.id}>
                  <Td className={sticky}>
                    {module.pages.length > 0 ? (
                      <button
                        type="button"
                        className="flex items-center gap-2"
                        aria-expanded={isOpen}
                        onClick={() => toggleExpanded(module.id)}
                      >
                        <LuChevronRight
                          className={cn(
                            "size-4 text-muted-foreground transition-transform duration-150 ease-out motion-reduce:transition-none",
                            isOpen && "rotate-90"
                          )}
                        />
                        <span className="text-sm font-medium">
                          {module.row.label}
                          {note(module.id)}
                        </span>
                        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
                          {t`${granted}/${module.pages.length} pages`}
                        </span>
                      </button>
                    ) : (
                      <span className="text-sm font-medium">
                        {module.row.label}
                        {note(module.id)}
                      </span>
                    )}
                  </Td>
                  {bar(module, module.row)}
                </Tr>,
                ...(isOpen
                  ? module.pages.map((row) => (
                      <Tr key={row.page}>
                        <Td
                          className={cn(
                            sticky,
                            "pl-12 text-sm text-muted-foreground"
                          )}
                        >
                          {row.label}
                          {note(row.page)}
                        </Td>
                        {bar(module, row)}
                      </Tr>
                    ))
                  : [])
              ];
            })}
          </Tbody>
        </Table>
      </div>
    </div>
  );
};

export default AccessGrid;
