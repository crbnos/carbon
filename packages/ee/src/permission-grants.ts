// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  type AccessSubjectType,
  type AnyOfGate,
  claimsFor,
  clampLevel,
  type ExpandedClaims,
  type Grant,
  higherLevel,
  holdsGate,
  type Level,
  type LevelSubject,
  levelOf,
  levelReaches,
  MODULES,
  type ModuleEnum,
  type ModuleId,
  moduleId,
  moduleOf,
  PAGES,
  type PageGate,
  type PageId,
  pageById,
  pagesOf
} from "@carbon/database/access";
import type {
  GrantInput,
  GrantSubject,
  StoredGrant
} from "@carbon/database/access-write";
import {
  defaultUpgradeMessage,
  type Feature,
  resolveRequirement
} from "./plan";

/** A form's module name ("parts", "Parts") as the `module` enum label; null for a module with no pages. */
export function toModule(name: string): ModuleEnum | null {
  return MODULES.find((m) => m.id === name.toLowerCase())?.enum ?? null;
}

/** One row of the access grid: a page, or a whole module (`page` null). */
export type GrantRow = { module: ModuleEnum; page: string | null };

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

/**
 * A person as the resolver reads them: their own grants tagged `person`, the
 * role's tagged `role`. The tag is how an override beats the role in `levelOf`.
 */
export function overrideSubject({
  own,
  inherited,
  admin
}: {
  own: readonly Omit<Grant, "subject">[];
  inherited: readonly Omit<Grant, "subject">[];
  admin?: boolean;
}): LevelSubject {
  return {
    admin,
    grants: [
      ...own.map((g) => ({ ...g, subject: "person" as const })),
      ...inherited.map((g) => ({ ...g, subject: "role" as const }))
    ]
  };
}

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
  /** A module by any name `toModule` reads. */
  chosen: readonly { module: string; page: string | null; level: Level }[];
  own: readonly StoredGrant[];
  role: readonly StoredGrant[];
  admin: boolean;
  addOnly: boolean;
}): GrantInput[] {
  const subject = overrideSubject({ own, inherited: role, admin });
  const key = (g: { module: string; page: string | null }) =>
    `${moduleId(g.module)}:${g.page ?? ""}`;

  const edited = new Map<string, GrantInput>();
  for (const grant of chosen) {
    const module = toModule(grant.module);
    if (!module) continue;
    const row = { module, page: grant.page };
    const base = rowLevel(subject, row, "person");
    const level = clampLevel(
      grant.page ?? (moduleId(module) as string),
      addOnly ? higherLevel(grant.level, rowLevel(subject, row)) : grant.level
    );
    edited.set(key(row), {
      module,
      page: grant.page,
      level: level === base ? null : level
    });
  }

  return [
    ...own.flatMap((g) =>
      edited.has(key(g))
        ? []
        : [{ module: g.module, page: g.page, level: g.level }]
    ),
    ...edited.values()
  ];
}

export function accessSubject(
  type: AccessSubjectType,
  id: string
): GrantSubject {
  if (type === "role") return { employeeTypeId: id };
  if (type === "person") return { userId: id };
  return { apiKeyId: id };
}

export const subjectTypeOf = (subject: GrantSubject): AccessSubjectType =>
  "employeeTypeId" in subject ? "role" : "userId" in subject ? "person" : "key";

/**
 * What a subject may be granted: the modules it may hold, enforced on every
 * write. `selectAllCaps` is where the grid's "select all" stops on a module;
 * a higher level stays a choice made on the module's own rows, and the server
 * accepts it. `page` is the page that reads (View) and writes (Edit) the
 * subject's grants. `feature` is the plan feature a write needs, and `refusal`
 * what a company without it is told. `noun` names the subject in a refused
 * grant's message, and `notFound` is the message for a subject the company
 * does not have.
 */
export type SubjectRules = {
  page: PageId;
  modules: readonly ModuleId[];
  selectAllCaps: Partial<Record<ModuleId, Level>>;
  feature: Feature;
  refusal: string;
  noun: string;
  notFound: string;
};

const ALL_MODULES = MODULES.map((m) => m.id);

const PERMISSIONS_REFUSAL = defaultUpgradeMessage(
  resolveRequirement({ feature: "PERMISSIONS" })
);

export const SUBJECT_RULES: Record<AccessSubjectType, SubjectRules> = {
  role: {
    page: "users.employeeTypes",
    modules: ALL_MODULES,
    selectAllCaps: {},
    feature: "PERMISSIONS",
    refusal: PERMISSIONS_REFUSAL,
    noun: "an employee type",
    notFound: "Employee type not found"
  },
  person: {
    page: "users.accounts",
    modules: ALL_MODULES,
    selectAllCaps: {},
    feature: "PERMISSIONS",
    refusal: PERMISSIONS_REFUSAL,
    noun: "an employee",
    notFound: "Employee not found"
  },
  // Keys were never offered Workflows. Deleting accounting data through the
  // API is never part of "select all".
  key: {
    page: "settings.apiKeys",
    modules: ALL_MODULES.filter((id) => id !== "workflows"),
    selectAllCaps: { accounting: "Edit" },
    feature: "API_KEYS",
    refusal: "API keys require the Business plan",
    noun: "an API key",
    notFound: "API key not found"
  }
};

export function subjectGates(
  level: "View" | "Edit" | "Full"
): Record<AccessSubjectType, PageGate> {
  const gate = (type: AccessSubjectType): PageGate => ({
    [SUBJECT_RULES[type].page]: level
  });
  return { role: gate("role"), person: gate("person"), key: gate("key") };
}

/**
 * Who may read people's and roles' access: an Accounts viewer or an Employee
 * Types viewer (the role form's "Who has access" panel, and the person editor
 * reading what each role gives).
 */
export const ACCESS_READER_GATE = {
  anyOf: [{ "users.accounts": "View" }, { "users.employeeTypes": "View" }]
} as const satisfies AnyOfGate;

export function refusedModules(
  type: AccessSubjectType,
  grants: readonly GrantInput[]
): ModuleEnum[] {
  const allowed = SUBJECT_RULES[type].modules;
  const refused = new Set<ModuleEnum>();
  for (const grant of grants) {
    const id = moduleId(grant.module);
    if (!id || !allowed.includes(id)) refused.add(grant.module);
  }
  return [...refused];
}

export function claimsMayEditAccounts(claims: unknown, companyId: string) {
  return holdsGate(
    claimsFor(claims, companyId).permissions,
    subjectGates("Edit").person,
    companyId
  );
}

/**
 * The pages where a key's grants after a write exceed both the actor's level and
 * what the key held before: what a key write refuses. Levels compare as `levelOf`
 * reads them, so a module grant counts on every page it reaches.
 */
export function keyGrantsAboveActor({
  actor,
  companyId,
  before,
  after
}: {
  actor: ExpandedClaims;
  companyId: string;
  before: readonly Omit<Grant, "subject">[];
  after: readonly GrantInput[];
}): PageId[] {
  const asKey = (
    grants: readonly (Omit<Grant, "subject" | "level"> & {
      level: Level | null;
    })[]
  ): LevelSubject => ({
    grants: grants.flatMap((g) =>
      g.level === null ? [] : [{ ...g, level: g.level, subject: "key" }]
    )
  });
  const was = asKey(before);
  const will = asKey(after);
  return PAGES.flatMap(({ id }) => {
    const level = levelOf(will, id).level;
    if (level === "None" || levelReaches(levelOf(was, id).level, level))
      return [];
    return holdsGate(actor, { [id]: level }, companyId) ? [] : [id];
  });
}

/** "Users → Accounts": a page as the access grid names it. */
export function pageName(pageId: string): string {
  const module = MODULES.find((m) => m.id === moduleOf(pageId));
  const page = pageById(pageId);
  return module && page ? `${module.label} → ${page.label}` : pageId;
}
