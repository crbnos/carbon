// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SourceFile, Violation } from "../check";

export const PROVIDER_ROLE_BACKFILLED = "provider-role-backfilled";

/**
 * `providerRole` is declared twice by necessity: on the integration's
 * `config.tsx` (`packages/ee/src/<id>/`), which the app reads, and on the
 * `integration` row, which the `companyIntegration_single_active_role` trigger
 * reads. The trigger returns early on NULL, so a descriptor whose role no
 * migration set fails as "no enforcement", not as an error.
 *
 * Replays every `UPDATE "integration" SET "providerRole" = …` in migration
 * order and compares the result with the descriptors, both ways.
 */
export function findProviderRoleDrift(
  configs: SourceFile[],
  migrations: SourceFile[]
): Violation[] {
  const declared = new Map<
    string,
    { role: string; file: string; line: number }
  >();
  for (const { file, contents } of configs) {
    const role = /providerRole:\s*"(\w+)"/.exec(contents);
    const id = /\n\s*id:\s*"([^"]+)"/.exec(contents);
    if (!role?.[1] || !id?.[1]) continue;
    declared.set(id[1], {
      role: role[1],
      file,
      line: contents.slice(0, role.index).split("\n").length
    });
  }

  const stored = new Map<string, { role: string | null; file: string }>();
  for (const { file, contents } of migrations) {
    for (const update of contents.matchAll(
      /UPDATE\s+(?:public\.)?"?integration"?\s+SET\s+"providerRole"\s*=\s*(?:'(\w+)'|NULL)\s+WHERE\s+([^;]*);/gi
    )) {
      const where = update[2] ?? "";
      const list =
        /"?id"?\s+IN\s*\(([^)]*)\)/i.exec(where)?.[1] ??
        /"?id"?\s*=\s*('[^']+')/i.exec(where)?.[1] ??
        "";
      for (const id of list.matchAll(/'([^']+)'/g)) {
        stored.set(id[1] ?? "", { role: update[1] ?? null, file });
      }
    }
  }

  const out: Violation[] = [];
  for (const [id, { role, file, line }] of declared) {
    const row = stored.get(id)?.role ?? null;
    if (row === role) continue;
    out.push({
      file,
      line,
      snippet: `${id}: ${role} declared, ${row ?? "NULL"} stored`,
      message: `No migration sets integration "${id}" to providerRole '${role}', so the one-active-per-role trigger does not guard it; add UPDATE "integration" SET "providerRole" = '${role}' WHERE id = '${id}'`
    });
  }
  for (const [id, { role, file }] of stored) {
    if (role === null || declared.has(id)) continue;
    out.push({
      file,
      line: 0,
      snippet: `${id}: ${role} stored, none declared`,
      message: `Integration "${id}" has providerRole '${role}' in the database but its config declares none`
    });
  }
  return out;
}
