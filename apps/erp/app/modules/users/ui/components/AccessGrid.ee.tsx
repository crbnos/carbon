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
  Checkbox,
  cn,
  IconButton,
  LabelWithHelp,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
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
  label?: string;
  termId?: TermId;
  isDisabled?: boolean;
};

/** The checkbox columns, each the level it ticks up to: the boxes are a ladder. */
const COLUMNS = [1, 2, 3, 4] as const;

const index = (level: Level) => LEVELS.indexOf(level);

const lower = (a: Level, b: Level) => (index(a) <= index(b) ? a : b);

type Row = { page: string | null; label: string; max: Level };

const AccessGrid = ({
  pages = PAGES,
  value,
  inherited = {},
  inheritLabel,
  showInherited = true,
  onChange,
  label,
  termId,
  isDisabled
}: AccessGridProps) => {
  const { t } = useLingui();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const columnLabel: Record<(typeof COLUMNS)[number], string> = {
    1: t`View`,
    2: t`Create`,
    3: t`Update`,
    4: t`Delete`
  };

  const modules = [...new Set(pages.map((page) => moduleOf(page.id)))].map(
    (id) => {
      const page = pages.find((p) => p.id === id);
      const children = pages.filter(
        (p) => p.id !== id && moduleOf(p.id) === id
      );
      // Until a module is split into pages, its one row is the module itself.
      const rows: Row[] = children.length
        ? children.map((p) => ({ page: p.id, label: p.label, max: p.maxLevel }))
        : [
            {
              page: null,
              label: page?.label ?? capitalize(id),
              max: page?.maxLevel ?? "Full"
            }
          ];
      return {
        id,
        enumValue: capitalize(id),
        label: page?.label ?? capitalize(id),
        max: page?.maxLevel ?? "Full",
        rows
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

  const setRow = (module: Module, row: Row, level: Level) => {
    const rest = without(module.enumValue, row.page);
    // A level equal to what the row inherits needs no grant of its own.
    onChange(
      showInherited && level === fallback(module, row)
        ? rest
        : [...rest, { module: module.enumValue, page: row.page, level }]
    );
  };

  const clearRow = (module: Module, row: Row) =>
    onChange(without(module.enumValue, row.page));

  /** Tick a box: the row's level becomes that box; untick: the box below. */
  const toggle = (module: Module, row: Row, column: number) => {
    const ticked = index(effective(module, row)) >= column;
    setRow(module, row, LEVELS[ticked ? column - 1 : column]!);
  };

  const isFull = (module: Module) =>
    module.rows.every((row) => effective(module, row) === row.max);

  /** The module box: Full on the whole module, or cleared. */
  const toggleModule = (module: Module) => {
    const rest = value.filter((g) => g.module !== module.enumValue);
    if (!isFull(module)) {
      const inheritsFull =
        showInherited && (inherited[module.id] ?? "None") === module.max;
      onChange(
        inheritsFull
          ? rest
          : [
              ...rest,
              { module: module.enumValue, page: null, level: module.max }
            ]
      );
      return;
    }
    // A person whose role grants the module needs a None of their own.
    const inheritsAccess =
      showInherited && (inherited[module.id] ?? "None") !== "None";
    onChange(
      inheritsAccess
        ? [...rest, { module: module.enumValue, page: null, level: "None" }]
        : rest
    );
  };

  const toggleExpanded = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium leading-none mb-1">
          <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
        </label>
      )}
      <p className="text-xs text-muted-foreground mb-3">
        <Trans>
          Set module-level access, then expand a module to fine-tune access for
          each of its pages.
        </Trans>
      </p>
      <div className="rounded-lg border overflow-hidden divide-y">
        {modules.map((module) => {
          const isOpen = expanded.has(module.id);
          const granted = module.rows.filter(
            (row) => effective(module, row) !== "None"
          ).length;
          const total = module.rows.length;
          const full = isFull(module);
          return (
            <div key={module.id}>
              <div
                className={cn(
                  "flex items-center gap-3 px-4 py-3",
                  isOpen && "bg-muted/40"
                )}
              >
                <button
                  type="button"
                  className="flex flex-1 items-center gap-3 text-left"
                  aria-expanded={isOpen}
                  onClick={() => toggleExpanded(module.id)}
                >
                  <LuChevronRight
                    className={cn(
                      "size-4 text-muted-foreground transition-transform",
                      isOpen && "rotate-90"
                    )}
                  />
                  <span className="text-sm font-medium">{module.label}</span>
                </button>
                <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
                  {t`${granted}/${total} pages`}
                </span>
                <Checkbox
                  aria-label={t`Full access to ${module.label}`}
                  isChecked={full}
                  isIndeterminate={granted > 0 && !full}
                  disabled={isDisabled}
                  onCheckedChange={() => toggleModule(module)}
                />
              </div>
              {isOpen ? (
                <div className="pl-12 pr-4 pb-2 max-md:overflow-x-auto max-md:scroll-fade-x">
                  <Table className="table-fixed">
                    <Thead>
                      <Tr>
                        <Th className="text-xs uppercase tracking-wide">
                          <Trans>Page</Trans>
                        </Th>
                        {COLUMNS.map((column) => (
                          <Th
                            key={column}
                            className="w-[80px] text-center text-xs uppercase tracking-wide"
                          >
                            {columnLabel[column]}
                          </Th>
                        ))}
                        <Th className="w-[40px]" />
                      </Tr>
                    </Thead>
                    <Tbody>
                      {module.rows.map((row) => {
                        const level = effective(module, row);
                        const own = grantFor(module.enumValue, row.page);
                        return (
                          <Tr key={row.page ?? module.id}>
                            <Td className="text-sm">{row.label}</Td>
                            {COLUMNS.map((column) => (
                              <Td key={column} className="text-center">
                                <Checkbox
                                  aria-label={`${row.label}: ${columnLabel[column]}`}
                                  className={cn(
                                    !own && showInherited && "opacity-60"
                                  )}
                                  isChecked={index(level) >= column}
                                  disabled={
                                    isDisabled || column > index(row.max)
                                  }
                                  onCheckedChange={() =>
                                    toggle(module, row, column)
                                  }
                                />
                              </Td>
                            ))}
                            <Td className="text-center">
                              {own ? (
                                <IconButton
                                  aria-label={inheritLabel ?? t`Inherit`}
                                  title={inheritLabel ?? t`Inherit`}
                                  icon={<LuUndo2 />}
                                  variant="ghost"
                                  size="sm"
                                  isDisabled={isDisabled}
                                  onClick={() => clearRow(module, row)}
                                />
                              ) : null}
                            </Td>
                          </Tr>
                        );
                      })}
                    </Tbody>
                  </Table>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AccessGrid;
