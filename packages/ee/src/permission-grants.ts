// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  claimsFor,
  type Grant,
  holdsGate,
  LEVELS,
  type Level,
  type LevelSubject,
  levelOf,
  lowerLevel,
  MODULES,
  type ModuleId,
  moduleId,
  pageById,
  pagesOf
} from "@carbon/database/access";
import type { GrantInput, GrantModule } from "@carbon/database/access-write";

/**
 * The decisions of permission authoring, with no I/O: what one row of the
 * access grid holds, what a bulk edit leaves a person with, what a subject may
 * be granted, and whether an actor may edit accounts.
 */

/** A form's module name ("parts", "Parts") as the `module` enum label; null for a module with no pages. */
export function toModule(name: string): GrantModule | null {
  return MODULES.find((m) => m.id === name.toLowerCase())?.enum ?? null;
}

export const higher = (a: Level, b: Level) =>
  LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b;

/** One row of the access grid: a page, or a whole module (`page` null). */
export type GrantRow = { module: GrantModule; page: string | null };

const sameRow = (grant: Grant, row: GrantRow) =>
  grant.page === row.page && moduleId(grant.module) === moduleId(row.module);

/**
 * The level a subject holds on one row of the access grid, as the resolver
 * gives it (`levelOf`), at most the page's `maxLevel`. A row of a module with
 * pages covers pages of different maxima, so it reads only the module grants,
 * unclamped. `without` leaves out that subject's own grant on the row: what
 * the row inherits.
 */
export function rowLevel(
  subject: LevelSubject,
  row: GrantRow,
  without?: Grant["subject"]
): Level {
  const id = moduleId(row.module);
  if (!id) return "None";
  const grants = without
    ? subject.grants.filter((g) => !(g.subject === without && sameRow(g, row)))
    : subject.grants;
  const page = row.page ?? (pageById(id) ? id : null);
  if (page) return levelOf({ admin: subject.admin, grants }, page).level;
  const first = pagesOf(id)[0];
  if (!first) return "None";
  return levelOf(
    { admin: subject.admin, grants: grants.filter((g) => g.page === null) },
    first
  ).granted;
}

/** A level at most what a row allows: its page's `maxLevel`, else unchanged. */
const clampRow = (row: GrantRow, level: Level) => {
  const id = row.page ?? moduleId(row.module);
  const max = id ? pageById(id)?.maxLevel : undefined;
  return max ? lowerLevel(level, max) : level;
};

export type LeveledGrant = {
  module: string;
  page: string | null;
  level: Level;
};

/**
 * A person's grants after a bulk edit. Each chosen grant becomes an override;
 * one whose level equals what the row inherits (`rowLevel` without the
 * person's own grant there) stores nothing. `addOnly` only raises a level
 * above what the person holds on the row today. The person's other grants are
 * kept, page overrides inside an edited module too: the spec gives the bulk
 * edit no "replace" meaning.
 */
export function bulkEditGrants({
  chosen,
  own,
  role,
  admin,
  addOnly
}: {
  chosen: readonly LeveledGrant[];
  own: readonly LeveledGrant[];
  role: readonly LeveledGrant[];
  admin: boolean;
  addOnly: boolean;
}): GrantInput[] {
  const subject: LevelSubject = {
    admin,
    grants: [
      ...own.map((g) => ({ ...g, subject: "person" as const })),
      ...role.map((g) => ({ ...g, subject: "role" as const }))
    ]
  };
  const key = (g: { module: string; page: string | null }) =>
    `${moduleId(g.module)}:${g.page ?? ""}`;

  const edited = new Map<string, GrantInput>();
  for (const grant of chosen) {
    const module = toModule(grant.module);
    if (!module) continue;
    const row = { module, page: grant.page };
    const base = rowLevel(subject, row, "person");
    const level = clampRow(
      row,
      addOnly ? higher(grant.level, rowLevel(subject, row)) : grant.level
    );
    edited.set(key(row), {
      module,
      page: grant.page,
      level: level === base ? null : level
    });
  }

  return [
    ...own.flatMap((g) => {
      const module = toModule(g.module);
      return module && !edited.has(key(g))
        ? [{ module, page: g.page, level: g.level }]
        : [];
    }),
    ...edited.values()
  ];
}

/** Who holds a grant: an employee type, a person, or an API key. */
export type AccessSubjectType = "role" | "person" | "key";

/**
 * What a subject may be granted: the modules it may hold, enforced on every
 * write. `selectAllCaps` is where the grid's "select all" stops on a module;
 * a higher level stays a choice made on the module's own rows, and the server
 * accepts it.
 */
export type SubjectRules = {
  modules: readonly ModuleId[];
  selectAllCaps: Partial<Record<ModuleId, Level>>;
};

const ALL_MODULES = MODULES.map((m) => m.id);

export const SUBJECT_RULES: Record<AccessSubjectType, SubjectRules> = {
  role: { modules: ALL_MODULES, selectAllCaps: {} },
  person: { modules: ALL_MODULES, selectAllCaps: {} },
  // Keys were never offered Workflows. Deleting accounting data through the
  // API is never part of "select all".
  key: {
    modules: ALL_MODULES.filter((id) => id !== "workflows"),
    selectAllCaps: { accounting: "Edit" }
  }
};

/** The modules of `grants` the subject may not hold, by their labels. */
export function refusedModules(
  type: AccessSubjectType,
  grants: readonly GrantInput[]
): GrantModule[] {
  const allowed = SUBJECT_RULES[type].modules;
  const refused = new Set<GrantModule>();
  for (const grant of grants) {
    const id = moduleId(grant.module);
    if (!id || !allowed.includes(id)) refused.add(grant.module);
  }
  return [...refused];
}

/** Whether a person's `get_claims` hold Users → Accounts at Edit in the company. */
export function claimsMayEditAccounts(claims: unknown, companyId: string) {
  return holdsGate(
    claimsFor(claims, companyId).permissions,
    { "users.accounts": "Edit" },
    companyId
  );
}
