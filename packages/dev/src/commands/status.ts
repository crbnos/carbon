// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { intro, log, outro } from "@clack/prompts";
import pc from "picocolors";
import { listContainers, listSharedContainers } from "../services/compose.js";
import { isAsleep } from "../services/hibernate.js";
import { sharedStats } from "../services/shared-db.js";
import { currentStack } from "../stack.js";
import { portsTable, servicesTable } from "../ui.js";

export async function status(opts: { json?: boolean } = {}) {
  const stack = await currentStack();
  const { slug, slot } = stack;
  // null: no crbn with modes ran `up` here yet.
  const mode = stack.recordedMode;
  const database = mode ? (stack.db?.database ?? null) : null;
  let sharedError: string | null = null;
  const shared =
    mode === "shared"
      ? await listSharedContainers().catch((err: Error) => {
          sharedError = err.message;
          return [];
        })
      : [];
  const stats =
    mode === "shared" && shared.some((c) => c.Service === "postgres")
      ? await sharedStats(database!).catch(() => null)
      : null;
  if (opts.json) {
    // Ports and containers only — the slot's JWT secret stays out of stdout.
    const out = {
      slug,
      project: stack.project,
      mode,
      database,
      ports: slot?.ports ?? null,
      redisDb: slot?.redisDb ?? null,
      containers: slot ? await listContainers(stack) : [],
      sharedContainers: shared,
      sharedConnections: stats?.connections ?? null,
      netQueue: stats?.netQueue ?? null
    };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }

  intro("Carbon · dev status");
  log.info(
    `worktree: ${pc.cyan(slug)}  project: ${pc.cyan(stack.project)}  mode: ${pc.cyan(mode ?? "not started")}${database ? `  database: ${pc.cyan(database)}` : ""}`
  );
  if (!slot) {
    log.warn("no port assignment yet — run `crbn up`");
    outro("");
    return;
  }

  log.message("\n" + portsTable(slot.ports, slot.redisDb), {
    symbol: pc.bold(pc.yellow("Portless"))
  });

  if (isAsleep(slug)) {
    log.info("hibernated — the next ERP/MES request wakes it");
  }

  const containers = await listContainers(stack);
  if (containers.length === 0) {
    log.warn("no worktree containers running");
  } else {
    log.message("\n" + servicesTable(containers), {
      symbol: pc.bold(pc.yellow("Docker"))
    });
  }
  if (sharedError) log.warn(`could not inspect crbn-shared: ${sharedError}`);
  if (shared.length > 0) {
    log.message("\n" + servicesTable(shared), {
      symbol: pc.bold(pc.yellow("crbn-shared"))
    });
  }
  if (stats) {
    log.info(
      `shared Postgres: ${stats.connections} connection(s)  pg_net queue: ${stats.netQueue}`
    );
  }
  outro("");
}
