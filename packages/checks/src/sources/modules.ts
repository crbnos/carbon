// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ModuleDir } from "../check";

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
