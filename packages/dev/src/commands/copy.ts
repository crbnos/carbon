// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { intro, log, outro } from "@clack/prompts";
import { isAbsolute, relative, resolve } from "pathe";
import pc from "picocolors";
import { copyFromMain, copyList } from "../copy-files.js";
import { getWorktreeRoot, mainCheckoutRoot } from "../git.js";

// `crbn env sync`: the package.json#crbn.copy files.
export async function envSync() {
  intro("Carbon · env sync");
  const root = await getWorktreeRoot();
  await report(root, copyList(await mainCheckoutRoot(root)), "synced");
}

// `crbn copy <file...>`: any files, at the same path as in main.
export async function copy(files: string[]) {
  intro("Carbon · copy");
  if (files.length === 0) {
    log.error("specify at least one file to copy from main checkout");
    outro("");
    process.exit(1);
  }
  const root = await getWorktreeRoot();
  const inside = files.flatMap((file) => {
    // Never read or write outside the worktree (`../../x`, absolute paths).
    const rel = relative(root, resolve(file));
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      log.warn(`${pc.dim(file)} escapes the worktree — skipped`);
      return [];
    }
    return [rel];
  });
  await report(root, inside, "copied");
}

async function report(root: string, files: string[], verb: string) {
  const result = await copyFromMain(root, files);
  if (!result) {
    log.warn("already in main checkout — nothing to copy");
    outro("");
    return;
  }
  for (const rel of result.missing) {
    log.warn(`${pc.dim(rel)} missing in main checkout — skipped`);
  }
  for (const rel of result.copied) log.info(`${pc.green("✓")} ${rel}`);
  const n = result.copied.length;
  outro(`${n} file${n === 1 ? "" : "s"} ${verb} from the main checkout`);
}
