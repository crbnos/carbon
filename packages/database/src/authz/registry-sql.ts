// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACTION_LEVEL, ACTIONS } from "../access/levels";
import { MODULES, PAGES, type Page, pagesOf } from "../access/registry";

/**
 * The managed helpers whose bodies are the registry (access/pages, access/levels):
 * written by `authz sync` and `authz migration`, checked by `registry-helpers-fresh`
 * (@carbon/checks). A page edit changes these functions, not the policies that call them.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");

/** The managed helpers directory (`authz sync` writes the registry helpers here). */
export const HELPERS_DIR = path.join(HERE, "helpers");

/** `HELPERS_DIR` from the repo root, as @carbon/checks names files. */
export const REGISTRY_HELPERS_DIR = path
  .relative(REPO_ROOT, HELPERS_DIR)
  .split(path.sep)
  .join("/");

const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;

const generatedFrom = (source: string) =>
  `  -- Generated from packages/database/src/access/${source} (authz/registry-sql.ts). Do not edit.`;

const generated = generatedFrom("pages");

function actionLevels(): string {
  const rows = ACTIONS.map(
    (action) =>
      `(${literal(action)}, ${literal(ACTION_LEVEL[action])}::public."permissionLevel")`
  );
  return `CREATE OR REPLACE FUNCTION util.action_levels()
 RETURNS TABLE(action text, level public."permissionLevel")
 LANGUAGE sql
 IMMUTABLE
AS $function$
${generatedFrom("levels.ts")}
  -- Each action of a '<page>_<action>' key and the lowest level that holds it.
  VALUES ${rows.join(", ")}
$function$;
`;
}

function modulePages(): string {
  const arms = MODULES.map(
    ({ id }) =>
      `    WHEN ${literal(id)} THEN ARRAY[${pagesOf(id).map(literal).join(", ")}]`
  );
  return `CREATE OR REPLACE FUNCTION util.module_pages(p_module text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
${generated}
  -- The pages of a module, in sidebar order; empty for anything else.
  SELECT CASE p_module
${arms.join("\n")}
    ELSE '{}'::text[]
  END
$function$;
`;
}

function pageMaxLevel(): string {
  const arms = (PAGES as readonly Page[])
    .filter((page) => page.maxLevel !== "Full")
    .map(
      (page) =>
        `    WHEN ${literal(page.id)} THEN ${literal(page.maxLevel)}::public."permissionLevel"`
    );
  return `CREATE OR REPLACE FUNCTION util.page_max_level(p_page text)
 RETURNS "permissionLevel"
 LANGUAGE sql
 IMMUTABLE
AS $function$
${generated}
  -- A page's maxLevel below Full; NULL for a Full page and for anything else, which
  -- LEAST ignores. Constant arms and no SET search_path, so it inlines into
  -- util.access_level: a runtime cast or a SET would make it a call per level.
  SELECT CASE p_page
${arms.join("\n")}
  END
$function$;
`;
}

/** Each registry helper's file name in helpers/ and the text it must hold. */
export function renderRegistryHelpers(): { name: string; sql: string }[] {
  return [
    { name: "util.action_levels.sql", sql: actionLevels() },
    { name: "util.module_pages.sql", sql: modulePages() },
    { name: "util.page_max_level.sql", sql: pageMaxLevel() }
  ];
}

function registryHelperFiles(dir: string): { file: string; sql: string }[] {
  return renderRegistryHelpers().map(({ name, sql }) => ({
    file: path.join(dir, name),
    sql
  }));
}

const read = (file: string) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
};

/** Writes the registry helpers into `dir` (`HELPERS_DIR`); returns the files written. */
export function writeRegistryHelpers(dir: string): string[] {
  const written: string[] = [];
  for (const { file, sql } of registryHelperFiles(dir)) {
    if (read(file) === sql) continue;
    writeFileSync(file, sql);
    written.push(file);
  }
  return written;
}
