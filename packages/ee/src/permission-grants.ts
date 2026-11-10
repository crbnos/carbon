// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { Constants } from "@carbon/database";
import {
  claimsFromJson,
  expandClaims,
  holdsGate,
  LEVELS,
  type Level
} from "@carbon/database/access";
import type { GrantInput, GrantModule } from "@carbon/database/access-write";

/**
 * The decisions of permission authoring, with no I/O: what a bulk edit leaves
 * a person with, and whether an actor may edit accounts.
 */

// Uppercase the first letter only (mirrors the ERP `~/utils/string` capitalize),
// which `@carbon/ee` cannot import.
function capitalize(words: string) {
  const [first, ...otherLetters] = words;
  return [first?.toLocaleUpperCase() ?? "", ...otherLetters].join("");
}

const MODULES = new Set<string>(Constants.public.Enums.module);

/** A form's module name ("parts", "Parts") as the `module` enum value. */
export function toModule(name: string): GrantModule | null {
  const module = capitalize(name.toLowerCase());
  return MODULES.has(module) ? (module as GrantModule) : null;
}

export const higher = (a: Level, b: Level) =>
  LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b;

export type LeveledGrant = {
  module: string;
  page: string | null;
  level: Level;
};

const findLevel = (
  grants: readonly LeveledGrant[],
  module: string,
  page: string | null
) => grants.find((g) => g.module === module && g.page === page)?.level;

/**
 * A person's grants after a bulk edit. Each chosen grant becomes an override;
 * one whose level equals what the row inherits stores nothing. A page row
 * inherits the person's own module grant, else the role's page grant, else
 * the role's module grant (Full on the Admin type) — the order the access grid
 * shows. `addOnly` only raises a level above what the person holds today. The
 * person's other grants are kept, page overrides inside an edited module too:
 * the spec gives the bulk edit no "replace" meaning.
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
  const roleLevel = (module: string, page: string | null): Level =>
    admin
      ? "Full"
      : (findLevel(role, module, page) ??
        findLevel(role, module, null) ??
        "None");
  const inherited = (module: string, page: string | null): Level =>
    page === null
      ? roleLevel(module, null)
      : (findLevel(own, module, null) ?? roleLevel(module, page));

  const edited = new Map<string, GrantInput>();
  for (const grant of chosen) {
    const module = toModule(grant.module);
    if (!module) continue;
    const base = inherited(module, grant.page);
    const level = addOnly
      ? higher(grant.level, findLevel(own, module, grant.page) ?? base)
      : grant.level;
    edited.set(`${module}:${grant.page ?? ""}`, {
      module,
      page: grant.page,
      level: level === base ? null : level
    });
  }

  return [
    ...own
      .filter((g) => !edited.has(`${g.module}:${g.page ?? ""}`))
      .map((g) => ({
        module: g.module as GrantModule,
        page: g.page,
        level: g.level
      })),
    ...edited.values()
  ];
}

/** Whether the user may edit people's access in the company, by their claims. */
/** Whether a person's `get_claims` hold Users → Accounts at Edit in the company. */
export function claimsMayEditAccounts(claims: unknown, companyId: string) {
  return holdsGate(
    expandClaims(claimsFromJson(claims, companyId), companyId),
    { "users.accounts": "Edit" },
    companyId
  );
}
