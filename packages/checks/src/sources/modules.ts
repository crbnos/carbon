// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ModuleDir, SourceFile } from "../check";

const MODULES_REL = "apps/erp/app/modules";

export function modulesDir(root: string): string {
  return join(root, MODULES_REL);
}

export function loadModules(dir: string): ModuleDir[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => ({ name, dir: join(dir, name) }))
    .filter((m) => statSync(m.dir).isDirectory())
    .map((m) => ({ name: m.name, dir: m.dir, entries: readdirSync(m.dir) }));
}

/** Each module's `<m>.server.ts` with the `<m>.service.ts` it calls into. */
export function loadModuleServerFiles(
  root: string
): { server: SourceFile; service: SourceFile }[] {
  const read = (rel: string): SourceFile => ({
    file: rel,
    contents: readFileSync(join(root, rel), "utf-8")
  });
  return loadModules(modulesDir(root)).flatMap(({ name, entries }) => {
    const server = [`${name}.server.ts`, `${name}.ee.server.ts`].find((f) =>
      entries.includes(f)
    );
    const service = [`${name}.service.ts`, `${name}.ee.service.ts`].find((f) =>
      entries.includes(f)
    );
    if (!server || !service) return [];
    return [
      {
        server: read(`${MODULES_REL}/${name}/${server}`),
        service: read(`${MODULES_REL}/${name}/${service}`)
      }
    ];
  });
}
