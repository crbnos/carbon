// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ModuleDir, SourceFile } from "../check";
import { readSource } from "./read-source";

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
    contents: readSource(join(root, rel))
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

const SERVER_FILE =
  /^apps\/erp\/app\/modules\/([a-z-]+)\/\1(?:\.ee)?\.server\.ts$/;

/**
 * `<module>.<name>` for every building block a service function calls
 * (`service.<name>(…)` in `<module>.server.ts`). A building block no service
 * function calls is a helper, and a loader may call it directly.
 */
export function wrappedBuildingBlocks(serverFiles: SourceFile[]): Set<string> {
  const wrapped = new Set<string>();
  for (const { file, contents } of serverFiles) {
    const module = SERVER_FILE.exec(file)?.[1];
    if (!module) continue;
    for (const m of contents.matchAll(/\bservice\.(\w+)\(/g)) {
      wrapped.add(`${module}.${m[1]}`);
    }
  }
  return wrapped;
}
