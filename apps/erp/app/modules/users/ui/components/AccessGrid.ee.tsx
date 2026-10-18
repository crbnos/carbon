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
import { type KeyboardEvent, useState } from "react";
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
  /** Where inherited levels come from, such as the person's role: shown in a
   *  "From" column. */
  inheritsFrom?: string;
  /** A note per module or page id, such as access that grew in the conversion. */
  notes?: Record<string, string>;
  /** The most a column header may set on a module: an API key's "set all"
   *  never gives Full on Accounting. */
  columnCaps?: Record<string, Level>;
  onChange: (grants: AccessGrant[]) => void;
  label?: string;
  termId?: TermId;
  isDisabled?: boolean;
};

/** The bar's steps; step N is the level LEVELS[N]. */
const STEPS = [1, 2, 3, 4] as const;

const index = (level: Level) => LEVELS.indexOf(level);

const lower = (a: Level, b: Level) => (index(a) <= index(b) ? a : b);

/** Clicking step N sets level N; clicking the top filled step steps down. */
const target = (current: number, step: number) =>
  step === current ? step - 1 : step;

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
  columnCaps = {},
  onChange,
  label,
  termId,
  isDisabled
}: AccessGridProps) => {
  const { t } = useLingui();
  const { isPhone } = useViewport();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The row and step under the pointer: the bar previews the click.
  const [hover, setHover] = useState<{ key: string; step: number } | null>(
    null
  );

  const stepLabel: Record<(typeof STEPS)[number], string> = {
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

  const without = (
    grants: AccessGrant[],
    module: string,
    page: string | null
  ) => grants.filter((g) => g.module !== module || g.page !== page);

  /** `grants` with one row set; a level equal to what it inherits needs no grant. */
  const withLevel = (
    grants: AccessGrant[],
    module: Module,
    row: Row,
    level: Level
  ) => {
    const rest = without(grants, module.enumValue, row.page);
    return showInherited && level === fallback(module, row)
      ? rest
      : [...rest, { module: module.enumValue, page: row.page, level }];
  };

  const setLevel = (module: Module, row: Row, level: Level) =>
    onChange(withLevel(value, module, row, level));

  // Only a person's rows inherit: a role or a key row simply clears.
  const inherits = showInherited && inheritsFrom !== undefined;
  // A row can go back to something only on a person (the type) or in a bulk
  // edit (no change); a role or a key row just steps down.
  const resettable = inherits || !showInherited;
  const resetLabel = inheritLabel ?? (inherits ? t`Inherit` : t`Clear`);

  /** A column header sets every module to that level, or clears them all
   *  when they already hold it. Not on a person: there it would override all. */
  const setColumn = (step: number) => {
    const all = modules.every(
      (module) => index(effective(module, module.row)) === step
    );
    let grants = value;
    for (const module of modules) {
      const cap = Math.min(
        index(module.row.max),
        index(columnCaps[module.id] ?? "Full")
      );
      const level = LEVELS[Math.min(all ? 0 : step, cap)]!;
      grants = withLevel(grants, module, module.row, level);
    }
    onChange(grants);
  };

  const toggleExpanded = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Arrow keys move the level; Home and End go to none and the most allowed. */
  const onKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    module: Module,
    row: Row
  ) => {
    const level = index(effective(module, row));
    const max = index(row.max);
    const next = {
      ArrowRight: Math.min(level + 1, max),
      ArrowUp: Math.min(level + 1, max),
      ArrowLeft: Math.max(level - 1, 0),
      ArrowDown: Math.max(level - 1, 0),
      Home: 0,
      End: max
    }[event.key];
    if (next === undefined || isDisabled) return;
    event.preventDefault();
    if (next !== level) setLevel(module, row, LEVELS[next]!);
    const radios =
      event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]");
    radios[Math.max(next, 1) - 1]?.focus();
  };

  const granted = modules.filter(
    (module) => effective(module, module.row) !== "None"
  ).length;
  const overrides = inherits ? value.length : 0;

  const bar = (module: Module, row: Row) => {
    const key = `${module.id}:${row.page ?? ""}`;
    const own = grantFor(module.enumValue, row.page);
    const level = index(effective(module, row));
    const max = index(row.max);
    const preview = hover?.key === key ? target(level, hover.step) : undefined;
    // In a bulk edit a row with no grant is "no change", not None.
    const unset = !own && !showInherited;
    return (
      <>
        {/* One cell spanning the step columns, so the row is one radio group:
            one tab stop, arrow keys to move. */}
        <Td colSpan={STEPS.length} className="px-0 py-1">
          <div
            role="radiogroup"
            aria-label={row.label}
            onKeyDown={(event) => onKeyDown(event, module, row)}
            className="flex"
          >
            {STEPS.map((step) => {
              const filled = step <= level;
              const willFill = preview !== undefined && step <= preview;
              const capped = step > max;
              const blocked = isDisabled || capped;
              return (
                <button
                  key={step}
                  type="button"
                  role="radio"
                  aria-label={`${row.label}: ${stepLabel[step]}`}
                  aria-checked={step === level}
                  tabIndex={step === Math.max(level, 1) ? 0 : -1}
                  disabled={blocked}
                  onClick={() =>
                    setLevel(module, row, LEVELS[target(level, step)]!)
                  }
                  onPointerEnter={() => setHover({ key, step })}
                  onPointerLeave={() => setHover(null)}
                  className={cn(
                    "group flex h-8 flex-1 items-center rounded-md px-1.5",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    blocked ? "cursor-not-allowed" : "cursor-pointer"
                  )}
                >
                  <span
                    // Filling cascades left to right: each step includes the ones before it.
                    style={{
                      transitionDelay: filled ? `${(step - 1) * 20}ms` : "0ms"
                    }}
                    className={cn(
                      "block h-2 w-full rounded-full transition-[background-color,opacity,transform] duration-150 ease-out motion-reduce:transition-none",
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
              );
            })}
          </div>
        </Td>
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
              onClick={() =>
                onChange(without(value, module.enumValue, row.page))
              }
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

  /** A module's name, muted while it grants nothing, so granted ones stand out. */
  const moduleName = (module: Module) => (
    <span
      className={cn(
        "text-sm font-medium transition-colors duration-150",
        effective(module, module.row) === "None" && "text-muted-foreground"
      )}
    >
      {module.row.label}
      {note(module.id)}
    </span>
  );

  const sticky =
    "max-md:sticky max-md:left-0 max-md:z-10 max-md:bg-card text-left";
  const header = "text-xs font-medium uppercase tracking-wide";
  const canSetColumn = !inherits && !isDisabled;

  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium leading-none mb-2">
          <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
        </label>
      )}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {showInherited ? (
            <Trans>
              {granted} of {modules.length} modules
            </Trans>
          ) : null}
          {overrides > 0 ? (
            <>
              {" · "}
              <Trans>{overrides} overridden</Trans>
            </>
          ) : null}
        </span>
        {/* A key to the bar, where a row can be in more than one state. */}
        {resettable ? (
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-4 rounded-full bg-primary" />
              {inherits ? <Trans>Override</Trans> : <Trans>Set here</Trans>}
            </span>
            {inherits ? (
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-4 rounded-full bg-primary/40" />
                {inheritsFrom}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-4 rounded-full border border-dashed border-muted-foreground/50" />
                <Trans>No change</Trans>
              </span>
            )}
          </span>
        ) : null}
      </div>
      {/* Wide: clip, not scroll, so the header can stick to the dialog's scroll.
          Compact: this div scrolls sideways and the module column stays pinned. */}
      <div className="rounded-lg border md:overflow-clip max-md:overflow-x-auto max-md:scroll-fade-x">
        <Table full={isPhone} className="table-fixed">
          <Thead className="md:sticky md:top-0 md:z-20 md:bg-card">
            <Tr>
              <Th className={cn(sticky, header, "w-[180px] md:w-auto")}>
                <Trans>Module</Trans>
              </Th>
              {STEPS.map((step) => (
                <Th
                  key={step}
                  className={cn(header, "w-[76px] px-0 text-center")}
                >
                  {canSetColumn ? (
                    <button
                      type="button"
                      title={t`Set every module to ${stepLabel[step]}`}
                      onClick={() => setColumn(step)}
                      className="rounded px-1.5 py-0.5 uppercase tracking-wide transition-colors duration-100 hover:bg-foreground/5 hover:text-foreground active:scale-[0.97]"
                    >
                      {stepLabel[step]}
                    </button>
                  ) : (
                    stepLabel[step]
                  )}
                </Th>
              ))}
              {inherits ? (
                <Th className={cn(header, "w-[120px]")}>
                  <Trans>From</Trans>
                </Th>
              ) : null}
              <Th className="w-[44px]" />
            </Tr>
          </Thead>
          <Tbody>
            {modules.map((module) => {
              const isOpen = expanded.has(module.id);
              const pagesGranted = module.pages.filter(
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
                        {moduleName(module)}
                        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
                          {t`${pagesGranted}/${module.pages.length} pages`}
                        </span>
                      </button>
                    ) : (
                      moduleName(module)
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
