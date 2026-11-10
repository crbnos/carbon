// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MODULES, PAGES, type Page, pagesOf } from "../access/registry";
import { HELPERS_DIR } from "./helpers";

/**
 * The managed helpers whose bodies are the registry (access/pages): written by
 * `authz sync` and `authz migration`, checked by `registry-helpers-fresh`
 * (@carbon/checks). A page edit
 * changes these two functions, not the policies that call them.
 */

const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;

const generated =
  "  -- Generated from packages/database/src/access/pages (authz/registry-sql.ts). Do not edit.";

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

/**
 * Each registry helper's file name in helpers/ and the text it must hold. The
 * `registry-helpers-fresh` check (@carbon/checks) compares them with the files.
 */
export function renderRegistryHelpers(): { name: string; sql: string }[] {
  return [
    { name: "util.module_pages.sql", sql: modulePages() },
    { name: "util.page_max_level.sql", sql: pageMaxLevel() }
  ];
}

/** Each registry helper's file in helpers/ and the text it must hold. */
export function registryHelperFiles(): { file: string; sql: string }[] {
  return renderRegistryHelpers().map(({ name, sql }) => ({
    file: path.join(HELPERS_DIR, name),
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

/** Rewrite the registry helpers that differ from the registry; returns the files written. */
export function writeRegistryHelpers(): string[] {
  const written: string[] = [];
  for (const { file, sql } of registryHelperFiles()) {
    if (read(file) === sql) continue;
    writeFileSync(file, sql);
    written.push(file);
  }
  return written;
}
