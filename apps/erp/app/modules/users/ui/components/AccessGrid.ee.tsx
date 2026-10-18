// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { TermId } from "@carbon/content/glossary";
import {
  LEVELS,
  type Level,
  MODULES,
  moduleOf,
  PAGES,
  type Page
} from "@carbon/database/access";
import {
  Checkbox,
  cn,
  IconButton,
  LabelWithHelp,
  Tooltip,
  TooltipContent,
  TooltipTrigger
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
  /** Where inherited levels come from, such as the person's role: shown in a
   *  "From" column. */
  inheritsFrom?: string;
  /** A note per module or page id, such as access that grew in the conversion. */
  notes?: Record<string, string>;
  /** The most "select all" may set on a module: an API key's never gives Full
   *  on Accounting. */
  columnCaps?: Record<string, Level>;
  onChange: (grants: AccessGrant[]) => void;
  label?: string;
  termId?: TermId;
  isDisabled?: boolean;
};

/** The checkbox columns; column N holds level LEVELS[N]. */
const STEPS = [1, 2, 3, 4] as const;

const index = (level: Level) => LEVELS.indexOf(level);

const lower = (a: Level, b: Level) => (index(a) <= index(b) ? a : b);

/** Checking column N sets level N; unchecking it drops to the level below. */
const target = (current: number, step: number) =>
  step <= current ? step - 1 : step;

/** A row of a module's table: one of its pages, or the module itself (`page`
 *  null) while it has no pages. */
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The cell under the pointer: the row previews what clicking it would set.
  const [hover, setHover] = useState<{ key: string; step: number } | null>(
    null
  );

  const stepLabel: Record<(typeof STEPS)[number], string> = {
    1: t`View`,
    2: t`Create`,
    3: t`Update`,
    4: t`Delete`
  };

  const present = new Set(pages.map((page) => moduleOf(page.id)));
  const modules = MODULES.filter((module) => present.has(module.id)).map(
    ({ id, label: moduleLabel }) => {
      const own = pages.find((p) => p.id === id);
      const row: Row = {
        page: null,
        label: moduleLabel,
        max: own?.maxLevel ?? "Full"
      };
      const pageRows = pages
        .filter((p) => p.id !== id && moduleOf(p.id) === id)
        .map((p): Row => ({ page: p.id, label: p.label, max: p.maxLevel }));
      return {
        id,
        enumValue: capitalize(id),
        row,
        rows: pageRows.length > 0 ? pageRows : [row]
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

  // Only a person's rows inherit: a role or a key row simply clears.
  const inherits = showInherited && inheritsFrom !== undefined;
  // A row can go back to something only on a person (the type) or in a bulk
  // edit (no change); a role or a key row just unchecks.
  const resettable = inherits || !showInherited;
  const resetLabel = inheritLabel ?? (inherits ? t`Inherit` : t`Clear`);
  const canSetColumn = !inherits && !isDisabled;

  /** The most "select all" sets on a row. */
  const capOf = (module: Module, row: Row) =>
    lower(row.max, columnCaps[module.id] ?? "Full");

  /** Every row of a module to one level each. A role, key or bulk edit sets a
   *  module with pages through its module grant, which also covers pages added
   *  later; a person sets each row, so each one compares with its own default. */
  const setModule = (module: Module, levelOf: (row: Row) => Level) => {
    if (!inherits && module.rows[0]?.page !== null) {
      const level = levelOf(module.row);
      const rest = value.filter((g) => g.module !== module.enumValue);
      onChange(
        level === "None" && showInherited
          ? rest
          : [...rest, { module: module.enumValue, page: null, level }]
      );
      return;
    }
    onChange(
      module.rows.reduce(
        (grants, row) => withLevel(grants, module, row, levelOf(row)),
        value
      )
    );
  };

  const moduleState = (module: Module) => {
    const levels = module.rows.map((row) => effective(module, row));
    if (module.rows.every((row, i) => levels[i] === capOf(module, row)))
      return "all";
    return levels.some((level) => level !== "None") ? "some" : "none";
  };

  const toggleModule = (module: Module) => {
    const all = moduleState(module) === "all";
    setModule(module, (row) => (all ? "None" : capOf(module, row)));
  };

  /** A column header sets every row of the module to that level, or clears
   *  them when they already hold it. Not on a person: there it would override all. */
  const setColumn = (module: Module, step: number) => {
    const all = module.rows.every(
      (row) => index(effective(module, row)) === step
    );
    setModule(module, (row) =>
      lower(LEVELS[all ? 0 : step]!, capOf(module, row))
    );
  };

  const toggleExpanded = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const granted = modules.filter((module) =>
    module.rows.some((row) => effective(module, row) !== "None")
  ).length;
  const overrides = inherits ? value.length : 0;

  /** A small amber mark beside a name, with its note on hover. */
  const note = (id: string | null) =>
    id && notes[id] ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label={notes[id]}
            className="ml-2 inline-block size-1.5 rounded-full bg-amber-500 align-middle"
          />
        </TooltipTrigger>
        <TooltipContent>{notes[id]}</TooltipContent>
      </Tooltip>
    ) : null;

  const header = "text-xs font-medium uppercase tracking-wide";

  /** The module grant a page row follows when it has no grant of its own. */
  const covering = (module: Module, row: Row) =>
    row.page === null ? undefined : grantFor(module.enumValue, null);

  const cells = (module: Module, row: Row) => {
    const key = `${module.id}:${row.page ?? ""}`;
    const own = grantFor(module.enumValue, row.page);
    const level = index(effective(module, row));
    const max = index(row.max);
    const preview = hover?.key === key ? target(level, hover.step) : undefined;
    // A person's row with no override of its own or of its module shows the
    // role's level, lighter.
    const inheritedRow = inherits && !own && !covering(module, row);
    return STEPS.map((step) => {
      const checked = step <= level;
      const adding = preview !== undefined && !checked && step <= preview;
      const removing = preview !== undefined && checked && step > preview;
      return (
        <td key={step} className="w-16 py-2 text-center">
          {step <= max ? (
            <Checkbox
              aria-label={`${row.label}: ${stepLabel[step]}`}
              checked={checked}
              disabled={isDisabled}
              onCheckedChange={() =>
                onChange(
                  withLevel(value, module, row, LEVELS[target(level, step)]!)
                )
              }
              onPointerEnter={() => setHover({ key, step })}
              onPointerLeave={() => setHover(null)}
              className={cn(
                "align-middle transition-[background-color,border-color,opacity,transform] duration-150 ease-out motion-reduce:transition-none",
                !isDisabled && "active:scale-[0.9]",
                checked &&
                  inheritedRow &&
                  "data-[state=checked]:border-primary/40 data-[state=checked]:bg-primary/40 dark:data-[state=checked]:bg-primary/40",
                adding && "border-primary bg-primary/15",
                removing && "opacity-40"
              )}
            />
          ) : null}
        </td>
      );
    });
  };

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
        {/* A key to the checkboxes, where a row can be in more than one state. */}
        {inherits ? (
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5">
              <Checkbox checked tabIndex={-1} aria-hidden />
              <Trans>Override</Trans>
            </span>
            <span className="flex items-center gap-1.5">
              <Checkbox
                checked
                tabIndex={-1}
                aria-hidden
                className="data-[state=checked]:border-primary/40 data-[state=checked]:bg-primary/40 dark:data-[state=checked]:bg-primary/40"
              />
              {inheritsFrom}
            </span>
          </span>
        ) : null}
      </div>
      <div className="divide-y overflow-hidden rounded-lg border">
        {modules.map((module) => {
          const isOpen = expanded.has(module.id);
          const state = moduleState(module);
          const reached = module.rows.filter(
            (row) => effective(module, row) !== "None"
          ).length;
          const hasGrants = value.some((g) => g.module === module.enumValue);
          return (
            <section key={module.id}>
              <div className="flex h-12 items-center gap-3 bg-muted/40 pr-4">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggleExpanded(module.id)}
                  className="flex h-full min-w-0 flex-1 items-center gap-2 pl-4 text-left transition-colors duration-100 hover:bg-muted/60"
                >
                  <LuChevronRight
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out motion-reduce:transition-none",
                      isOpen && "rotate-90"
                    )}
                  />
                  <span
                    className={cn(
                      "truncate text-sm font-medium",
                      state === "none" && "text-muted-foreground"
                    )}
                  >
                    {module.row.label}
                  </span>
                  {note(module.id)}
                  {inherits && hasGrants ? (
                    <span className="rounded-md bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground">
                      <Trans>Override</Trans>
                    </span>
                  ) : null}
                </button>
                {resettable && hasGrants ? (
                  <IconButton
                    aria-label={`${resetLabel}: ${module.row.label}`}
                    title={resetLabel}
                    icon={<LuUndo2 />}
                    variant="ghost"
                    size="sm"
                    isDisabled={isDisabled}
                    onClick={() =>
                      onChange(
                        value.filter((g) => g.module !== module.enumValue)
                      )
                    }
                  />
                ) : null}
                <span className="rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
                  {t`${reached}/${module.rows.length} pages`}
                </span>
                <Checkbox
                  aria-label={t`Select all in ${module.row.label}`}
                  checked={
                    state === "all"
                      ? true
                      : state === "some"
                        ? "indeterminate"
                        : false
                  }
                  isIndeterminate={state === "some"}
                  disabled={isDisabled}
                  onCheckedChange={() => toggleModule(module)}
                  className={cn(!isDisabled && "active:scale-[0.9]")}
                />
              </div>
              {isOpen ? (
                <div className="overflow-x-auto pb-2 pl-10 pr-4">
                  <table className="w-full min-w-[480px] table-fixed text-sm">
                    <thead>
                      <tr className="text-muted-foreground">
                        <th className={cn(header, "py-2.5 text-left")}>
                          <Trans>Page</Trans>
                        </th>
                        {STEPS.map((step) => (
                          <th
                            key={step}
                            className={cn(header, "w-16 py-2.5 text-center")}
                          >
                            {canSetColumn ? (
                              <button
                                type="button"
                                title={t`Set every page of ${module.row.label} to ${stepLabel[step]}`}
                                onClick={() => setColumn(module, step)}
                                className="rounded px-1 py-0.5 uppercase tracking-wide transition-colors duration-100 hover:bg-foreground/5 hover:text-foreground active:scale-[0.97]"
                              >
                                {stepLabel[step]}
                              </button>
                            ) : (
                              stepLabel[step]
                            )}
                          </th>
                        ))}
                        {inherits ? (
                          <th className={cn(header, "w-28 py-2.5 text-left")}>
                            <Trans>From</Trans>
                          </th>
                        ) : null}
                        {resettable ? <th className="w-10" /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {module.rows.map((row) => {
                        const own = grantFor(module.enumValue, row.page);
                        return (
                          <tr
                            key={row.page ?? module.id}
                            className="border-t border-border/60"
                          >
                            <td className="truncate py-2 pr-2">
                              {row.label}
                              {note(row.page)}
                            </td>
                            {cells(module, row)}
                            {inherits ? (
                              <td className="truncate py-2 text-xs text-muted-foreground">
                                {own || covering(module, row) ? (
                                  <span className="rounded-md bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground">
                                    <Trans>Override</Trans>
                                  </span>
                                ) : effective(module, row) !== "None" ? (
                                  inheritsFrom
                                ) : null}
                              </td>
                            ) : null}
                            {resettable ? (
                              <td className="py-1 text-right">
                                {own ? (
                                  <IconButton
                                    aria-label={resetLabel}
                                    title={resetLabel}
                                    icon={<LuUndo2 />}
                                    variant="ghost"
                                    size="sm"
                                    isDisabled={isDisabled}
                                    onClick={() =>
                                      onChange(
                                        without(
                                          value,
                                          module.enumValue,
                                          row.page
                                        )
                                      )
                                    }
                                  />
                                ) : null}
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default AccessGrid;
