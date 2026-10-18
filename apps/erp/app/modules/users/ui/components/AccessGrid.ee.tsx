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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useViewport
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { capitalize } from "~/utils/string";

/** One grant as the grid edits it. `module` is the `module` enum value. */
export type AccessGrant = { module: string; page: string | null; level: Level };

const INHERIT = "inherit";

type AccessGridProps = {
  pages?: readonly Page[];
  value: AccessGrant[];
  /** Per module or page id, what the row resolves to with no grant here: a
   *  person's role. Missing is None. */
  inherited?: Record<string, Level>;
  /** The empty choice: "Inherit", or "Role default" on a person. */
  inheritLabel?: string;
  /** Show what the empty choice resolves to. Off where it differs per row
   *  owner, as in a bulk edit. */
  showInherited?: boolean;
  onChange: (grants: AccessGrant[]) => void;
  label?: string;
  termId?: TermId;
  isDisabled?: boolean;
};

const levelsUpTo = (max: Level) => LEVELS.slice(0, LEVELS.indexOf(max) + 1);

const lower = (a: Level, b: Level) =>
  LEVELS.indexOf(a) <= LEVELS.indexOf(b) ? a : b;

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
  const { isPhone } = useViewport();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const levelLabel: Record<Level, string> = {
    None: t`None`,
    View: t`View`,
    Create: t`Create`,
    Edit: t`Edit`,
    Full: t`Full`
  };

  const modules = [...new Set(pages.map((page) => moduleOf(page.id)))].map(
    (id) => ({
      id,
      enumValue: capitalize(id),
      page: pages.find((page) => page.id === id),
      children: pages.filter(
        (page) => page.id !== id && moduleOf(page.id) === id
      )
    })
  );

  const grantFor = (module: string, page: string | null) =>
    value.find((g) => g.module === module && g.page === page);

  const setLevel = (module: string, page: string | null, level: string) => {
    const rest = value.filter((g) => g.module !== module || g.page !== page);
    onChange(
      level === INHERIT
        ? rest
        : [...rest, { module, page, level: level as Level }]
    );
  };

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const levelSelect = (
    module: string,
    page: string | null,
    max: Level,
    fallback: Level
  ) => {
    const grant = grantFor(module, page);
    return (
      <Select
        value={grant?.level ?? INHERIT}
        onValueChange={(level) => setLevel(module, page, level)}
        disabled={isDisabled}
      >
        <SelectTrigger
          className={cn("w-[160px]", !grant && "text-muted-foreground")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={INHERIT}>
            {showInherited
              ? `${inheritLabel ?? t`Inherit`} (${levelLabel[lower(fallback, max)]})`
              : (inheritLabel ?? t`Inherit`)}
          </SelectItem>
          {levelsUpTo(max).map((level) => (
            <SelectItem key={level} value={level}>
              {levelLabel[level]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  };

  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium leading-none mb-2">
          <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
        </label>
      )}
      {/* Compact: this div scrolls sideways and the module column stays pinned. */}
      <div className="rounded-md border overflow-hidden max-md:overflow-x-auto max-md:scroll-fade-x">
        <Table full={isPhone}>
          <Thead>
            <Tr>
              <Th className="max-md:sticky max-md:left-0 max-md:z-10 max-md:bg-card">
                <Trans>Module</Trans>
              </Th>
              <Th className="w-[180px]">
                <Trans>Access</Trans>
              </Th>
              <Th className="w-[120px]">
                <Trans>Pages</Trans>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {modules.map((module) => {
              // A page row with no grant: the module grant here, else what
              // the page itself inherits, else the module's inheritance.
              const moduleGrant = grantFor(module.enumValue, null)?.level;
              const isOpen = expanded.has(module.id);
              const set = module.children.filter((page) =>
                grantFor(module.enumValue, page.id)
              ).length;
              const total = module.children.length;
              return [
                <Tr key={module.id}>
                  <Td className="max-md:sticky max-md:left-0 max-md:z-10 max-md:bg-card">
                    <div className="flex items-center gap-2">
                      {module.children.length > 0 ? (
                        <IconButton
                          aria-label={isOpen ? t`Collapse` : t`Expand`}
                          icon={isOpen ? <LuChevronDown /> : <LuChevronRight />}
                          variant="ghost"
                          size="sm"
                          onClick={() => toggle(module.id)}
                        />
                      ) : null}
                      <span className="text-sm font-medium">
                        {module.page?.label ?? capitalize(module.id)}
                      </span>
                    </div>
                  </Td>
                  <Td>
                    {levelSelect(
                      module.enumValue,
                      null,
                      module.page?.maxLevel ?? "Full",
                      inherited[module.id] ?? "None"
                    )}
                  </Td>
                  <Td className="text-sm text-muted-foreground">
                    {total > 0 ? (
                      <Trans>
                        {set} of {total}
                      </Trans>
                    ) : null}
                  </Td>
                </Tr>,
                ...(isOpen
                  ? module.children.map((page) => (
                      <Tr key={page.id}>
                        <Td className="pl-12 max-md:sticky max-md:left-0 max-md:z-10 max-md:bg-card">
                          <span className="text-sm">{page.label}</span>
                        </Td>
                        <Td>
                          {levelSelect(
                            module.enumValue,
                            page.id,
                            page.maxLevel,
                            moduleGrant ??
                              inherited[page.id] ??
                              inherited[module.id] ??
                              "None"
                          )}
                        </Td>
                        <Td />
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
