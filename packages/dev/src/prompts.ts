// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  cancel,
  confirm,
  isCancel,
  log,
  multiselect,
  note,
  select
} from "@clack/prompts";
import { APPS, type AppId, isAppId } from "./constants.js";
import { paths } from "./paths.js";
import { listSlugs } from "./worktree.js";

// A clack prompt with no terminal neither waits nor cancels — the process just
// ends mid-command. Say what was needed, and how to run without a terminal.
export function requireTerminal(what: string, instead: string) {
  if (process.stdin.isTTY) return;
  // Not a throw: citty prints a thrown error with its stack, twice.
  cancel(`${what} needs a terminal. ${instead}`);
  process.exit(1);
}

export async function pickBorrowSlug(currentSlug: string): Promise<string> {
  const registry = listSlugs();
  const others = Object.entries(registry).filter(([s]) => s !== currentSlug);
  if (others.length === 0) {
    throw new Error(
      `No other worktree stacks in ${paths.registry()}.\nRun \`crbn up\` in another worktree first.`
    );
  }
  if (others.length === 1) {
    log.info(`auto-selecting only available worktree: ${others[0]![0]}`);
    return others[0]![0];
  }
  requireTerminal(
    "Choosing a worktree to borrow from",
    "Run `crbn up --borrow` in a terminal."
  );
  const picked = await select({
    message: "Borrow containers from which worktree?",
    options: others.map(([s, entry]) => ({
      value: s,
      label: s,
      hint: entry.worktreeRoot
    }))
  });
  if (isCancel(picked)) abort();
  return picked as string;
}

export async function pickApps(): Promise<AppId[]> {
  const fromEnv = process.env.CARBON_DEV_APPS;
  if (fromEnv) {
    return fromEnv
      .split(",")
      .map((s) => s.trim())
      .filter(isAppId);
  }
  const defaultApps = APPS.filter((a) => !a.optIn).map((a) => a.id);
  if (!process.stdin.isTTY) return defaultApps;

  note(
    "When no apps are selected it will only run (postgres, the API gateway, supabase, inngest, mail) without spawning ERP/MES dev servers.",
    "Tip"
  );
  const picked = await multiselect({
    message: "Which apps to run?",
    options: APPS.map((a) => ({ value: a.id, label: a.label, hint: a.hint })),
    initialValues: defaultApps,
    required: false
  });
  if (isCancel(picked)) abort();
  return picked as AppId[];
}

/**
 * Asks before something that destroys data, and ends the command on a no.
 * CARBON_DEV_YES=1 answers yes; without it there must be a terminal to ask in.
 */
export async function confirmDestructive(
  what: string,
  message: string
): Promise<void> {
  if (process.env.CARBON_DEV_YES === "1") return;
  requireTerminal(what, "Set CARBON_DEV_YES=1 to confirm without one.");
  const ok = await confirm({ message, initialValue: false });
  if (isCancel(ok) || !ok) abort();
}

export function abort(): never {
  cancel("aborted");
  process.exit(0);
}
