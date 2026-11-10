// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { join } from "pathe";
import { getWorktreeRoot } from "./git.js";
import { paths } from "./paths.js";
import {
  ISOLATED_DATABASE,
  projectName,
  type StackHosts,
  type StackMode,
  stackHosts
} from "./topology.js";
import {
  getSlot,
  PORT_NAMES,
  type PortMap,
  recordedStackMode,
  resolveSlug,
  type Slot,
  stackDatabase,
  stackPorts
} from "./worktree.js";

export type DbTarget = { port: number; database: string };

/** Everything crbn knows about one worktree's stack, resolved once. */
export type Stack = {
  root: string;
  slug: string;
  project: string;
  /** The mode `crbn up` last wrote. null when no crbn with modes ran `up`
   *  here: commands that delete data need to know. */
  recordedMode: StackMode | null;
  mode: StackMode;
  slot: Slot | null;
  /** The slot's ports, with the shared containers' in shared mode. */
  ports: PortMap | null;
  /** The database this worktree's apps use. */
  db: DbTarget | null;
  hosts: StackHosts;
  /** Hibernation state and the mode file. */
  stateDir: string;
};

export async function currentStack(): Promise<Stack> {
  return stackAt(await getWorktreeRoot());
}

export function stackAt(root: string, slug = resolveSlug(root)): Stack {
  const recordedMode = recordedStackMode(slug);
  const slot = getSlot(slug);
  // .env.local is the stack the apps talk to: under --borrow another
  // worktree's, in localhost mode one on pinned ports. It decides when there
  // is one; an older crbn that wrote no mode file wrote it too.
  const env = readEnvLocal(root);
  const mode =
    env?.db.database === ISOLATED_DATABASE
      ? "isolated"
      : env
        ? "shared"
        : (recordedMode ?? "shared");
  const ports = slot
    ? { ...stackPorts(slot.ports, mode), ...env?.ports }
    : null;
  return {
    root,
    slug,
    project: projectName(slug),
    recordedMode,
    mode,
    slot,
    ports,
    db:
      env?.db ??
      (ports
        ? { port: ports.PORT_DB, database: stackDatabase(slug, mode) }
        : null),
    hosts: stackHosts(mode, slug),
    stateDir: paths.stackDir(slug)
  };
}

/** The local connection URL of a database, as `role`. */
export function dbUrl(db: DbTarget, role = "postgres"): string {
  return `postgresql://${role}:postgres@localhost:${db.port}/${db.database}`;
}

function readEnvLocal(
  root: string
): { db: DbTarget; ports: Partial<PortMap> } | null {
  const file = join(root, ".env.local");
  if (!existsSync(file)) return null;
  const env = parse(readFileSync(file));
  if (!env.SUPABASE_DB_URL) return null;
  const { port, pathname } = new URL(env.SUPABASE_DB_URL);
  if (!port) return null;
  // A borrowed stack from before a port existed has none for it.
  const ports = Object.fromEntries(
    PORT_NAMES.flatMap((name) => {
      const value = Number(env[name]);
      return Number.isInteger(value) && value > 0 ? [[name, value]] : [];
    })
  );
  return { db: { port: Number(port), database: pathname.slice(1) }, ports };
}
